from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.config import Settings
from app.main import create_app

# Port 1 on localhost refuses immediately: a deterministic "database is down".
UNREACHABLE_DB = "postgresql+asyncpg://tl:tl@127.0.0.1:1/trustlens"

BASE_SETTINGS: dict[str, Any] = {
    "environment": "test",
    "database_url": UNREACHABLE_DB,
    "clerk_issuer": "https://test.clerk.accounts.dev",
    "clerk_jwks_url": "https://test.clerk.accounts.dev/.well-known/jwks.json",
    "clerk_authorized_party": "http://localhost:5173",
    "allowed_origins": "http://localhost:5173",
    "rate_limit_enabled": False,
    "log_level": "warning",
}


def make_settings(**overrides: Any) -> Settings:
    return Settings(**{**BASE_SETTINGS, **overrides}, _env_file=None)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests never read the developer's real environment or .env file."""
    for key in list(os.environ):
        if key.startswith(
            ("CLERK_", "DATABASE_", "DIRECT_DATABASE", "SUPABASE_", "UPSTASH_", "CHAIN_", "INTEL_")
        ):
            monkeypatch.delenv(key, raising=False)


@pytest.fixture
def settings_factory() -> Callable[..., Settings]:
    return make_settings


@pytest.fixture
def app() -> FastAPI:
    return create_app(make_settings())


@pytest.fixture
async def client(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[httpx.AsyncClient]:
    # HTTP tests do not exercise checkpointing; skip the bounded Postgres connect at startup.
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            yield c
