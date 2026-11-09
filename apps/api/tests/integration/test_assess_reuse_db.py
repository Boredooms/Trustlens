"""POST /assess reuses a recent browse decision (API_ENDPOINTS.md §6 `cached`), real Postgres.

Real-world sites take longer to scan than the extension's page-load budget; reusing the caller's own
finished browse scan of the same URL for 10 minutes makes repeat visits instant. Action checks never
reuse (EXTENSION_API_INTEGRATION.md §5). Run with ``TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from app.main import create_app
from app.models.tables import Scan
from app.services import guard
from app.utils import new_ulid, utcnow

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")]

URL = "https://pay.northstar-demo.example/fees"


def who(email: str) -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{email}:user"}


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(
            database_url=TEST_DB, dev_auth_enabled=True, ip_hash_salt="s" * 32, demo_mode=True
        )
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as c:
        yield c


async def _seed_browse_scan(app: FastAPI, user_id: str, minutes_ago: float) -> str:
    sid = new_ulid()
    done = utcnow() - timedelta(minutes=minutes_ago)
    async with app.state.session_factory() as db:
        db.add(
            Scan(
                id=sid,
                user_id=user_id,
                url=URL,
                normalised_url=guard.parse_target(URL).normalised_url,
                registrable_domain="northstar-demo.example",
                intent="browse",
                status="completed",
                decision="ALLOW",
                risk_level="LOW",
                risk_score=0,
                coverage={
                    "percent": 100,
                    "collected": [
                        "reputation",
                        "identity",
                        "credential_destination",
                        "payment_destination",
                        "infrastructure",
                    ],
                    "unavailable": [],
                    "skipped": [],
                },
                reasons=[],
                overrides=[],
                result={
                    "action": {
                        "intent": "browse",
                        "claimed_organisation": None,
                        "observed_destination": None,
                        "expected_destinations": [],
                        "payee": None,
                        "expected_payees": [],
                        "match": "unverifiable",
                    }
                },
                cached_groups=[],
                simulated=True,
                completed_at=done,
            )
        )
        await db.commit()
    return sid


async def _scan_count(app: FastAPI, user_id: str) -> int:
    async with app.state.session_factory() as db:
        return int(
            (
                await db.execute(
                    select(func.count()).select_from(Scan).where(Scan.user_id == user_id)
                )
            ).scalar_one()
        )


async def _user(client: httpx.AsyncClient, h: dict[str, str]) -> str:
    r = await client.get("/api/v1/auth/me", headers=h)
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


async def test_browse_reuses_recent_scan_and_creates_no_row(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    h = who(f"reuse-{uuid.uuid4().hex[:8]}@assess.test")
    user_id = await _user(client, h)
    seeded = await _seed_browse_scan(app, user_id, minutes_ago=2)
    before = await _scan_count(app, user_id)

    r = await client.post(
        "/api/v1/assess",
        headers={**h, "Idempotency-Key": uuid.uuid4().hex},
        json={"url": URL, "intent": "browse"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cached"] is True
    assert body["scan_id"] == seeded
    assert body["decision"] == "ALLOW"
    assert await _scan_count(app, user_id) == before


async def test_stale_scan_and_action_checks_are_not_reused(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    h = who(f"fresh-{uuid.uuid4().hex[:8]}@assess.test")
    user_id = await _user(client, h)
    stale = await _seed_browse_scan(app, user_id, minutes_ago=30)

    r = await client.post(
        "/api/v1/assess",
        headers={**h, "Idempotency-Key": uuid.uuid4().hex},
        json={"url": URL, "intent": "browse"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cached"] is False and r.json()["scan_id"] != stale

    # A login check carries a different intent: always fresh, even right after a browse scan.
    r = await client.post(
        "/api/v1/assess",
        headers={**h, "Idempotency-Key": uuid.uuid4().hex},
        json={"url": URL, "intent": "login"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cached"] is False


async def test_another_users_scan_is_never_reused(app: FastAPI, client: httpx.AsyncClient) -> None:
    owner = who(f"owner-{uuid.uuid4().hex[:8]}@assess.test")
    other = who(f"other-{uuid.uuid4().hex[:8]}@assess.test")
    seeded = await _seed_browse_scan(app, await _user(client, owner), minutes_ago=1)
    await _user(client, other)
    r = await client.post(
        "/api/v1/assess",
        headers={**other, "Idempotency-Key": uuid.uuid4().hex},
        json={"url": URL, "intent": "browse"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["scan_id"] != seeded
