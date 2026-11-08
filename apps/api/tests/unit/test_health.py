"""Health and readiness (MONITORING_HEALTHCHECKS.md §1, §9)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from app.db.engine import to_asyncpg_url, to_sync_url


async def test_health_is_200_with_database_down(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "trustlens-api"
    assert body["timestamp"].endswith("Z")
    assert isinstance(body["uptime_s"], int)
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path", ["/ready", "/api/v1/health"])
async def test_ready_is_503_with_database_reason(client: httpx.AsyncClient, path: str) -> None:
    response = await client.get(path)
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"]["status"] == "down"
    assert body["checks"]["database"]["detail"] in {"unreachable", "timeout"}
    assert body["error"]["code"] == "NOT_READY"
    assert body["error"]["request_id"] == response.headers["x-request-id"]
    assert response.headers["retry-after"] == "5"


async def test_llm_without_key_is_degraded_not_unready(client: httpx.AsyncClient) -> None:
    body = (await client.get("/ready")).json()
    assert body["checks"]["llm"] == {"status": "degraded", "detail": "no_api_key"}
    assert body["checks"]["scanner"] == {"status": "ok", "queue_depth": 0, "breaker": "closed"}


async def test_shutting_down_flips_readiness(app: FastAPI, client: httpx.AsyncClient) -> None:
    app.state.runtime.shutting_down = True
    body = (await client.get("/ready")).json()
    assert body["checks"]["database"]["detail"] == "shutting_down"


def test_url_normalisation_for_pooler_and_migrations() -> None:
    supabase = "postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres?sslmode=require"
    assert to_asyncpg_url(supabase) == (
        "postgresql+asyncpg://u:p@aws-0.pooler.supabase.com:6543/postgres?ssl=require"
    )
    assert to_sync_url("postgresql+asyncpg://u:p@h:5432/db?ssl=require") == (
        "postgresql+psycopg://u:p@h:5432/db?sslmode=require"
    )


def test_engine_disables_prepared_statement_caches(app: FastAPI) -> None:
    # The Supabase transaction pooler trap (TECH_STACK.md §4.3).
    connect_args = app.state.engine.dialect.create_connect_args(app.state.engine.url)
    assert app.state.engine.url.drivername == "postgresql+asyncpg"
    assert connect_args is not None
