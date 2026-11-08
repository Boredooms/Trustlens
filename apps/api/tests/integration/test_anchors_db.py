"""Web3 anchoring end to end against real Postgres and an in-memory registry (marker ``db``).

Covers WEB3_REGISTRY.md §5: anchor → idempotent re-anchor → public verify valid → tampered payload
invalid → report reviewed (report_unchanged false) → revision 2 → valid again; chain down never
affects reports; access control; no personal data in the stored snapshot.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.models.tables import AuditLog, ReportAnchor, ThreatReport
from app.services.chain import ChainClient

from ..conftest import make_settings
from ..fake_chain import FakeChain

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")]
CHAIN = {
    "chain_rpc_url": "http://chain.test:8545",
    "chain_registry_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "chain_sender_address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
}


def who(name: str, role: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{name}@anchor.test:{role}"}


@pytest.fixture
def fake() -> FakeChain:
    return FakeChain()


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch, fake: FakeChain) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(database_url=TEST_DB, dev_auth_enabled=True, jwt_secret="j" * 40, **CHAIN)
    )
    application.state.chain_client_factory = lambda s: ChainClient(s, transport=fake.transport())
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as c:
        yield c


async def new_report(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    host = f"anchor-{uuid.uuid4().hex[:8]}.example"
    r = await client.post(
        "/api/v1/reports",
        json={
            "url": f"https://login.{host}/verify?email=victim@mail.example",
            "justification": "Asked me (victim@mail.example, +91 90000 00000) for my OTP.",
            "intent": "login",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def test_anchor_verify_tamper_revise(
    app: FastAPI, client: httpx.AsyncClient, fake: FakeChain
) -> None:
    alice = who(f"alice{uuid.uuid4().hex[:6]}")
    rid = await new_report(client, alice)

    r = await client.get(f"/api/v1/reports/{rid}/anchor", headers=alice)
    assert r.status_code == 200 and r.json() == {"report_id": rid, "anchored": False, **_nulls()}

    r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["anchored"] and first["created"] and first["revision"] == 1
    assert first["contract"] == CHAIN["chain_registry_address"].lower()

    # Idempotent: unchanged payload sends no transaction.
    sends = fake.calls.count("register")
    r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
    assert r.status_code == 200 and r.json()["created"] is False
    assert fake.calls.count("register") == sends

    # Public, no auth.
    r = await client.get(f"/api/v1/public/verify/{rid}")
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["valid"] is True and all(v["checks"].values())
    assert v["on_chain_status"] == "active" and v["payload"]["indicator"].startswith("anchor-")
    assert "victim" not in r.text and "90000" not in r.text and "/verify" not in r.text

    # Tampered copy fails.
    tampered = {**v["payload"], "indicator": "someone-else.example"}
    r = await client.post(f"/api/v1/public/verify/{rid}", json={"payload": tampered})
    assert r.status_code == 200
    assert r.json()["valid"] is False and r.json()["checks"]["payload_hash_matches"] is False
    assert r.json()["checks"]["chain_commitment_matches"] is False

    # Review changes the report → snapshot no longer matches today's report.
    async with app.state.session_factory() as db:
        report = await db.get(ThreatReport, rid)
        assert report is not None
        report.status = "dismissed"
        await db.commit()
    r = await client.get(f"/api/v1/public/verify/{rid}")
    assert r.json()["valid"] is False and r.json()["checks"]["report_unchanged"] is False
    assert r.json()["checks"]["chain_commitment_matches"] is True

    # Re-anchoring creates revision 2, which verifies.
    r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
    assert r.status_code == 201 and r.json()["revision"] == 2
    assert "revise" in fake.calls
    r = await client.get(f"/api/v1/public/verify/{rid}")
    assert r.json()["valid"] is True and r.json()["on_chain_revision"] == 2

    async with app.state.session_factory() as db:
        anchor = (
            await db.execute(select(ReportAnchor).where(ReportAnchor.report_id == rid))
        ).scalar_one()
        assert anchor.salt_ciphertext and anchor.salt_ciphertext not in r.text
        actions = list(
            (
                await db.execute(
                    select(AuditLog.action).where(
                        AuditLog.target_id == rid, AuditLog.action == "report.anchor"
                    )
                )
            ).scalars()
        )
        assert len(actions) == 2


def _nulls() -> dict[str, None]:
    keys = (
        "chain_id contract report_id_bytes32 payload_hash commitment revision tx_hash "
        "block_number anchored_at simulated created"
    ).split()
    return dict.fromkeys(keys)


async def test_chain_down_only_affects_anchor_routes(
    client: httpx.AsyncClient, fake: FakeChain
) -> None:
    bob = who(f"bob{uuid.uuid4().hex[:6]}")
    fake.down = True
    rid = await new_report(client, bob)  # reporting still works
    r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=bob)
    assert r.status_code == 503 and r.json()["error"]["code"] == "CHAIN_UNAVAILABLE"
    assert (await client.get(f"/api/v1/reports/{rid}", headers=bob)).status_code == 200
    fake.down = False
    assert (await client.post(f"/api/v1/reports/{rid}/anchor", headers=bob)).status_code == 201
    fake.down = True
    r = await client.get(f"/api/v1/public/verify/{rid}")
    assert r.status_code == 503 and r.json()["error"]["code"] == "CHAIN_UNAVAILABLE"


async def test_access_control_and_not_found(client: httpx.AsyncClient) -> None:
    owner, stranger = who(f"own{uuid.uuid4().hex[:6]}"), who(f"str{uuid.uuid4().hex[:6]}")
    rid = await new_report(client, owner)
    assert (await client.post(f"/api/v1/reports/{rid}/anchor", headers=stranger)).status_code == 404
    assert (await client.post(f"/api/v1/reports/{rid}/anchor")).status_code == 401
    r = await client.get(f"/api/v1/public/verify/{rid}")  # exists but never anchored
    assert r.status_code == 404 and r.json()["error"]["code"] == "ANCHOR_NOT_FOUND"
    analyst = who(f"an{uuid.uuid4().hex[:6]}", "analyst")
    assert (await client.post(f"/api/v1/reports/{rid}/anchor", headers=analyst)).status_code == 201


async def test_existing_chain_record_without_a_row_is_never_overwritten(
    client: httpx.AsyncClient, fake: FakeChain
) -> None:
    from app.services.anchors import report_id_bytes32

    carol = who(f"carol{uuid.uuid4().hex[:6]}")
    rid = await new_report(client, carol)
    fake.records[report_id_bytes32(rid)[2:]] = {"c": "ab" * 32, "ph": "cd" * 32, "rev": 1, "st": 1}
    r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=carol)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ANCHOR_ALREADY_EXISTS"


def test_settings_type() -> None:
    assert isinstance(make_settings(**CHAIN), Settings)
