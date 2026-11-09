"""Async engine and session factory.

Owner documents: docs/00-project-foundation/TECH_STACK.md §4.3,
docs/03-backend/BACKEND_OVERVIEW.md §8.

Supabase's transaction-mode pooler (port 6543) cannot use server-side prepared statements. asyncpg's
statement cache and SQLAlchemy's prepared-statement cache are both disabled and statement names are
made unique, otherwise ``prepared statement "__asyncpg_stmt_…" already exists`` appears under load.
Migrations never use this engine; they use DIRECT_DATABASE_URL on 5432 (alembic/env.py).
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def to_asyncpg_url(url: str) -> str:
    """Normalise a Postgres URL for SQLAlchemy + asyncpg.

    Accepts ``postgres://``, ``postgresql://`` or ``postgresql+asyncpg://`` and translates libpq's
    ``sslmode`` to asyncpg's ``ssl`` query parameter (Supabase URLs are usually copied with it).
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql", "postgresql+psycopg", "postgresql+psycopg2"):
        scheme = "postgresql+asyncpg"
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == "sslmode":
            query.append(("ssl", value))
        else:
            query.append((key, value))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def to_sync_url(url: str) -> str:
    """URL for Alembic (psycopg 3, synchronous)."""
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql", "postgresql+asyncpg"):
        scheme = "postgresql+psycopg"
    query = [
        ("sslmode", value) if key == "ssl" else (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
    ]
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def create_engine(database_url: str, connect_timeout: float = 10) -> AsyncEngine:
    """Create the engine. No connection is attempted here (MONITORING_HEALTHCHECKS.md §6.1).

    ``connect_timeout`` covers TCP + TLS + pooler auth. A new Supavisor connection measured ~4.8 s
    from a distant client (2026-11-09), so the former fixed 5 s turned slow connects into 503s.
    """
    return create_async_engine(
        to_asyncpg_url(database_url),
        pool_size=5,
        max_overflow=5,
        # No pre-ping: it costs a full round trip on every checkout (~300 ms from a distant client,
        # measured 2026-11-09). Dead connections surface as OperationalError/connection_invalidated,
        # which get_db turns into 503 NOT_READY and the pool discards; pool_recycle retires idle
        # connections before Supavisor's idle timeout.
        pool_pre_ping=False,
        pool_recycle=300,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4().hex}__",
            "timeout": connect_timeout,
            "server_settings": {"application_name": "trustlens-api"},
        },
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
