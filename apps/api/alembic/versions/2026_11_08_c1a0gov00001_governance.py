"""governance: login_hosts_mode on organisations, verification_method on verified_domains.

ORGANISATION_TRUST_PROFILES.md §4.3 (login_hosts_mode) and API_ENDPOINTS.md §8 (domain list exposes
the verification method). Both columns are additive with safe defaults; no data rewrite.

Revision ID: c1a0gov00001
Revises: b019d0cc250d
Create Date: 2026-11-08 19:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c1a0gov00001"
down_revision: str | None = "b019d0cc250d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organisations",
        sa.Column("login_hosts_mode", sa.Text(), server_default="domain_wildcard", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_organisations_login_hosts_mode"),
        "organisations",
        "login_hosts_mode IN ('domain_wildcard','explicit_only')",
    )
    op.add_column("verified_domains", sa.Column("verification_method", sa.Text(), nullable=True))
    op.create_check_constraint(
        op.f("ck_verified_domains_verification_method"),
        "verified_domains",
        "verification_method IS NULL OR verification_method IN ('dns_txt','http_file')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_verified_domains_verification_method"), "verified_domains", type_="check"
    )
    op.drop_column("verified_domains", "verification_method")
    op.drop_constraint(op.f("ck_organisations_login_hosts_mode"), "organisations", type_="check")
    op.drop_column("organisations", "login_hosts_mode")
