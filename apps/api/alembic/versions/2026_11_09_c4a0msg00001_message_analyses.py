"""messages: message_analyses (MESSAGE_ANALYSIS.md §7).

Stores no raw message text: a normalised-text hash (exact-repeat correlation), counts, finding codes
and link domains. RLS: a user sees only their own rows.

Revision ID: c4a0msg00001
Revises: c3a0web30001
Create Date: 2026-11-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4a0msg00001"
down_revision: str | None = "c3a0web30001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "current_setting('app.current_user_id', true)"


def upgrade() -> None:
    op.create_table(
        "message_analyses",
        sa.Column("id", sa.CHAR(length=26), nullable=False),
        sa.Column("user_id", sa.CHAR(length=26), nullable=True),
        sa.Column("api_key_id", sa.CHAR(length=26), nullable=True),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("risk_score", sa.SmallInteger(), nullable=False),
        sa.Column("finding_codes", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("link_domains", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column(
            "link_scan_ids", postgresql.ARRAY(sa.CHAR(length=26)), server_default="{}", nullable=False
        ),
        sa.Column("engine_version", sa.Text(), nullable=False),
        sa.Column("simulated", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint(
            "channel IN ('email','sms','dm','other')", name=op.f("ck_message_analyses_channel")
        ),
        sa.CheckConstraint(
            "decision IN ('BLOCK','WARN','ALLOW','REVIEW','UNKNOWN')",
            name=op.f("ck_message_analyses_decision"),
        ),
        sa.CheckConstraint(
            "char_count BETWEEN 1 AND 20000", name=op.f("ck_message_analyses_char_count")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_message_analyses_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            ["api_keys.id"],
            name=op.f("fk_message_analyses_api_key_id_api_keys"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_message_analyses")),
    )
    op.create_index(op.f("ix_message_analyses_text_sha256"), "message_analyses", ["text_sha256"])
    op.create_index(
        "ix_message_analyses_user_recent",
        "message_analyses",
        ["user_id", sa.text("created_at DESC")],
    )
    op.execute("ALTER TABLE message_analyses ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON message_analyses FOR ALL "
        f"USING (user_id = {UID}) WITH CHECK (user_id = {UID})"
    )


def downgrade() -> None:
    op.drop_table("message_analyses")
