"""Alembic environment.

Migrations run against DIRECT_DATABASE_URL (port 5432), never the transaction pooler: the pooler
cannot run multi-statement DDL reliably (DATABASE_DESIGN.md §9). Falls back to DATABASE_URL only in
development/test, where both point at the same local Postgres.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context
from app.db.engine import to_sync_url
from app.models import tables  # noqa: F401 — registers every table on the metadata
from app.models.base import Base

# Same source as the app: process env first, then apps/api/.env (never overrides real env vars).
load_dotenv(override=False)

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    direct = os.environ.get("DIRECT_DATABASE_URL")
    if direct:
        return to_sync_url(direct)
    env = os.environ.get("ENVIRONMENT", "development")
    fallback = os.environ.get("DATABASE_URL")
    if env in ("development", "test") and fallback:
        return to_sync_url(fallback)
    raise SystemExit("DIRECT_DATABASE_URL is required for migrations (never use the pooler).")


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
