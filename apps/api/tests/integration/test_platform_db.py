"""Platform features end to end against a real Postgres (marker ``db``).

Run: ``TEST_DATABASE_URL=postgresql+asyncpg://.../trustlens_plat pytest -m db`` after
``alembic upgrade head`` on that database. Skipped when TEST_DATABASE_URL is unset.

Covers appeals (J10, BR-006), certificate monitors and detail, usage metering, the QStash jobs,
inspect-redirect, the append-only audit trigger and row-level security (DATABASE_DESIGN §13.3).
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from jose import jwt
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError

from app.main import create_app
from app.models.tables import (
    Appeal,
    AuditLog,
    Certificate,
    CertificateMonitor,
    Entity,
    Organisation,
    OrganisationMember,
    PairingCode,
    Scan,
    ThreatReport,
    User,
    VerifiedDomain,
)
from app.security import qstash
from app.services import domain_verification as dv
from app.services import guard, jobs
from app.services.observations import TlsObs
from app.utils import new_ulid, utcnow

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set"),
]
SIGNING_KEY = "sig_platform_test_key"


def uid() -> str:
    return uuid.uuid4().hex[:10]


def who(name: str, role: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{name}@plat.test:{role}"}


def signed(job: str, body: bytes = b"{}") -> dict[str, str]:
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": "Upstash",
            "sub": f"http://testserver/internal/jobs/{job}",
            "exp": now + 300,
            "nbf": now,
            "iat": now,
            "body": qstash.body_hash(body),
        },
        SIGNING_KEY,
        algorithm="HS256",
    )
    return {"Upstash-Signature": token}


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
            qstash_current_signing_key=SIGNING_KEY,
        )
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


async def user_id(client: httpx.AsyncClient, headers: dict[str, str]) -> str:
    r = await client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


async def make_org(app: FastAPI, admin_id: str, domain: str, member_id: str | None = None) -> str:
    async with app.state.session_factory() as db:
        org = Organisation(id=new_ulid(), name=f"Plat {uid()}", status="active")
        db.add(org)
        await db.flush()
        db.add(
            OrganisationMember(
                id=new_ulid(), organisation_id=org.id, user_id=admin_id, role="org_admin"
            )
        )
        if member_id:
            db.add(
                OrganisationMember(
                    id=new_ulid(), organisation_id=org.id, user_id=member_id, role="org_member"
                )
            )
        db.add(
            VerifiedDomain(
                id=new_ulid(),
                organisation_id=org.id,
                domain=domain,
                status="verified",
                verified_at=utcnow(),
            )
        )
        await db.commit()
        return org.id


async def audit_actions(app: FastAPI, target_id: str) -> list[str]:
    async with app.state.session_factory() as db:
        rows = await db.execute(
            select(AuditLog.action).where(AuditLog.target_id == target_id).order_by(AuditLog.id)
        )
        return list(rows.scalars())


# ── Appeals ─────────────────────────────────────────────────────────────────────
async def seed_threat_domain(app: FastAPI, domain: str, score: int) -> tuple[str, str]:
    async with app.state.session_factory() as db:
        now = utcnow()
        entity = Entity(
            id=new_ulid(),
            type="domain",
            key=f"domain:{domain}",
            label=domain,
            reputation_score=score,
            attributes={"confirmed_threat": True},
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(entity)
        report = ThreatReport(
            id=new_ulid(),
            reporter_channel="web",
            url=f"https://{domain}/pay",
            normalised_url=f"https://{domain}/pay",
            entity_id=entity.id,
            justification="This page asked me for a fee to a personal account.",
        )
        db.add(report)
        await db.commit()
        return entity.id, report.id


async def test_appeal_full_flow(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    domain = f"owner-{uid()}.com"
    entity_id, report_id = await seed_threat_domain(app, domain, -40)
    created = await client.post(
        "/api/v1/appeals",
        json={
            "domain": domain.upper(),
            "email": "Admin@Owner.com",
            "message": "This is our official admissions site.",
            "challenge_method": "dns_txt",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    appeal_id, challenge = body["appeal_id"], body["challenge"]
    assert body["status"] == "pending_challenge"
    assert challenge["record_name"] == f"_trustlens-challenge.{domain}"
    assert challenge["record_type"] == "TXT" and challenge["record_value"].startswith("tl-verify=")

    # The queue is analyst-only; the appeal changes nothing yet (BR-006).
    assert (await client.get("/api/v1/appeals", headers=who(f"u-{uid()}"))).status_code == 403
    async with app.state.session_factory() as db:
        assert (await db.get(Entity, entity_id)).reputation_score == -40  # type: ignore[union-attr]

    records: list[str] = ["tl-verify=WRONG"]

    async def fake_txt(name: str) -> list[str]:
        assert name == challenge["record_name"]
        return records

    monkeypatch.setattr(dv, "txt_records", fake_txt)
    wrong = await client.post(f"/api/v1/appeals/{appeal_id}/verify")
    assert (
        wrong.status_code == 422 and wrong.json()["error"]["code"] == "VERIFICATION_TOKEN_MISMATCH"
    )
    records[:] = []
    missing = await client.post(f"/api/v1/appeals/{appeal_id}/verify")
    assert missing.json()["error"]["code"] == "VERIFICATION_NOT_FOUND"
    records[:] = [challenge["record_value"]]
    ok = await client.post(f"/api/v1/appeals/{appeal_id}/verify")
    assert ok.status_code == 200 and ok.json()["verified"] is True
    assert ok.json()["status"] == "challenge_verified" and ok.json()["attempts"] == 3
    again = await client.post(f"/api/v1/appeals/{appeal_id}/verify")
    assert again.status_code == 200 and again.json()["verified"] is True

    analyst = who(f"an-{uid()}", "analyst")
    queue = await client.get(
        "/api/v1/appeals",
        params={"status": "challenge_verified", "domain": domain},
        headers=analyst,
    )
    assert [a["id"] for a in queue.json()["data"]] == [appeal_id]
    detail = queue.json()["data"][0]
    assert detail["email"] == "admin@owner.com" and detail["open_reports"] == 1
    assert detail["current_reputation"] == -40

    approved = await client.post(
        f"/api/v1/appeals/{appeal_id}/review",
        json={"action": "approve", "reason": "Owner proved control; reports were mistaken."},
        headers=analyst,
    )
    assert approved.status_code == 200, approved.text
    out = approved.json()
    assert out["status"] == "approved" and out["open_reports"] == 0
    assert out["review"]["reputation_before"] == -40 and out["review"]["reputation_after"] == -10
    async with app.state.session_factory() as db:
        entity = await db.get(Entity, entity_id)
        report = await db.get(ThreatReport, report_id)
        assert entity is not None and entity.reputation_score == -10
        assert entity.attributes.get("confirmed_threat") is True  # only cleared at 0
        assert report is not None and report.status == "dismissed"
        assert report.review_reason and appeal_id in report.review_reason

    twice = await client.post(
        f"/api/v1/appeals/{appeal_id}/review",
        json={"action": "reject", "reason": "Trying to review a second time."},
        headers=analyst,
    )
    assert twice.status_code == 409 and twice.json()["error"]["code"] == "APPEAL_ALREADY_REVIEWED"
    assert await audit_actions(app, appeal_id) == [
        "appeal.create",
        "appeal.challenge_verified",
        "appeal.review",
    ]


async def test_appeal_needs_verified_challenge_and_expires(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    domain = f"pending-{uid()}.com"
    made = await client.post(
        "/api/v1/appeals",
        json={"domain": domain, "email": "a@b.co", "message": "Please review our site again."},
    )
    appeal_id = made.json()["appeal_id"]
    analyst = who(f"an-{uid()}", "analyst")
    early = await client.post(
        f"/api/v1/appeals/{appeal_id}/review",
        json={"action": "approve", "reason": "Approving without a challenge."},
        headers=analyst,
    )
    assert early.status_code == 409 and early.json()["error"]["code"] == "APPEAL_NOT_VERIFIED"
    async with app.state.session_factory() as db:
        await db.execute(
            update(Appeal)
            .where(Appeal.id == appeal_id)
            .values(challenge_expires_at=utcnow() - timedelta(minutes=1))
        )
        await db.commit()
    expired = await client.post(f"/api/v1/appeals/{appeal_id}/verify")
    assert expired.status_code == 410 and expired.json()["error"]["code"] == "VERIFICATION_EXPIRED"
    rejected = await client.post(
        f"/api/v1/appeals/{appeal_id}/review",
        json={"action": "reject", "reason": "Challenge expired without proof."},
        headers=analyst,
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    unknown = await client.post(f"/api/v1/appeals/{new_ulid()}/verify")
    assert unknown.status_code == 404


async def test_appeal_open_limit_per_domain(client: httpx.AsyncClient) -> None:
    domain = f"busy-{uid()}.com"
    body = {"domain": domain, "email": "a@b.co", "message": "Please review our site again."}
    for _ in range(3):
        assert (await client.post("/api/v1/appeals", json=body)).status_code == 201
    over = await client.post("/api/v1/appeals", json=body)
    assert over.status_code == 409
    internal = await client.post("/api/v1/appeals", json={**body, "domain": "localhost"})
    assert internal.status_code == 422


# ── Certificate monitors ────────────────────────────────────────────────────────
async def test_monitor_lifecycle_and_authorisation(app: FastAPI, client: httpx.AsyncClient) -> None:
    admin, member, outsider = who(f"adm-{uid()}"), who(f"mem-{uid()}"), who(f"out-{uid()}")
    root = f"acme-{uid()}.test"
    org_id = await make_org(
        app, await user_id(client, admin), root, member_id=await user_id(client, member)
    )
    created = await client.post(
        "/api/v1/certificates/monitors",
        json={"organisation_id": org_id, "domain": f"WWW.{root}"},
        headers=admin,
    )
    assert created.status_code == 201, created.text
    monitor = created.json()
    # .test never resolves: the first check fails softly and the sweep retries later.
    assert monitor["domain"] == f"www.{root}" and monitor["current_certificate_id"] is None
    dup = await client.post(
        "/api/v1/certificates/monitors",
        json={"organisation_id": org_id, "domain": f"www.{root}"},
        headers=admin,
    )
    assert dup.status_code == 409
    foreign = await client.post(
        "/api/v1/certificates/monitors",
        json={"organisation_id": org_id, "domain": "example.org"},
        headers=admin,
    )
    assert foreign.status_code == 409 and foreign.json()["error"]["code"] == "DOMAIN_NOT_VERIFIED"
    as_member = await client.post(
        "/api/v1/certificates/monitors",
        json={"organisation_id": org_id, "domain": f"api.{root}"},
        headers=member,
    )
    assert as_member.status_code == 403
    as_outsider = await client.post(
        "/api/v1/certificates/monitors",
        json={"organisation_id": org_id, "domain": f"api.{root}"},
        headers=outsider,
    )
    assert as_outsider.status_code == 404

    def ids(r: httpx.Response) -> set[str]:
        return {m["id"] for m in r.json()["data"]}

    params = {"organisation_id": org_id}
    assert monitor["id"] in ids(
        await client.get("/api/v1/certificates/monitors", params=params, headers=member)
    )
    assert monitor["id"] not in ids(
        await client.get("/api/v1/certificates/monitors", params=params, headers=outsider)
    )
    assert (
        await client.delete(f"/api/v1/certificates/monitors/{monitor['id']}", headers=outsider)
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/certificates/monitors/{monitor['id']}", headers=member)
    ).status_code == 403
    gone = await client.delete(f"/api/v1/certificates/monitors/{monitor['id']}", headers=admin)
    assert gone.status_code == 204
    assert await audit_actions(app, monitor["id"]) == [
        "certificate_monitor.create",
        "certificate_monitor.delete",
    ]


async def test_certificate_detail(app: FastAPI, client: httpx.AsyncClient) -> None:
    admin = who(f"adm-{uid()}")
    root = f"cert-{uid()}.test"
    org_id = await make_org(app, await user_id(client, admin), root)
    now = utcnow()
    async with app.state.session_factory() as db:
        cert = Certificate(
            id=new_ulid(),
            fingerprint_sha256=uuid.uuid4().hex * 2,
            subject_cn=root,
            issuer_cn="Test CA",
            sans=[root],
            not_before=now - timedelta(days=10),
            not_after=now + timedelta(days=20),
            key_type="EC",
            signature_algorithm="sha256",
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(cert)
        await db.flush()
        db.add(
            CertificateMonitor(
                id=new_ulid(), organisation_id=org_id, domain=root, current_certificate_id=cert.id
            )
        )
        await db.commit()
    r = await client.get(f"/api/v1/certificates/{cert.id}", headers=admin)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["days_to_expiry"] in (19, 20) and out["monitored_domain"] == root
    assert [m["domain"] for m in out["monitors"]] == [root] and out["first_seen_at"]
    outsider = await client.get(f"/api/v1/certificates/{cert.id}", headers=who(f"o-{uid()}"))
    assert outsider.status_code == 200 and outsider.json()["monitors"] == []
    assert (
        await client.get(f"/api/v1/certificates/{new_ulid()}", headers=admin)
    ).status_code == 404
    # Static routes still win over the id route.
    assert (await client.get("/api/v1/certificates/monitors", headers=admin)).status_code == 200


# ── Usage ───────────────────────────────────────────────────────────────────────
async def test_usage_is_metered_per_actor(client: httpx.AsyncClient) -> None:
    me = who(f"use-{uid()}")
    for _ in range(2):
        r = await client.post(
            "/api/v1/verify-identity", json={"domain": "nobody-claims.test"}, headers=me
        )
        assert r.status_code == 200, r.text
    usage = await client.get("/api/v1/usage", headers=me)
    assert usage.status_code == 200
    rows = usage.json()["data"]
    assert [(r["endpoint_group"], r["count"]) for r in rows] == [("verify", 2)]
    assert rows[0]["day"] == utcnow().date().isoformat()
    grouped = await client.get("/api/v1/usage", params={"group_by": "endpoint_group"}, headers=me)
    assert grouped.json()["data"] == [{"day": None, "endpoint_group": "verify", "count": 2}]
    other = await client.get("/api/v1/usage", headers=who(f"other-{uid()}"))
    assert other.json()["data"] == []
    bad = await client.get(
        "/api/v1/usage", params={"from": "2026-02-01", "to": "2026-01-01"}, headers=me
    )
    assert bad.status_code == 422
    assert (
        await client.get("/api/v1/usage", params={"key_id": new_ulid()}, headers=me)
    ).status_code == 404
    assert set(usage.json()["quota"]) == {"limit", "used", "reset_at"}


# ── inspect-redirect over HTTP ──────────────────────────────────────────────────
async def test_inspect_redirect_blocks_private_target(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/api/v1/inspect-redirect",
        json={"url": "http://10.0.0.5/login", "max_hops": 3},
        headers=who(f"insp-{uid()}"),
    )
    assert r.status_code == 200, r.text
    assert r.json()["blocked_hop"] == {"url": "http://10.0.0.5/login", "reason": "private_range"}
    bad = await client.post(
        "/api/v1/inspect-redirect",
        json={"url": "https://x.test", "max_hops": 11},
        headers=who(f"insp-{uid()}"),
    )
    assert bad.status_code == 422


# ── Jobs ────────────────────────────────────────────────────────────────────────
async def test_jobs_reconcile_keepalive_and_operator_trigger(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    # Startup maintenance sweeps stale scans in the background (main.py). Let it finish first, or it
    # can race this test and fail the row as STALE_ON_STARTUP before the job under test sees it.
    pending = list(app.state.runtime.background_tasks)
    if pending:
        await asyncio.wait(pending, timeout=30)
    async with app.state.session_factory() as db:
        stale = Scan(
            id=new_ulid(),
            url="https://stale.test/",
            normalised_url="https://stale.test/",
            registrable_domain="stale.test",
            intent="browse",
            status="running",
            created_at=utcnow() - timedelta(minutes=30),
        )
        db.add(stale)
        await db.commit()
    r = await client.post(
        "/internal/jobs/reconcile-scans", content=b"{}", headers=signed("reconcile-scans")
    )
    assert r.status_code == 200 and r.json()["result"]["failed_stale_scans"] >= 1
    async with app.state.session_factory() as db:
        row = await db.get(Scan, stale.id)
        assert row is not None and row.status == "failed" and row.failure_code == "STALE_RECONCILED"
    alive = await client.post(
        "/internal/jobs/keepalive", content=b"{}", headers=signed("keepalive")
    )
    assert alive.json()["result"] == {"database": "ok"}
    # Operator manual trigger works; a plain user is refused.
    assert (
        await client.post("/internal/jobs/keepalive", headers=who(f"op-{uid()}", "operator"))
    ).status_code == 200
    assert (
        await client.post("/internal/jobs/keepalive", headers=who(f"u-{uid()}"))
    ).status_code == 403


async def test_reputation_decay_steps_once_per_week(app: FastAPI) -> None:
    now = utcnow()
    async with app.state.session_factory() as db:
        due = Entity(
            id=new_ulid(),
            type="domain",
            key=f"domain:decay-{uid()}.test",
            label="d",
            reputation_score=-10,
            attributes={"last_decay_at": (now - timedelta(days=8)).isoformat()},
            first_seen_at=now,
            last_seen_at=now,
        )
        fresh = Entity(
            id=new_ulid(),
            type="domain",
            key=f"domain:fresh-{uid()}.test",
            label="f",
            reputation_score=-10,
            attributes={"last_decay_at": now.isoformat()},
            first_seen_at=now,
            last_seen_at=now,
        )
        manual = Entity(
            id=new_ulid(),
            type="domain",
            key=f"domain:manual-{uid()}.test",
            label="m",
            reputation_score=-100,
            attributes={
                "manual_block": True,
                "last_decay_at": (now - timedelta(days=30)).isoformat(),
            },
            first_seen_at=now,
            last_seen_at=now,
        )
        old = Entity(
            id=new_ulid(),
            type="domain",
            key=f"domain:old-{uid()}.test",
            label="o",
            reputation_score=-45,
            attributes={"last_decay_at": now.isoformat()},
            first_seen_at=now - timedelta(days=200),
            last_seen_at=now - timedelta(days=100),
        )
        db.add_all([due, fresh, manual, old])
        await db.commit()
    await jobs.reputation_decay(app.state.session_factory, app.state.settings)
    await jobs.reputation_decay(app.state.session_factory, app.state.settings)  # idempotent
    async with app.state.session_factory() as db:
        scores = {
            e.id: e.reputation_score
            for e in (
                await db.execute(
                    select(Entity).where(Entity.id.in_([due.id, fresh.id, manual.id, old.id]))
                )
            ).scalars()
        }
    assert scores == {due.id: -8, fresh.id: -10, manual.id: -100, old.id: -22}


async def test_retention_and_append_only_audit(app: FastAPI, client: httpx.AsyncClient) -> None:
    me = who(f"ret-{uid()}")
    owner = await user_id(client, me)
    old_time = utcnow() - timedelta(days=400)
    async with app.state.session_factory() as db:
        code = PairingCode(
            id=new_ulid(),
            user_id=owner,
            code_hash=uuid.uuid4().hex * 2,
            expires_at=utcnow() - timedelta(days=2),
            created_at=utcnow() - timedelta(days=2),
        )
        old_audit = AuditLog(
            id=new_ulid(), actor_kind="system", action="test.old", created_at=old_time
        )
        new_audit = AuditLog(id=new_ulid(), actor_kind="system", action="test.new")
        db.add_all([code, old_audit, new_audit])
        await db.commit()
    # Application code cannot delete or edit audit rows.
    async with app.state.session_factory() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("DELETE FROM audit_logs WHERE id = :i"), {"i": new_audit.id})
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text("UPDATE audit_logs SET action = 'x' WHERE id = :i"), {"i": new_audit.id}
            )
        await db.rollback()
    r = await client.post("/internal/jobs/retention", content=b"{}", headers=signed("retention"))
    assert r.status_code == 200, r.text
    assert r.json()["result"]["audit_logs"] >= 1 and r.json()["result"]["pairing_codes"] >= 1
    async with app.state.session_factory() as db:
        assert await db.get(AuditLog, old_audit.id) is None
        assert await db.get(AuditLog, new_audit.id) is not None
        assert await db.get(PairingCode, code.id) is None


async def test_deleting_a_user_nulls_audit_actor(app: FastAPI) -> None:
    async with app.state.session_factory() as db:
        user = User(
            id=new_ulid(),
            clerk_user_id=f"tmp_{uid()}",
            email=f"{uid()}@x.test",
            display_name="Temp",
            role="user",
        )
        db.add(user)
        await db.flush()
        row_id = new_ulid()
        db.add(AuditLog(id=row_id, actor_user_id=user.id, actor_kind="user", action="t"))
        await db.commit()
        await db.delete(user)
        await db.commit()
        refreshed = (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.id == row_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert refreshed.actor_user_id is None and refreshed.action == "t"


async def test_cert_sweep_detects_change_and_skips_simulated(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = who(f"sw-{uid()}")
    root = f"sweep-{uid()}.test"
    org_id = await make_org(app, await user_id(client, admin), root)
    now = utcnow()
    async with app.state.session_factory() as db:

        def cert(simulated: bool) -> Certificate:
            return Certificate(
                id=new_ulid(),
                fingerprint_sha256=uuid.uuid4().hex * 2,
                issuer_cn="Old CA",
                not_before=now,
                not_after=now + timedelta(days=5),
                key_type="EC",
                signature_algorithm="sha256",
                first_seen_at=now,
                last_seen_at=now,
                simulated=simulated,
            )

        live_cert, sim_cert = cert(False), cert(True)
        db.add_all([live_cert, sim_cert])
        await db.flush()
        live = CertificateMonitor(
            id=new_ulid(), organisation_id=org_id, domain=root, current_certificate_id=live_cert.id
        )
        sim = CertificateMonitor(
            id=new_ulid(),
            organisation_id=org_id,
            domain=f"sim.{root}",
            current_certificate_id=sim_cert.id,
        )
        db.add_all([live, sim])
        await db.commit()

    async def fake_check(url: str, **_: Any) -> guard.Target:
        return guard.parse_target(url)

    new_fp = uuid.uuid4().hex * 2
    probed: list[str] = []

    async def fake_probe(target: guard.Target, settings: Any) -> TlsObs:
        probed.append(target.host)
        if target.host != root:
            return TlsObs(status="unavailable")
        return TlsObs(
            status="collected",
            presented=True,
            verified=True,
            issuer_cn="New CA",
            subject_cn=root,
            sans=[root],
            fingerprint_sha256=new_fp,
            key_type="RSA",
            key_bits=2048,
            signature_algorithm="sha256",
            not_before=now.isoformat(),
            not_after=(now + timedelta(days=80)).isoformat(),
        )

    monkeypatch.setattr(guard, "check_target", fake_check)
    result = await jobs.cert_sweep(app.state.session_factory, app.state.settings, probe=fake_probe)
    assert root in probed and f"sim.{root}" not in probed
    assert result["changed"] >= 1 and result["skipped_simulated"] >= 1
    async with app.state.session_factory() as db:
        live_row = await db.get(CertificateMonitor, live.id)
        sim_row = await db.get(CertificateMonitor, sim.id)
        assert live_row is not None and sim_row is not None
        assert live_row.current_certificate_id != live_cert.id and live_row.last_checked_at
        assert sim_row.current_certificate_id == sim_cert.id
        new_cert = await db.get(Certificate, live_row.current_certificate_id)
        assert new_cert is not None and new_cert.issuer_cn == "New CA"
        assert (new_cert.not_after - now).days in (79, 80)
        changed = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "certificate.changed", AuditLog.target_id == live.id
                )
            )
        ).scalar_one()
        assert changed.actor_kind == "system"
        assert changed.before == {"certificate_id": live_cert.id}
        assert changed.after == {"certificate_id": new_cert.id}


# ── Row-level security (DATABASE_DESIGN.md §13.3) ───────────────────────────────
async def test_rls_fails_closed_and_isolates_tenants(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    alice_h, bob_h = who(f"alice-{uid()}"), who(f"bob-{uid()}")
    alice, bob = await user_id(client, alice_h), await user_id(client, bob_h)
    org_id = await make_org(app, alice, f"rls-{uid()}.test")
    async with app.state.session_factory() as db:
        await db.execute(
            text(
                "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tl_rls_probe') "
                "THEN CREATE ROLE tl_rls_probe NOLOGIN; END IF; END $$"
            )
        )
        await db.execute(text("GRANT SELECT ON ALL TABLES IN SCHEMA public TO tl_rls_probe"))
        await db.execute(text("GRANT EXECUTE ON FUNCTION app_member_org_ids() TO tl_rls_probe"))
        await db.commit()

    async def as_probe(user: str | None, sql: str, **params: str) -> int:
        async with app.state.session_factory() as db:
            await db.execute(text("SET LOCAL ROLE tl_rls_probe"))
            if user is not None:
                await db.execute(
                    text("SELECT set_config('app.current_user_id', :u, true)"), {"u": user}
                )
            count = int((await db.execute(text(sql), params)).scalar_one())
            await db.rollback()
            return count

    # Fail closed: no setting -> nothing, even though rows exist.
    assert await as_probe(None, "SELECT count(*) FROM users") == 0
    assert await as_probe(None, "SELECT count(*) FROM organisations") == 0
    assert await as_probe(None, "SELECT count(*) FROM entities") == 0
    # Tenant isolation.
    assert await as_probe(alice, "SELECT count(*) FROM users") == 1
    assert await as_probe(alice, "SELECT count(*) FROM organisations WHERE id = :o", o=org_id) == 1
    assert await as_probe(bob, "SELECT count(*) FROM organisations WHERE id = :o", o=org_id) == 0
    assert await as_probe(bob, "SELECT count(*) FROM organisation_members") == 0
    # Global intelligence is deny-all for non-owners.
    assert await as_probe(alice, "SELECT count(*) FROM entities") == 0
    # The API (table owner) is unaffected.
    async with app.state.session_factory() as db:
        assert (await db.execute(text("SELECT count(*) FROM users"))).scalar_one() >= 2
