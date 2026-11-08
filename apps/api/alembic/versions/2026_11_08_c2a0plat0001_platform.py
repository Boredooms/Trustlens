"""platform: appeals table, row-level security, append-only audit_logs, Supabase role lockdown.

- ``appeals`` (API_ENDPOINTS.md §11, USER_JOURNEYS.md J10).
- RLS on every application table (DATABASE_DESIGN.md §8.1, §13.3). The API connects as the table
  owner, which bypasses RLS (the API is the policy point); any other role — Supabase ``anon`` /
  ``authenticated`` via PostgREST, a future Supabase client — sees only rows matching
  ``current_setting('app.current_user_id', true)``, and nothing at all when the setting is absent
  (fail closed). Global intelligence tables get RLS with **no** policy: deny-all to non-owners.
- ``audit_logs`` append-only (DATABASE_DESIGN.md §13.2), enforced by a trigger so it holds even for
  a superuser connection: DELETE only inside a transaction that opted in with
  ``SET LOCAL app.audit_retention = 'on'`` (the retention job), UPDATE only for the
  ``ON DELETE SET NULL`` of ``actor_user_id``.
- On Supabase, table/sequence grants to ``anon``/``authenticated`` are revoked (now and by default
  for future tables), so the public publishable key cannot read anything through PostgREST.

Revision ID: c2a0plat0001
Revises: c1a0gov00001
Create Date: 2026-11-08 19:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c2a0plat0001"
down_revision: str | None = "c1a0gov00001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "current_setting('app.current_user_id', true)"
MEMBER_ORGS = "(SELECT app_member_org_ids())"

# table -> tenant predicate (USING and WITH CHECK). None = RLS on, no policy (deny all non-owners).
POLICIES: dict[str, str | None] = {
    "users": f"id = {UID}",
    "refresh_tokens": f"user_id = {UID}",
    "api_keys": f"user_id = {UID}",
    "pairing_codes": f"user_id = {UID}",
    "organisations": f"id IN {MEMBER_ORGS}",
    "organisation_members": f"organisation_id IN {MEMBER_ORGS}",
    "organisation_invites": f"organisation_id IN {MEMBER_ORGS}",
    "verified_domains": f"organisation_id IN {MEMBER_ORGS}",
    "domain_verifications": (
        "verified_domain_id IN (SELECT id FROM verified_domains "
        f"WHERE organisation_id IN {MEMBER_ORGS})"
    ),
    "verified_recipients": f"organisation_id IN {MEMBER_ORGS}",
    "certificate_monitors": f"organisation_id IN {MEMBER_ORGS}",
    "scans": f"user_id = {UID} OR organisation_id IN {MEMBER_ORGS}",
    "scan_findings": "scan_id IN (SELECT id FROM scans)",  # inherits the scans policy
    "evidence": "scan_id IN (SELECT id FROM scans)",
    "investigations": f"user_id = {UID}",
    "threat_reports": f"reporter_user_id = {UID}",
    "usage_counters": (
        f"actor_id = {UID} OR actor_id IN (SELECT id FROM api_keys WHERE user_id = {UID})"
    ),
    "audit_logs": f"actor_user_id = {UID}",
    "idempotency_keys": None,
    "appeals": None,
    "entities": None,
    "relationships": None,
    "campaigns": None,
    "certificates": None,
    "certificate_incidents": None,
}
# Created at runtime by LangGraph's AsyncPostgresSaver.setup(); locked down if already present.
RUNTIME_TABLES = ("checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations")


def upgrade() -> None:
    op.create_table(
        "appeals",
        sa.Column("id", sa.CHAR(length=26), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("challenge_method", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending_challenge", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("observed_value", sa.Text(), nullable=True),
        sa.Column("challenge_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("challenge_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entity_id", sa.CHAR(length=26), nullable=True),
        sa.Column("reviewed_by", sa.CHAR(length=26), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("reputation_before", sa.SmallInteger(), nullable=True),
        sa.Column("reputation_after", sa.SmallInteger(), nullable=True),
        sa.Column("ip_hash", sa.CHAR(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "challenge_method IN ('dns_txt','http_file')", name=op.f("ck_appeals_method")
        ),
        sa.CheckConstraint(
            "status IN ('pending_challenge','challenge_verified','approved','rejected','expired')",
            name=op.f("ck_appeals_status"),
        ),
        sa.CheckConstraint(
            "char_length(message) BETWEEN 10 AND 2000", name=op.f("ck_appeals_message_length")
        ),
        sa.CheckConstraint("domain = lower(domain)", name=op.f("ck_appeals_domain_lowercase")),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entities.id"],
            name=op.f("fk_appeals_entity_id_entities"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"],
            ["users.id"],
            name=op.f("fk_appeals_reviewed_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_appeals")),
    )
    op.create_index("ix_appeals_queue", "appeals", ["status", sa.text("created_at DESC")])
    op.create_index(op.f("ix_appeals_domain"), "appeals", ["domain"])

    # ── Append-only audit_logs ───────────────────────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF current_setting('app.audit_retention', true) = 'on' THEN
              RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
          END IF;
          -- UPDATE: only the ON DELETE SET NULL of actor_user_id may touch a row.
          IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
             AND (NEW.id, NEW.actor_kind, NEW.action, NEW.target_type, NEW.target_id,
                  NEW.organisation_id, NEW.before, NEW.after, NEW.ip_hash, NEW.request_id,
                  NEW.created_at)
                 IS NOT DISTINCT FROM
                 (OLD.id, OLD.actor_kind, OLD.action, OLD.target_type, OLD.target_id,
                  OLD.organisation_id, OLD.before, OLD.after, OLD.ip_hash, OLD.request_id,
                  OLD.created_at) THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()"
    )

    # ── Row-level security ───────────────────────────────────────────────────────
    # SECURITY DEFINER so policies on organisation_members can use it without recursing into
    # their own policy; it returns only the organisations of the user named by the setting.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION app_member_org_ids() RETURNS SETOF char(26)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
          SELECT organisation_id FROM organisation_members WHERE user_id = {UID}
        $$
        """
    )
    for table, predicate in POLICIES.items():
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        if predicate is not None:
            op.execute(
                f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
                f"USING ({predicate}) WITH CHECK ({predicate})"
            )
    for table in RUNTIME_TABLES:
        op.execute(
            f"DO $$ BEGIN IF to_regclass('public.{table}') IS NOT NULL THEN "
            f"EXECUTE 'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY'; END IF; END $$"
        )

    # ── Supabase: the publishable/anon key must not reach any table via PostgREST ─
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
             AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
            EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                    'REVOKE ALL ON TABLES FROM anon, authenticated';
            EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                    'REVOKE ALL ON SEQUENCES FROM anon, authenticated';
            EXECUTE 'REVOKE EXECUTE ON FUNCTION app_member_org_ids() FROM anon, authenticated';
          END IF;
        END $$
        """
    )


def downgrade() -> None:
    # Grants revoked from Supabase roles are not restored: re-exposing tables to the anon key is
    # never a safe default, so a downgrade leaves them revoked (documented, deliberate).
    for table in RUNTIME_TABLES:
        op.execute(
            f"DO $$ BEGIN IF to_regclass('public.{table}') IS NOT NULL THEN "
            f"EXECUTE 'ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY'; END IF; END $$"
        )
    for table, predicate in POLICIES.items():
        if predicate is not None:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS app_member_org_ids()")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.drop_index(op.f("ix_appeals_domain"), table_name="appeals")
    op.drop_index("ix_appeals_queue", table_name="appeals")
    op.drop_table("appeals")
