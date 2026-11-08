"""Clerk re-verification on account deletion and the operator demo controls (marker ``db``).

Run with ``TEST_DATABASE_URL`` pointing at a migrated database; skipped otherwise.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, text

from app.api.routes.admin import DEMO_RESET_LOCK_KEY
from app.main import create_app
from app.models.tables import AuditLog, User
from app.security import auth as auth_module

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set"),
]
OPERATOR = {"Authorization": "Bearer dev:operator@trustlens.local:operator"}


async def _app(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> FastAPI:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    return create_app(
        make_settings(
            **{
                "database_url": TEST_DB,
                "dev_auth_enabled": True,
                "ip_hash_salt": "s" * 32,
                "demo_mode": True,
                **overrides,
            }
        )
    )


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    application = await _app(monkeypatch)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", timeout=300
    ) as c:
        yield c


def clerk_session(monkeypatch: pytest.MonkeyPatch, sub: str, fva: Any) -> dict[str, str]:
    """Stand in for a verified Clerk session token carrying ``fva``."""

    async def fake_verify(token: str, settings: object) -> dict[str, Any]:
        claims: dict[str, Any] = {"sub": sub, "azp": "http://localhost:5173"}
        if fva is not None:
            claims["fva"] = fva
        return claims

    monkeypatch.setattr(auth_module, "verify_clerk_jwt", fake_verify)
    return {"Authorization": "Bearer clerk-session-token"}


# ── Re-verification ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("fva", [[45, -1], [-1, -1], None])
async def test_clerk_delete_needs_recent_verification(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, fva: Any
) -> None:
    sub = f"user_{uuid.uuid4().hex[:12]}"
    headers = clerk_session(monkeypatch, sub, fva)
    r = await client.request(
        "DELETE", "/api/v1/auth/me", headers=headers, json={"confirm_email": f"{sub}@users.clerk"}
    )
    assert r.status_code == 403, r.text
    body = r.json()
    assert body["error"]["code"] == "REVERIFICATION_REQUIRED"
    assert body["clerk_error"]["type"] == "forbidden"
    assert body["clerk_error"]["reason"] == "reverification-error"
    async with app.state.session_factory() as db:
        user = (await db.execute(select(User).where(User.clerk_user_id == sub))).scalar_one()
        assert user.is_active  # nothing was deleted


async def test_clerk_delete_with_fresh_verification_succeeds(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sub = f"user_{uuid.uuid4().hex[:12]}"
    headers = clerk_session(monkeypatch, sub, [2, -1])
    r = await client.request(
        "DELETE", "/api/v1/auth/me", headers=headers, json={"confirm_email": f"{sub}@users.clerk"}
    )
    assert r.status_code == 204, r.text


# ── Operator demo controls ───────────────────────────────────────────────────────
async def test_demo_status_is_operator_only(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/admin/demo", headers=OPERATOR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["demo_mode"] is True
    assert set(body["counts"]) == {"scans", "reports", "campaigns", "investigations", "incidents"}
    user = {"Authorization": f"Bearer dev:plain.{uuid.uuid4().hex[:6]}@trustlens.local:user"}
    assert (await client.get("/api/v1/admin/demo", headers=user)).status_code == 403
    analyst = {"Authorization": "Bearer dev:analyst@trustlens.local:analyst"}
    assert (await client.get("/api/v1/admin/demo", headers=analyst)).status_code == 403
    assert (await client.get("/api/v1/admin/demo")).status_code == 401


async def test_demo_reset_reseeds_and_audits(app: FastAPI, client: httpx.AsyncClient) -> None:
    r = await client.post("/api/v1/admin/demo/reset", headers=OPERATOR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["organisation"]["name"] == "Northstar University"
    assert body["counts"]["scans"] >= 4
    assert body["counts"]["campaigns"] >= 1
    assert body["last_seeded_at"]
    async with app.state.session_factory() as db:
        rows = (
            (await db.execute(select(AuditLog).where(AuditLog.action == "demo.reset")))
            .scalars()
            .all()
        )
        assert rows


async def test_demo_reset_is_idempotent_with_a_key(client: httpx.AsyncClient) -> None:
    headers = {**OPERATOR, "Idempotency-Key": f"demo-{uuid.uuid4().hex}"}
    first = await client.post("/api/v1/admin/demo/reset", headers=headers)
    assert first.status_code == 200, first.text
    replay = await client.post("/api/v1/admin/demo/reset", headers=headers)
    assert replay.status_code == 200
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert replay.json() == first.json()


async def test_concurrent_reset_is_refused(app: FastAPI, client: httpx.AsyncClient) -> None:
    async with app.state.session_factory() as holder, holder.begin():
        await holder.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": DEMO_RESET_LOCK_KEY})
        r = await client.post("/api/v1/admin/demo/reset", headers=OPERATOR)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "CONFLICT"


async def test_reset_requires_demo_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    application = await _app(monkeypatch, demo_mode=False)
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            r = await c.post("/api/v1/admin/demo/reset", headers=OPERATOR)
            assert r.status_code == 403
            assert r.json()["error"]["code"] == "DEMO_MODE_REQUIRED"
            status = await c.get("/api/v1/admin/demo", headers=OPERATOR)
            assert status.status_code == 200 and status.json()["demo_mode"] is False
