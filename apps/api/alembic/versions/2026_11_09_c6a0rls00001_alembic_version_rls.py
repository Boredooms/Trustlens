"""security: RLS on alembic_version (found by app.scripts.rls_audit against Supabase).

The table had no privileges for anon/authenticated, but RLS was off, which Supabase's security
advisor flags and which would expose it if a future grant slipped. Owner (migrations) bypasses RLS.

Revision ID: c6a0rls00001
Revises: c5a0intel0001
Create Date: 2026-11-09 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c6a0rls00001"
down_revision: str | None = "c5a0intel0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE alembic_version DISABLE ROW LEVEL SECURITY")
