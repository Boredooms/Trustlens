"""Organisation governance end to end against a real Postgres (marker ``db``).

Run: ``TEST_DATABASE_URL=postgresql+asyncpg://.../trustlens_gov pytest -m db`` after
``alembic upgrade head`` on that database. Skipped when TEST_DATABASE_URL is unset.

Covers ORGANISATION_TRUST_PROFILES.md §10 acceptance criteria: challenge required before a domain is
authoritative, exactly one audit row per mutation, cross-tenant 404, last-admin protection, invite
expiry/reuse, and the publish rule.
"""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update

from app.main import create_app
from app.models.tables import AuditLog, DomainVerification, OrganisationInvite
from app.services import domain_verification as dv
from app.utils import utcnow

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set"),
]


def uid() -> str:
    return uuid.uuid4().hex[:10]


def who(name: str, role: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{name}@gov.test:{role}"}


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(database_url=TEST_DB, dev_auth_enabled=True, ip_hash_salt="s" * 32)
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


async def audit_count(app: FastAPI, org_id: str, action: str | None = None) -> int:
    async with app.state.session_factory() as db:
        stmt = select(func.count()).select_from(AuditLog).where(AuditLog.organisation_id == org_id)
        if action:
            stmt = stmt.where(AuditLog.action == action)
        return int((await db.execute(stmt)).scalar_one())


async def new_org(client: httpx.AsyncClient, admin: str, **extra: Any) -> dict[str, Any]:
    r = await client.post(
        "/api/v1/organisations", json={"name": f"Org {uid()}", **extra}, headers=who(admin)
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


def stub_dns(monkeypatch: pytest.MonkeyPatch, records: list[str] | Exception) -> list[str]:
    asked: list[str] = []

    async def fake(name: str) -> list[str]:
        asked.append(name)
        if isinstance(records, Exception):
            raise records
        return records

    monkeypatch.setattr(dv, "txt_records", fake)
    return asked


# ── Organisations ───────────────────────────────────────────────────────────────
async def test_create_org_makes_creator_admin_and_writes_one_audit_row(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    admin = f"admin-{uid()}"
    org = await new_org(client, admin, country="in", sector="education")
    assert org["status"] == "draft" and org["role"] == "org_admin"
    assert org["country"] == "IN" and org["login_hosts_mode"] == "domain_wildcard"
    assert await audit_count(app, org["id"]) == 1
    members = await client.get(f"/api/v1/organisations/{org['id']}/members", headers=who(admin))
    assert [m["role"] for m in members.json()["data"]] == ["org_admin"]
    # Same creator + same name (case-insensitive) is a conflict.
    dup = await client.post(
        "/api/v1/organisations", json={"name": org["name"].upper()}, headers=who(admin)
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "CONFLICT"


async def test_create_org_is_idempotent_with_key(client: httpx.AsyncClient) -> None:
    admin, key = f"idem-{uid()}", f"key-{uid()}"
    body = {"name": f"Idem {uid()}"}
    first = await client.post(
        "/api/v1/organisations", json=body, headers={**who(admin), "Idempotency-Key": key}
    )
    again = await client.post(
        "/api/v1/organisations", json=body, headers={**who(admin), "Idempotency-Key": key}
    )
    assert first.status_code == 201 and again.status_code == 200
    assert again.headers["idempotent-replay"] == "true" and again.json()["id"] == first.json()["id"]


async def test_authorisation_matrix(client: httpx.AsyncClient) -> None:
    admin, stranger = f"a-{uid()}", f"s-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}"
    # Cross-tenant: 404, never 403 (§10.6).
    for method, kwargs in (("GET", {}), ("PATCH", {"json": {"name": "Hijack"}})):
        r = await client.request(method, path, headers=who(stranger), **kwargs)
        assert r.status_code == 404 and r.json()["error"]["code"] == "ORGANISATION_NOT_FOUND"
    r = await client.post(f"{path}/domains", json={"domain": "x.example"}, headers=who(stranger))
    assert r.status_code == 404
    # Analysts can read but not manage.
    analyst = who(f"an-{uid()}", "analyst")
    r = await client.get(path, headers=analyst)
    assert r.status_code == 200 and r.json()["role"] is None
    r = await client.patch(path, json={"name": "Analyst edit"}, headers=analyst)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    # Operators may manage any organisation.
    r = await client.patch(
        path, json={"name": "Operator edit"}, headers=who(f"op-{uid()}", "operator")
    )
    assert r.status_code == 200 and r.json()["name"] == "Operator edit"
    # Unauthenticated: 401.
    assert (await client.get(path)).status_code == 401
    # Not a ULID: 404 (no oracle).
    assert (await client.get("/api/v1/organisations/nope", headers=who(admin))).status_code == 404


async def test_patch_updates_fields_with_one_audit_row(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    admin = f"p-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}"
    r = await client.patch(
        path,
        json={"brand_tokens": ["Acme", "acme"], "login_hosts_mode": "explicit_only"},
        headers=who(admin),
    )
    assert r.status_code == 200
    assert r.json()["brand_tokens"] == ["acme"] and r.json()["login_hosts_mode"] == "explicit_only"
    assert await audit_count(app, org["id"], "org.update") == 1
    # A no-op PATCH writes nothing.
    r = await client.patch(path, json={"login_hosts_mode": "explicit_only"}, headers=who(admin))
    assert r.status_code == 200 and await audit_count(app, org["id"], "org.update") == 1
    bad = await client.patch(path, json={"unknown": 1}, headers=who(admin))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_publish_requires_a_verified_domain(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"pub-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}"
    r = await client.patch(path, json={"status": "active"}, headers=who(admin))
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_VERIFIED_DOMAIN"

    domain = f"pub-{uid()}.example"
    claim = await client.post(f"{path}/domains", json={"domain": domain}, headers=who(admin))
    assert claim.status_code == 201
    # Pending is not enough.
    r = await client.patch(path, json={"status": "active"}, headers=who(admin))
    assert r.status_code == 409
    stub_dns(monkeypatch, [claim.json()["challenges"][0]["record_value"]])
    v = await client.post(
        f"{path}/domains/{claim.json()['id']}/verify",
        json={"method": "dns_txt"},
        headers=who(admin),
    )
    assert v.status_code == 200
    r = await client.patch(path, json={"status": "active"}, headers=who(admin))
    assert r.status_code == 200 and r.json()["status"] == "active"
    assert await audit_count(app, org["id"], "org.publish") == 1
    # Public projection now exists and contains no member data.
    pub = await client.get(f"{path}/public-profile")
    assert pub.status_code == 200 and pub.json()["verified_domains"] == [domain]
    assert "gov.test" not in pub.text
    assert pub.json()["login_hosts_mode"] == "domain_wildcard"
    r = await client.patch(path, json={"login_hosts_mode": "explicit_only"}, headers=who(admin))
    assert r.status_code == 200
    pub = await client.get(f"{path}/public-profile")
    assert pub.json()["login_hosts_mode"] == "explicit_only"
    # Only operators suspend.
    r = await client.patch(path, json={"status": "suspended"}, headers=who(admin))
    assert r.status_code == 403
    r = await client.patch(
        path, json={"status": "suspended"}, headers=who(f"op-{uid()}", "operator")
    )
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert (await client.get(f"{path}/public-profile")).status_code == 404
    r = await client.patch(path, json={"status": "active"}, headers=who(admin))
    assert r.status_code == 403  # lifting a suspension is an operator action


async def test_fintech_publish_needs_operator(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"fin-{uid()}"
    org = await new_org(client, admin, sector="fintech")
    path = f"/api/v1/organisations/{org['id']}"
    claim = (
        await client.post(
            f"{path}/domains", json={"domain": f"fin-{uid()}.example"}, headers=who(admin)
        )
    ).json()
    stub_dns(monkeypatch, [claim["challenges"][0]["record_value"]])
    await client.post(
        f"{path}/domains/{claim['id']}/verify", json={"method": "dns_txt"}, headers=who(admin)
    )
    r = await client.patch(path, json={"status": "active"}, headers=who(admin))
    assert r.status_code == 403
    r = await client.patch(path, json={"status": "active"}, headers=who(f"op-{uid()}", "operator"))
    assert r.status_code == 200


# ── Domains ─────────────────────────────────────────────────────────────────────
async def test_domain_challenge_lifecycle(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"d-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/domains"
    domain = f"Life-{uid()}.Example"
    r = await client.post(path, json={"domain": domain, "kind": "login"}, headers=who(admin))
    assert r.status_code == 201
    body = r.json()
    assert body["domain"] == domain.lower() and body["status"] == "pending"
    assert {c["method"] for c in body["challenges"]} == {"dns_txt", "http_file"}
    value = body["challenges"][0]["record_value"]
    token = value.removeprefix("tl-verify=")
    # Only the hash is stored.
    async with app.state.session_factory() as db:
        stored = (
            (
                await db.execute(
                    select(DomainVerification.token_hash).where(
                        DomainVerification.verified_domain_id == body["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
    assert stored and all(h == dv.hash_token(token) for h in stored) and token not in stored

    verify = f"{path}/{body['id']}/verify"
    asked = stub_dns(monkeypatch, ["tl-verify=WRONGVALUE123456789"])
    r = await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VERIFICATION_TOKEN_MISMATCH"
    assert r.json()["error"]["details"][0]["observed"] == "tl-verify=WRONGV"
    assert asked == [f"_trustlens-challenge.{domain.lower()}"]

    stub_dns(monkeypatch, [])
    r = await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))
    assert r.status_code == 422 and r.json()["error"]["code"] == "VERIFICATION_NOT_FOUND"

    import dns.exception

    stub_dns(monkeypatch, dns.exception.Timeout())
    r = await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))
    assert r.status_code == 502 and r.json()["error"]["code"] == "VERIFICATION_FETCH_FAILED"

    stub_dns(monkeypatch, [value])
    r = await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))
    assert r.status_code == 200, r.text
    ok = r.json()
    assert ok["status"] == "verified" and ok["verification_method"] == "dns_txt"
    assert ok["evidence_id"] and ok["expires_at"] > ok["verified_at"]
    listed = (await client.get(path, headers=who(admin))).json()["data"]
    assert listed[0]["status"] == "verified" and listed[0]["verification_method"] == "dns_txt"
    # Every attempt (mismatch, not found, fetch failure, success) is one audit row.
    assert await audit_count(app, org["id"], "domain.verify") == 4
    assert await audit_count(app, org["id"], "domain.add") == 1


async def test_http_file_method(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = f"h-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/domains"
    body = (
        await client.post(path, json={"domain": f"h-{uid()}.example"}, headers=who(admin))
    ).json()
    http_challenge = next(c for c in body["challenges"] if c["method"] == "http_file")
    fetched: list[str] = []

    async def fake_fetch(url: str) -> tuple[int, bytes]:
        fetched.append(url)
        return 200, http_challenge["file_content"].encode() + b"\n"

    monkeypatch.setattr(dv, "fetch_file", fake_fetch)
    r = await client.post(
        f"{path}/{body['id']}/verify", json={"method": "http_file"}, headers=who(admin)
    )
    assert r.status_code == 200 and r.json()["verification_method"] == "http_file"
    assert fetched == [http_challenge["url"]]


async def test_expired_challenge_is_410(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"e-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/domains"
    body = (
        await client.post(path, json={"domain": f"e-{uid()}.example"}, headers=who(admin))
    ).json()
    async with app.state.session_factory() as db:
        await db.execute(
            update(DomainVerification)
            .where(DomainVerification.verified_domain_id == body["id"])
            .values(expires_at=utcnow() - timedelta(seconds=1))
        )
        await db.commit()
    stub_dns(monkeypatch, [body["challenges"][0]["record_value"]])
    r = await client.post(
        f"{path}/{body['id']}/verify", json={"method": "dns_txt"}, headers=who(admin)
    )
    assert r.status_code == 410 and r.json()["error"]["code"] == "VERIFICATION_EXPIRED"
    # A fresh challenge replaces it; the old value no longer verifies.
    fresh = (await client.post(path, json={"domain": body["domain"]}, headers=who(admin))).json()
    assert fresh["id"] == body["id"]
    assert fresh["challenges"][0]["record_value"] != body["challenges"][0]["record_value"]
    r = await client.post(
        f"{path}/{body['id']}/verify", json={"method": "dns_txt"}, headers=who(admin)
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "VERIFICATION_TOKEN_MISMATCH"


async def test_verification_attempts_are_rate_limited(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"r-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/domains"
    body = (
        await client.post(path, json={"domain": f"r-{uid()}.example"}, headers=who(admin))
    ).json()
    stub_dns(monkeypatch, [])
    verify = f"{path}/{body['id']}/verify"
    codes = [
        (await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))).status_code
        for _ in range(6)
    ]
    assert codes == [422] * 5 + [429]
    r = await client.post(verify, json={"method": "dns_txt"}, headers=who(admin))
    assert r.json()["error"]["code"] == "RATE_LIMITED" and int(r.headers["retry-after"]) > 0


async def test_domain_already_claimed_and_lapsed_claim_takeover(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, rival = f"o-{uid()}", f"rv-{uid()}"
    org_a, org_b = await new_org(client, owner), await new_org(client, rival)
    domain = f"claim-{uid()}.example"
    a_path = f"/api/v1/organisations/{org_a['id']}/domains"
    b_path = f"/api/v1/organisations/{org_b['id']}/domains"
    claim = (await client.post(a_path, json={"domain": domain}, headers=who(owner))).json()
    # An open challenge blocks a rival.
    r = await client.post(b_path, json={"domain": domain}, headers=who(rival))
    assert r.status_code == 409 and r.json()["error"]["code"] == "DOMAIN_ALREADY_CLAIMED"
    # Once the first claim lapses, the rival may claim (it still has to pass the challenge).
    async with app.state.session_factory() as db:
        await db.execute(
            update(DomainVerification)
            .where(DomainVerification.verified_domain_id == claim["id"])
            .values(expires_at=utcnow() - timedelta(seconds=1))
        )
        await db.commit()
    taken = await client.post(b_path, json={"domain": domain}, headers=who(rival))
    assert taken.status_code == 201
    stub_dns(monkeypatch, [taken.json()["challenges"][0]["record_value"]])
    await client.post(
        f"{b_path}/{taken.json()['id']}/verify", json={"method": "dns_txt"}, headers=who(rival)
    )
    # Verified elsewhere: hard 409.
    r = await client.post(a_path, json={"domain": domain}, headers=who(owner))
    assert r.status_code == 409


async def test_member_cannot_manage_domains_and_bad_domain_is_422(
    client: httpx.AsyncClient,
) -> None:
    admin = f"m-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/domains"
    r = await client.post(path, json={"domain": "https://bad.example/x"}, headers=who(admin))
    assert (
        r.status_code == 422 and r.json()["error"]["details"][0]["issue"] == "bare_domain_required"
    )
    r = await client.post(path, json={"domain": "printer.local"}, headers=who(admin))
    assert r.status_code == 422


async def test_revoking_last_domain_unpublishes(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = f"rv-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}"
    claim = (
        await client.post(
            f"{path}/domains", json={"domain": f"rv-{uid()}.example"}, headers=who(admin)
        )
    ).json()
    stub_dns(monkeypatch, [claim["challenges"][0]["record_value"]])
    await client.post(
        f"{path}/domains/{claim['id']}/verify", json={"method": "dns_txt"}, headers=who(admin)
    )
    assert (
        await client.patch(path, json={"status": "active"}, headers=who(admin))
    ).status_code == 200
    r = await client.delete(f"{path}/domains/{claim['id']}", headers=who(admin))
    assert r.status_code == 204
    detail = (await client.get(path, headers=who(admin))).json()
    assert detail["status"] == "draft" and detail["domains"][0]["status"] == "revoked"
    # Idempotent: a second revoke changes nothing and writes nothing.
    assert (
        await client.delete(f"{path}/domains/{claim['id']}", headers=who(admin))
    ).status_code == 204
    assert await audit_count(app, org["id"], "domain.revoke") == 1
    r = await client.post(
        f"{path}/domains/{claim['id']}/verify", json={"method": "dns_txt"}, headers=who(admin)
    )
    assert r.status_code == 409


# ── Recipients ──────────────────────────────────────────────────────────────────
async def test_recipient_attestation_and_revocation(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    admin, analyst = f"ra-{uid()}", who(f"an-{uid()}", "analyst")
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/recipients"
    r = await client.post(
        path, json={"recipient_type": "upi_vpa", "value": "Fees@Acme-Bank"}, headers=who(admin)
    )
    assert r.status_code == 201 and r.json()["status"] == "pending_attestation"
    rid = r.json()["id"]
    dup = await client.post(
        path, json={"recipient_type": "upi_vpa", "value": "fees@acme-bank"}, headers=who(admin)
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "RECIPIENT_ALREADY_EXISTS"
    # Admins cannot attest their own payee; analysts can.
    body = {"action": "verify", "reason": "Bank letter checked by analyst"}
    assert (
        await client.post(f"{path}/{rid}/verify", json=body, headers=who(admin))
    ).status_code == 403
    r = await client.post(f"{path}/{rid}/verify", json=body, headers=analyst)
    assert r.status_code == 200 and r.json()["status"] == "verified"
    again = await client.post(f"{path}/{rid}/verify", json=body, headers=analyst)
    assert again.status_code == 409
    # Revocation by an analyst (abuse response), then re-registration restarts attestation.
    assert (await client.delete(f"{path}/{rid}", headers=analyst)).status_code == 204
    listed = (await client.get(path, headers=who(admin))).json()["data"]
    assert listed[0]["status"] == "revoked"
    r = await client.post(
        path, json={"recipient_type": "upi_vpa", "value": "fees@acme-bank"}, headers=who(admin)
    )
    assert (
        r.status_code == 201
        and r.json()["id"] == rid
        and r.json()["status"] == "pending_attestation"
    )
    actions = {
        a: await audit_count(app, org["id"], a)
        for a in ("recipient.add", "recipient.verify", "recipient.revoke")
    }
    assert actions == {"recipient.add": 2, "recipient.verify": 1, "recipient.revoke": 1}
    # A plain member cannot revoke.
    stranger = await client.delete(f"{path}/{rid}", headers=who(f"x-{uid()}"))
    assert stranger.status_code == 404


# ── Members and invites ─────────────────────────────────────────────────────────
async def invite(
    client: httpx.AsyncClient, org_id: str, admin: str, email: str, role: str = "org_member"
) -> dict[str, Any]:
    r = await client.post(
        f"/api/v1/organisations/{org_id}/members",
        json={"email": email, "role": role},
        headers=who(admin),
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


async def test_invite_accept_flow(app: FastAPI, client: httpx.AsyncClient) -> None:
    admin, newbie = f"ia-{uid()}", f"nb-{uid()}"
    org = await new_org(client, admin)
    inv = await invite(client, org["id"], admin, f"{newbie.upper()}@gov.test")
    assert inv["delivery"] == "logged" and inv["email"] == f"{newbie}@gov.test"
    token = re.search(r"/invites/([^/]+)$", inv["accept_url"]).group(1)  # type: ignore[union-attr]
    listed = (
        await client.get(f"/api/v1/organisations/{org['id']}/members", headers=who(admin))
    ).json()
    assert [i["email"] for i in listed["invites"]] == [f"{newbie}@gov.test"]
    # Wrong account.
    r = await client.post(f"/api/v1/invites/{token}/accept", headers=who(f"other-{uid()}"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "INVITE_EMAIL_MISMATCH"
    r = await client.post(f"/api/v1/invites/{token}/accept", headers=who(newbie))
    assert r.status_code == 200 and r.json() == {
        "organisation_id": org["id"],
        "organisation_name": org["name"],
        "role": "org_member",
    }
    # Single use.
    r = await client.post(f"/api/v1/invites/{token}/accept", headers=who(newbie))
    assert r.status_code == 404 and r.json()["error"]["code"] == "INVITE_NOT_FOUND"
    # The new member can read but not manage.
    path = f"/api/v1/organisations/{org['id']}"
    assert (await client.get(path, headers=who(newbie))).json()["role"] == "org_member"
    assert (
        await client.patch(path, json={"name": "x" * 5}, headers=who(newbie))
    ).status_code == 403
    r = await client.post(f"{path}/members", json={"email": "z@gov.test"}, headers=who(newbie))
    assert r.status_code == 403
    # Members do not see open invites.
    assert (await client.get(f"{path}/members", headers=who(newbie))).json()["invites"] == []
    # Already a member → conflict.
    r = await client.post(
        f"{path}/members", json={"email": f"{newbie}@gov.test"}, headers=who(admin)
    )
    assert r.status_code == 409
    assert await audit_count(app, org["id"], "org.member.invite") == 1
    assert await audit_count(app, org["id"], "org.member.join") == 1


async def test_invite_expiry_reinvite_and_revoke(app: FastAPI, client: httpx.AsyncClient) -> None:
    admin, newbie = f"ie-{uid()}", f"ne-{uid()}"
    org = await new_org(client, admin)
    first = await invite(client, org["id"], admin, f"{newbie}@gov.test")
    second = await invite(client, org["id"], admin, f"{newbie}@gov.test", "org_admin")
    first_token = first["accept_url"].rsplit("/", 1)[1]
    # Re-inviting replaced the first invite.
    r = await client.post(f"/api/v1/invites/{first_token}/accept", headers=who(newbie))
    assert r.status_code == 404
    async with app.state.session_factory() as db:
        await db.execute(
            update(OrganisationInvite)
            .where(OrganisationInvite.id == second["invite_id"])
            .values(expires_at=utcnow() - timedelta(seconds=1))
        )
        await db.commit()
    token = second["accept_url"].rsplit("/", 1)[1]
    r = await client.post(f"/api/v1/invites/{token}/accept", headers=who(newbie))
    assert r.status_code == 410 and r.json()["error"]["code"] == "INVITE_EXPIRED"
    third = await invite(client, org["id"], admin, f"{newbie}@gov.test")
    r = await client.delete(
        f"/api/v1/organisations/{org['id']}/invites/{third['invite_id']}", headers=who(admin)
    )
    assert r.status_code == 204
    token = third["accept_url"].rsplit("/", 1)[1]
    assert (
        await client.post(f"/api/v1/invites/{token}/accept", headers=who(newbie))
    ).status_code == 404
    assert (
        await client.post("/api/v1/invites/short/accept", headers=who(newbie))
    ).status_code == 404


async def test_last_admin_rules(app: FastAPI, client: httpx.AsyncClient) -> None:
    admin, other = f"la-{uid()}", f"lb-{uid()}"
    org = await new_org(client, admin)
    path = f"/api/v1/organisations/{org['id']}/members"
    me = (await client.get(path, headers=who(admin))).json()["data"][0]["user_id"]
    r = await client.patch(f"{path}/{me}", json={"role": "org_member"}, headers=who(admin))
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_ADMIN_REMOVAL"
    r = await client.delete(f"{path}/{me}", headers=who(admin))
    assert r.status_code == 409
    # Transfer ownership: invite, accept, promote, then demote self.
    inv = await invite(client, org["id"], admin, f"{other}@gov.test")
    await client.post(
        f"/api/v1/invites/{inv['accept_url'].rsplit('/', 1)[1]}/accept", headers=who(other)
    )
    other_id = next(
        m["user_id"]
        for m in (await client.get(path, headers=who(admin))).json()["data"]
        if m["email"] == f"{other}@gov.test"
    )
    r = await client.patch(f"{path}/{other_id}", json={"role": "org_admin"}, headers=who(admin))
    assert r.status_code == 200 and r.json()["role"] == "org_admin"
    r = await client.patch(f"{path}/{me}", json={"role": "org_member"}, headers=who(admin))
    assert r.status_code == 200
    # Now a plain member: can leave, cannot manage.
    r = await client.patch(f"{path}/{other_id}", json={"role": "org_member"}, headers=who(admin))
    assert r.status_code == 403
    assert (await client.delete(f"{path}/{me}", headers=who(admin))).status_code == 204
    assert (
        await client.get(f"/api/v1/organisations/{org['id']}", headers=who(admin))
    ).status_code == 404
    unknown = await client.delete(f"{path}/01ARZ3NDEKTSV4RRFFQ69G5FAV", headers=who(other))
    assert unknown.status_code == 404
    assert await audit_count(app, org["id"], "org.member.role") == 2
    assert await audit_count(app, org["id"], "org.member.remove") == 1


# ── Audit logs ──────────────────────────────────────────────────────────────────
async def test_audit_logs_are_operator_only_filterable_and_paginated(
    client: httpx.AsyncClient,
) -> None:
    admin = f"au-{uid()}"
    org = await new_org(client, admin)
    for i in range(3):
        await client.patch(
            f"/api/v1/organisations/{org['id']}",
            json={"name": f"Renamed {i} {uid()}"},
            headers=who(admin),
        )
    assert (await client.get("/api/v1/audit-logs", headers=who(admin))).status_code == 403
    assert (
        await client.get("/api/v1/audit-logs", headers=who(admin, "analyst"))
    ).status_code == 403
    assert (await client.get("/api/v1/audit-logs")).status_code == 401
    op = who(f"op-{uid()}", "operator")
    r = await client.get(
        "/api/v1/audit-logs", params={"organisation_id": org["id"], "limit": 2}, headers=op
    )
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    page1 = r.json()
    assert len(page1["data"]) == 2 and page1["page"]["next_cursor"]
    assert page1["data"][0]["actor_email"] == f"{admin}@gov.test"
    assert "ip_hash" not in page1["data"][0]
    r = await client.get(
        "/api/v1/audit-logs",
        params={"organisation_id": org["id"], "limit": 2, "cursor": page1["page"]["next_cursor"]},
        headers=op,
    )
    page2 = r.json()
    assert len(page2["data"]) == 2 and page2["page"]["next_cursor"] is None
    ids = [row["id"] for row in page1["data"] + page2["data"]]
    assert len(set(ids)) == 4 and ids == sorted(ids, reverse=True)
    family = await client.get(
        "/api/v1/audit-logs", params={"organisation_id": org["id"], "action": "org."}, headers=op
    )
    assert {row["action"] for row in family.json()["data"]} == {"org.create", "org.update"}
    exact = await client.get(
        "/api/v1/audit-logs",
        params={"organisation_id": org["id"], "action": "org.create"},
        headers=op,
    )
    assert len(exact.json()["data"]) == 1
    bad = await client.get("/api/v1/audit-logs", params={"cursor": "nope"}, headers=op)
    assert bad.status_code == 422
