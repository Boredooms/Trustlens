"""Account deletion (J11) and Clerk webhooks against a real Postgres (marker ``db``).

Run with ``TEST_DATABASE_URL`` pointing at a migrated database; skipped otherwise.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.main import create_app
from app.models.tables import ApiKey, AuditLog, Scan, ThreatReport, User
from app.security import svix
from app.utils import new_ulid, utcnow

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set"),
]
SECRET = (
    "whsec_" + "dGVzdC1zZWNyZXQtZm9yLXN2aXgtd2ViaG9va3M="
)  # base64("test-secret-for-svix-webhooks")


def uid() -> str:
    return uuid.uuid4().hex[:10]


def who(email: str, role: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{email}:{role}"}


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(
            database_url=TEST_DB,
            dev_auth_enabled=True,
            ip_hash_salt="s" * 32,
            clerk_webhook_secret=SECRET,
            demo_mode=True,
        )
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


async def me(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    r = await client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def test_delete_requires_matching_email(client: httpx.AsyncClient) -> None:
    h = who(f"del-{uid()}@acct.test")
    await me(client, h)
    r = await client.request(
        "DELETE", "/api/v1/auth/me", headers=h, json={"confirm_email": "someone@else.test"}
    )
    assert r.status_code == 422
    assert r.json()["error"]["details"] == [{"field": "confirm_email", "issue": "mismatch"}]


async def test_sole_admin_cannot_delete(client: httpx.AsyncClient) -> None:
    email = f"admin-{uid()}@acct.test"
    h = who(email)
    r = await client.post(
        "/api/v1/organisations",
        headers={**h, "Idempotency-Key": uid()},
        json={"name": f"Acct Org {uid()}"},
    )
    assert r.status_code == 201, r.text
    org = r.json()
    r = await client.request(
        "DELETE", "/api/v1/auth/me", headers=h, json={"confirm_email": email.upper()}
    )
    assert r.status_code == 409
    body = r.json()["error"]
    assert body["code"] == "LAST_ADMIN_REMOVAL"
    assert body["details"] == [{"organisation_id": org["id"], "name": org["name"]}]


async def test_delete_revokes_and_anonymises(app: FastAPI, client: httpx.AsyncClient) -> None:
    email = f"gone-{uid()}@acct.test"
    h = who(email)
    user = await me(client, h)
    r = await client.post(
        "/api/v1/api-keys", headers=h, json={"name": "ci", "scopes": ["assess:read"]}
    )
    assert r.status_code == 201, r.text
    secret = r.json()["secret"]
    r = await client.post(
        "/api/v1/scans",
        headers={**h, "Idempotency-Key": uid()},
        json={"url": "https://pay.northstar-demo.example/fees", "intent": "payment"},
    )
    assert r.status_code in (200, 201, 202), r.text
    kept_scan = new_ulid()
    async with app.state.session_factory() as db:
        db.add(
            Scan(
                id=kept_scan,
                user_id=user["id"],
                url="https://kept.example/",
                normalised_url="https://kept.example/",
                registrable_domain="kept.example",
                intent="browse",
                status="completed",
                coverage=100,
                reasons=[],
                overrides=[],
                result={},
                cached_groups=[],
                simulated=True,
            )
        )
        await db.flush()
        db.add(
            ThreatReport(
                id=new_ulid(),
                reporter_user_id=user["id"],
                reporter_channel="web",
                url="https://kept.example/",
                normalised_url="https://kept.example/",
                scan_id=kept_scan,
                justification="Confirmed phishing page for the test.",
                status="confirmed",
                simulated=True,
                dedupe_day=utcnow().date(),
            )
        )
        await db.commit()

    r = await client.request("DELETE", "/api/v1/auth/me", headers=h, json={"confirm_email": email})
    assert r.status_code == 204, r.text

    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 401  # API key revoked
    async with app.state.session_factory() as db:
        row = await db.get(User, user["id"])
        assert row is not None and not row.is_active
        assert row.email == f"deleted-{user['id']}@users.invalid"
        assert row.display_name == "Deleted user"
        keys = (await db.execute(select(ApiKey).where(ApiKey.user_id == user["id"]))).scalars()
        assert all(k.revoked_at is not None for k in keys)
        remaining = (await db.execute(select(Scan).where(Scan.user_id == user["id"]))).all()
        assert remaining == []
        kept = await db.get(Scan, kept_scan)
        assert kept is not None and kept.user_id is None  # confirmed intelligence survives
        report = (
            await db.execute(select(ThreatReport).where(ThreatReport.scan_id == kept_scan))
        ).scalar_one()
        assert report.reporter_user_id is None and report.anonymised_at is not None
        audit = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "user.delete", AuditLog.target_id == user["id"]
                )
            )
        ).scalar_one()
        assert audit.after is not None and audit.after["scans_deleted"] >= 1

    # The same dev identity signing in again is a brand-new account, not the deleted one.
    again = await me(client, h)
    assert again["id"] != user["id"]


def signed(
    body: dict[str, Any], *, secret: str = SECRET, ts: int | None = None
) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    msg_id = f"msg_{uid()}"
    stamp = int(time.time()) if ts is None else ts
    return raw, {
        "svix-id": msg_id,
        "svix-timestamp": str(stamp),
        "svix-signature": svix.sign(secret, msg_id, stamp, raw),
        "content-type": "application/json",
    }


async def test_webhook_rejects_bad_and_stale_signatures(client: httpx.AsyncClient) -> None:
    event = {"type": "user.updated", "data": {"id": f"user_{uid()}"}}
    raw, headers = signed(event, secret="whsec_" + "b3RoZXItc2VjcmV0")
    r = await client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 401
    raw, headers = signed(event, ts=int(time.time()) - 3600)
    r = await client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 401
    r = await client.post(
        "/webhooks/clerk", content=b"{}", headers={"content-type": "application/json"}
    )
    assert r.status_code == 401


async def test_webhook_syncs_and_deletes_users(app: FastAPI, client: httpx.AsyncClient) -> None:
    sub = f"user_{uid()}"
    data = {
        "id": sub,
        "primary_email_address_id": "e1",
        "email_addresses": [{"id": "e1", "email_address": f"{sub}@Example.test"}],
        "first_name": "Web",
        "last_name": "Hook",
    }
    raw, headers = signed({"type": "user.created", "data": data})
    r = await client.post("/webhooks/clerk", content=raw, headers=headers)
    assert r.status_code == 204, r.text
    async with app.state.session_factory() as db:
        user = (await db.execute(select(User).where(User.clerk_user_id == sub))).scalar_one()
        assert user.email == f"{sub}@example.test" and user.display_name == "Web Hook"
        user_id = user.id
    raw, headers = signed({"type": "user.updated", "data": {**data, "first_name": "Renamed"}})
    assert (await client.post("/webhooks/clerk", content=raw, headers=headers)).status_code == 204
    raw, headers = signed({"type": "user.deleted", "data": {"id": sub, "deleted": True}})
    assert (await client.post("/webhooks/clerk", content=raw, headers=headers)).status_code == 204
    # Redelivery of the same event is harmless.
    raw, headers = signed({"type": "user.deleted", "data": {"id": sub, "deleted": True}})
    assert (await client.post("/webhooks/clerk", content=raw, headers=headers)).status_code == 204
    async with app.state.session_factory() as db:
        row = await db.get(User, user_id)
        assert row is not None and not row.is_active and row.display_name == "Deleted user"
