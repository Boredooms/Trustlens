"""Message analysis end to end: real Postgres, real scan pipeline on the demo hosts (marker ``db``).

The demo hosts resolve to recorded collector fixtures in DEMO_MODE (ADR-016), so links are assessed
by the real guard → collectors → rules path without network access.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.main import create_app
from app.models.tables import MessageAnalysis
from app.scripts.seed_demo import seed

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")]
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "messages"


def who() -> dict[str, str]:
    return {"Authorization": f"Bearer dev:msg{uuid.uuid4().hex[:6]}@messages.test:user"}


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(database_url=TEST_DB, dev_auth_enabled=True, demo_mode=True)
    )
    async with application.router.lifespan_context(application):
        await seed(application.state.session_factory, application.state.settings)
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver", timeout=120
    ) as c:
        yield c


async def analyse(client: httpx.AsyncClient, name: str, headers: dict[str, str]) -> dict:  # type: ignore[type-arg]
    text = (FIXTURES / name).read_text("utf-8")
    r = await client.post(
        "/api/v1/messages/analyse", json={"text": text, "channel": "email"}, headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


@pytest.mark.parametrize(
    ("name", "decision", "risk_class"),
    [
        ("scam_portal_otp.txt", "BLOCK", "confirmed_malicious"),
        ("scam_fee_upi.txt", "BLOCK", "confirmed_malicious"),
        ("scam_job_kyc.txt", "BLOCK", "confirmed_malicious"),
        ("legit_fee_reminder.txt", "ALLOW", "low"),
        ("legit_receipt.txt", "ALLOW", "low"),
        ("legit_newsletter.txt", "ALLOW", "low"),
        ("pushy_no_evidence.txt", "REVIEW", "suspicious"),
    ],
)
async def test_fixture_messages_end_to_end(
    app: FastAPI, client: httpx.AsyncClient, name: str, decision: str, risk_class: str
) -> None:
    out = await analyse(client, name, who())
    assert (out["decision"], out["risk_class"]) == (decision, risk_class), out["findings"]
    assert out["narrative"]["source"] == "template" and len(out["narrative"]["sections"]) == 5
    narrative_text = " ".join(c["text"] for s in out["narrative"]["sections"] for c in s["claims"])
    assert " safe" not in narrative_text.lower()
    if decision == "ALLOW":
        assert out["caveat"] == "Absence of evidence is not evidence of safety."
    for link in out["links"]:
        assert link["scan_id"] and link["decision"], link  # assessed by the real pipeline
    async with app.state.session_factory() as db:
        row = await db.get(MessageAnalysis, out["id"])
        assert row is not None and row.decision == decision
        assert len(row.text_sha256) == 64


async def test_portal_scam_link_is_assessed_block_and_cited(client: httpx.AsyncClient) -> None:
    out = await analyse(client, "scam_portal_otp.txt", who())
    assert [link["decision"] for link in out["links"]] == ["BLOCK"]
    codes = {f["code"] for f in out["findings"]}
    assert "MESSAGE_LINK_BLOCKED" in codes and out["simulated"] is True
    links_section = out["narrative"]["sections"][2]
    assert links_section["claims"][0]["refs"] == ["E-1"]


async def test_no_raw_text_or_personal_data_is_stored(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    text = (
        "Hi Jane, Northstar University here. Share the OTP sent to +91 98765 43210 "
        "or email it to jane.private@mail.example within 24 hours."
    )
    r = await client.post("/api/v1/messages/analyse", json={"text": text}, headers=who())
    assert r.status_code == 200
    body = r.text
    assert "jane.private" not in body and "98765 43210" not in body
    async with app.state.session_factory() as db:
        row = await db.get(MessageAnalysis, r.json()["id"])
        assert row is not None
        stored = " ".join(
            str(v) for v in (row.finding_codes, row.link_domains, row.text_sha256, row.channel)
        )
        assert "Jane" not in stored and "98765" not in stored and "OTP" not in stored


async def test_repeat_and_shared_domain_correlation(client: httpx.AsyncClient) -> None:
    unique = f"Northstar University: pay the {uuid.uuid4().hex[:6]} fee to fees@okaxis now."
    first = (
        await client.post("/api/v1/messages/analyse", json={"text": unique}, headers=who())
    ).json()
    second = (
        await client.post("/api/v1/messages/analyse", json={"text": unique.upper()}, headers=who())
    ).json()
    assert first["correlation"]["same_text_count"] == 0
    assert second["correlation"]["same_text_count"] == 1


async def test_validation_and_auth(client: httpx.AsyncClient) -> None:
    assert (await client.post("/api/v1/messages/analyse", json={"text": "hi"})).status_code == 401
    r = await client.post("/api/v1/messages/analyse", json={"text": ""}, headers=who())
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"
    r = await client.post("/api/v1/messages/analyse", json={"text": "x" * 20_001}, headers=who())
    assert r.status_code == 422


async def test_ssrf_link_in_a_message_is_refused_not_scored(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    out = (
        await client.post(
            "/api/v1/messages/analyse",
            json={"text": "Open http://127.0.0.1:8000/admin and http://169.254.169.254/latest"},
            headers=who(),
        )
    ).json()
    assert all(link["decision"] is None and link["error"] for link in out["links"])
    assert out["coverage"]["unavailable"]  # failed checks are unavailable, never clean
    async with app.state.session_factory() as db:
        rows = list(
            (
                await db.execute(select(MessageAnalysis).where(MessageAnalysis.id == out["id"]))
            ).scalars()
        )
        assert rows[0].link_scan_ids == []
