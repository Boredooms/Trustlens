"""sim_registry: simulated ThreatReportRegistry state for CHAIN_MODE=simulated (WEB3_REGISTRY.md §7.1).

Two system tables, no user data: the current record per report id (the contract's mapping) and an
append-only transaction log whose identity column is the block number. Hashes only. RLS on, no
policies (the API connects as the owner), Supabase browser roles revoked — as for every table.

Revision ID: c8a0simreg01
Revises: c7a0note0001
Create Date: 2026-11-10 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c8a0simreg01"
down_revision: str | None = "c7a0note0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

HEX32 = "'^0x[0-9a-f]{64}$'"


def _lock_down(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN "
        f"REVOKE ALL ON {table} FROM anon, authenticated; END IF; END $$"
    )


def upgrade() -> None:
    op.create_table(
        "sim_registry_records",
        sa.Column("report_id_bytes32", sa.Text(), nullable=False),
        sa.Column("commitment", sa.Text(), nullable=False),
        sa.Column("payload_hash", sa.Text(), nullable=False),
        sa.Column("reporter", sa.Text(), nullable=False),
        sa.Column("registered_at", sa.BigInteger(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.SmallInteger(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"report_id_bytes32 ~ {HEX32}", name=op.f("ck_sim_registry_records_rid_hex")),
        sa.CheckConstraint(f"commitment ~ {HEX32}", name=op.f("ck_sim_registry_records_commitment_hex")),
        sa.CheckConstraint(
            f"payload_hash ~ {HEX32}", name=op.f("ck_sim_registry_records_payload_hash_hex")
        ),
        sa.CheckConstraint("status BETWEEN 1 AND 3", name=op.f("ck_sim_registry_records_status_range")),
        sa.CheckConstraint("revision >= 0", name=op.f("ck_sim_registry_records_revision_nonneg")),
        sa.PrimaryKeyConstraint("report_id_bytes32", name=op.f("pk_sim_registry_records")),
    )
    op.create_table(
        "sim_registry_txs",
        sa.Column("tx_hash", sa.Text(), nullable=False),
        sa.Column("block_number", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("report_id_bytes32", sa.Text(), nullable=False),
        sa.Column("sender", sa.Text(), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"tx_hash ~ {HEX32}", name=op.f("ck_sim_registry_txs_tx_hash_hex")),
        sa.CheckConstraint(
            "method IN ('register','revise','dispute','withdraw')",
            name=op.f("ck_sim_registry_txs_method"),
        ),
        sa.PrimaryKeyConstraint("tx_hash", name=op.f("pk_sim_registry_txs")),
        sa.UniqueConstraint("block_number", name=op.f("uq_sim_registry_txs_block_number")),
    )
    # Append-only, like a chain: transactions are never updated or deleted.
    op.execute(
        "CREATE FUNCTION sim_registry_txs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
        "BEGIN RAISE EXCEPTION 'sim_registry_txs is append-only'; END $$"
    )
    op.execute(
        "CREATE TRIGGER sim_registry_txs_no_change BEFORE UPDATE OR DELETE ON sim_registry_txs "
        "FOR EACH ROW EXECUTE FUNCTION sim_registry_txs_append_only()"
    )
    _lock_down("sim_registry_records")
    _lock_down("sim_registry_txs")


def downgrade() -> None:
    op.drop_table("sim_registry_txs")
    op.drop_table("sim_registry_records")
    op.execute("DROP FUNCTION IF EXISTS sim_registry_txs_append_only()")
