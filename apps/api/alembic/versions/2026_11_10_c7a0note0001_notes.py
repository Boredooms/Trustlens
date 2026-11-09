"""notes: private block-structured notes per subject (API_ENDPOINTS.md §18, DATABASE_DESIGN.md §7.7).

One row per (user, subject_type, subject_id); `blocks` is a JSON array validated by the API
(schemas/notes.py). Deleting a user deletes their notes (CASCADE). RLS: owner only.

Revision ID: c7a0note0001
Revises: c6a0rls00001
Create Date: 2026-11-10 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c7a0note0001"
down_revision: str | None = "c6a0rls00001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "current_setting('app.current_user_id', true)"


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.CHAR(length=26), nullable=False),
        sa.Column("user_id", sa.CHAR(length=26), nullable=False),
        sa.Column("subject_type", sa.Text(), nullable=False),
        sa.Column("subject_id", sa.CHAR(length=26), nullable=False),
        sa.Column(
            "blocks", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False
        ),
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
            "subject_type IN ('scan','campaign','investigation','report')",
            name=op.f("ck_notes_subject_type"),
        ),
        sa.CheckConstraint("jsonb_typeof(blocks) = 'array'", name=op.f("ck_notes_blocks_array")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
        sa.UniqueConstraint(
            "user_id",
            "subject_type",
            "subject_id",
            name=op.f("uq_notes_user_id_subject_type_subject_id"),
        ),
    )
    op.create_index("ix_notes_user_recent", "notes", ["user_id", sa.text("updated_at DESC")])
    op.execute("ALTER TABLE notes ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON notes FOR ALL "
        f"USING (user_id = {UID}) WITH CHECK (user_id = {UID})"
    )
    # Supabase: the API connects as the owner; browser roles get nothing (as for every table).
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN "
        "REVOKE ALL ON notes FROM anon, authenticated; END IF; END $$"
    )


def downgrade() -> None:
    op.drop_table("notes")
