"""web3: report_anchors (WEB3_REGISTRY.md §6).

One row per threat report holding the latest on-chain commitment. RLS on with no policy: deny-all
to non-owner roles (the API connects as owner), like the global intelligence tables.

Revision ID: c3a0web30001
Revises: c2a0plat0001
Create Date: 2026-11-09 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c3a0web30001"
down_revision: str | None = "c2a0plat0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_anchors",
        sa.Column("id", sa.CHAR(length=26), nullable=False),
        sa.Column("report_id", sa.CHAR(length=26), nullable=False),
        sa.Column("chain_id", sa.BigInteger(), nullable=False),
        sa.Column("contract", sa.Text(), nullable=False),
        sa.Column("report_id_bytes32", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload_hash", sa.Text(), nullable=False),
        sa.Column("salt_ciphertext", sa.Text(), nullable=False),
        sa.Column("commitment", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("tx_hash", sa.Text(), nullable=False),
        sa.Column("block_number", sa.BigInteger(), nullable=False),
        sa.Column("anchored_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.CHAR(length=26), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_report_anchors_revision_positive")),
        sa.CheckConstraint(
            "commitment ~ '^0x[0-9a-f]{64}$'", name=op.f("ck_report_anchors_commitment_hex")
        ),
        sa.CheckConstraint(
            "payload_hash ~ '^0x[0-9a-f]{64}$'", name=op.f("ck_report_anchors_payload_hash_hex")
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["threat_reports.id"],
            name=op.f("fk_report_anchors_report_id_threat_reports"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_report_anchors_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_anchors")),
        sa.UniqueConstraint("report_id", name=op.f("uq_report_anchors_report_id")),
    )
    op.execute("ALTER TABLE report_anchors ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("report_anchors")
