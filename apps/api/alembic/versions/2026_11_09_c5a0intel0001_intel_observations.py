"""intel: intel_observations cache (THREAT_INTELLIGENCE_SOURCES.md §4).

Shared cache for external feed answers (multi-worker safe). Keyed by a hash of the indicator;
failures are never cached. RLS on, no policy (global intelligence, owner-only).

Revision ID: c5a0intel0001
Revises: c4a0msg00001
Create Date: 2026-11-09 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c5a0intel0001"
down_revision: str | None = "c4a0msg00001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "intel_observations",
        sa.Column("id", sa.CHAR(length=26), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("indicator_type", sa.Text(), nullable=False),
        sa.Column("indicator_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("listing_id", sa.Text(), nullable=True),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("queried_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('listed','not_listed')", name=op.f("ck_intel_observations_status")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_intel_observations")),
    )
    op.create_index(
        "ix_intel_observations_lookup",
        "intel_observations",
        ["source", "indicator_hash", "expires_at"],
    )
    op.execute("ALTER TABLE intel_observations ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("intel_observations")
