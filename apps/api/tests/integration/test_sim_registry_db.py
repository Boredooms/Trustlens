"""CHAIN_MODE=simulated end to end against real Postgres (marker ``db``).

Same flow as the real-chain test (anchor → verify → tamper → revise), through the production wiring
in create_app, plus: state survives an API restart, anchors are labelled simulated with chain id 0,
the contract's rules hold, and the transaction log is append-only.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.main import create_app
from app.models.tables import SimRegistryRecord, SimRegistryTx
from app.services.chain import SIMULATED_CONTRACT, ChainClient

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")]


def who(name: str, role: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{name}@sim.test:{role}"}


def _settings() -> object:
    return make_settings(
        database_url=TEST_DB, dev_auth_enabled=True, jwt_secret="j" * 40, chain_mode="simulated"
    )


@pytest.fixture
def make_app(monkeypatch: pytest.MonkeyPatch) -> Callable[[], FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    return lambda: create_app(_settings())  # type: ignore[arg-type]


async def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


@pytest.fixture
async def app(make_app: Callable[[], FastAPI]) -> AsyncIterator[FastAPI]:
    application = make_app()
    async with application.router.lifespan_context(application):
        yield application


async def new_report(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    host = f"sim-{uuid.uuid4().hex[:8]}.example"
    r = await client.post(
        "/api/v1/reports",
        json={
            "url": f"https://pay.{host}/",
            "justification": "Asks for a fee by UPI.",
            "intent": "payment",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def test_simulated_anchor_verify_tamper_revise_and_restart(
    app: FastAPI, make_app: Callable[[], FastAPI]
) -> None:
    alice = who(f"alice{uuid.uuid4().hex[:6]}")
    async with await _client(app) as client:
        rid = await new_report(client, alice)
        r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
        assert r.status_code == 201, r.text
        a = r.json()
        assert a["chain_id"] == 0 and a["simulated"] is True and a["contract"] == SIMULATED_CONTRACT
        assert a["revision"] == 1 and a["tx_hash"].startswith("0x") and a["block_number"] >= 1

        # Idempotent re-anchor: no new transaction.
        async with app.state.session_factory() as db:
            before = (
                await db.execute(select(SimRegistryTx).where(SimRegistryTx.method == "register"))
            ).all()
        r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
        assert r.status_code == 200 and r.json()["created"] is False
        async with app.state.session_factory() as db:
            after = (
                await db.execute(select(SimRegistryTx).where(SimRegistryTx.method == "register"))
            ).all()
        assert len(after) == len(before)

        v = (await client.get(f"/api/v1/public/verify/{rid}")).json()
        assert v["valid"] is True and all(v["checks"].values()) and v["simulated"] is True
        assert v["on_chain_status"] == "active" and v["on_chain_revision"] == 1

        tampered = {**v["payload"], "indicator": "someone-else.example"}
        t = (await client.post(f"/api/v1/public/verify/{rid}", json={"payload": tampered})).json()
        assert t["valid"] is False and t["checks"]["chain_commitment_matches"] is False

        # The stored commitment is the real keccak commitment of the stored payload hash and salt.
        async with app.state.session_factory() as db:
            rec = await db.get(SimRegistryRecord, a["report_id_bytes32"])
        assert rec is not None and rec.commitment == a["commitment"] and rec.revision == 1

    # A fresh API process (Render restart) still verifies: state is in Postgres, not memory.
    restarted = make_app()
    async with restarted.router.lifespan_context(restarted), await _client(restarted) as client:
        v2 = (await client.get(f"/api/v1/public/verify/{rid}")).json()
        assert v2["valid"] is True and v2["simulated"] is True

        # Review changes the report; re-anchoring revises to revision 2, which verifies.
        from app.models.tables import ThreatReport

        async with restarted.state.session_factory() as db:
            report = await db.get(ThreatReport, rid)
            assert report is not None
            report.status = "dismissed"
            await db.commit()
        r = await client.post(f"/api/v1/reports/{rid}/anchor", headers=alice)
        assert r.status_code == 201 and r.json()["revision"] == 2
        v3 = (await client.get(f"/api/v1/public/verify/{rid}")).json()
        assert v3["valid"] is True and v3["on_chain_revision"] == 2


async def test_contract_rules_and_append_only_log(app: FastAPI) -> None:
    from app.services.anchors import report_id_bytes32
    from app.services.chain import AnchorTxFailed
    from app.utils import new_ulid

    client = app.state.chain_client_factory(app.state.settings)
    assert isinstance(client, ChainClient)
    await client.check()
    rid = report_id_bytes32(new_ulid())
    ph, salt = "0x" + "12" * 32, "0x" + "34" * 32
    c1 = await client.commitment_of(rid, ph, salt, 1)
    tx = await client.register(rid, c1, ph, 1)
    assert tx.block_number >= 1
    with pytest.raises(AnchorTxFailed):  # AlreadyRegistered
        await client.register(rid, c1, ph, 1)
    with pytest.raises(AnchorTxFailed):  # StaleRevision
        await client.revise(rid, c1, ph, 1)
    with pytest.raises(AnchorTxFailed):  # EmptyCommitment
        await client.register(report_id_bytes32(new_ulid()), "0x" + "0" * 64, ph, 1)
    ok, rev, status = await client.verify(rid, ph, salt)
    assert ok and rev == 1 and status == "active"
    assert (await client.verify(rid, ph, "0x" + "35" * 32))[0] is False
    missing = await client.get(report_id_bytes32(new_ulid()))
    assert not missing.exists

    async with app.state.session_factory() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text("UPDATE sim_registry_txs SET method = 'withdraw' WHERE tx_hash = :h"),
                {"h": tx.tx_hash},
            )
        await db.rollback()
