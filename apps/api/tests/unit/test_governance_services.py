"""Governance services: domain challenges, audit writer, email (TRUST_PROFILES §4, §7)."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import dns.exception
import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.errors import TargetNotAllowed, ValidationFailed
from app.logging import request_id_var
from app.schemas.governance import MemberInvite, OrganisationCreate, OrganisationUpdate
from app.services import audit, email
from app.services import domain_verification as dv

from ..conftest import make_settings

TOKEN = dv.new_token()
TOKEN_HASH = dv.hash_token(TOKEN)
GOOD = f"tl-verify={TOKEN}"


# ── Tokens and normalisation ────────────────────────────────────────────────────
def test_token_is_32_random_bytes_base32_uppercase_unpadded() -> None:
    assert re.fullmatch(r"[A-Z2-7]{52}", TOKEN)
    assert dv.new_token() != TOKEN
    assert len(TOKEN_HASH) == 64 and TOKEN not in TOKEN_HASH


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Northstar-Demo.Example", "northstar-demo.example"),
        ("northstar.example.", "northstar.example"),
        ("bücher.example", "xn--bcher-kva.example"),
        ("  login.northstar.ac.in ", "login.northstar.ac.in"),
    ],
)
def test_normalise_domain_accepts_bare_hostnames(raw: str, expected: str) -> None:
    assert dv.normalise_domain(raw) == expected


@pytest.mark.parametrize(
    ("raw", "issue"),
    [
        ("https://northstar.example", "bare_domain_required"),
        ("northstar.example/path", "bare_domain_required"),
        ("northstar.example:8443", "bare_domain_required"),
        ("*.northstar.example", "wildcard_not_allowed"),
        ("localhost", "invalid_domain"),
        ("intranet", "invalid_domain"),
        ("10.0.0.1", "ip_literal_not_allowed"),
        ("printer.local", "internal_hostname"),
        ("db.internal", "internal_hostname"),
    ],
)
def test_normalise_domain_rejects(raw: str, issue: str) -> None:
    with pytest.raises(ValidationFailed) as err:
        dv.normalise_domain(raw)
    assert err.value.details == [{"field": "domain", "issue": issue}]


def test_challenges_return_instructions_not_the_hash() -> None:
    expires = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
    dns_c, http_c = dv.challenges("northstar.example", TOKEN, expires)
    assert dns_c == {
        "method": "dns_txt",
        "record_name": "_trustlens-challenge.northstar.example",
        "record_type": "TXT",
        "record_value": GOOD,
        "expires_at": "2026-11-15T09:00:00Z",
    }
    assert http_c["url"] == "https://northstar.example/.well-known/trustlens-verify.txt"
    assert http_c["file_content"] == GOOD
    assert TOKEN_HASH not in str(dns_c) + str(http_c)


# ── Comparison ──────────────────────────────────────────────────────────────────
def test_compare_outcomes() -> None:
    match = dv._compare(["v=spf1 -all", f"  {GOOD}  "], TOKEN_HASH)
    assert match.matched and match.observed == GOOD[:16] and match.observed_hash
    wrong = dv._compare(["tl-verify=SOMETHINGELSE"], TOKEN_HASH)
    assert wrong.outcome == "mismatch" and wrong.observed == "tl-verify=SOMETH"
    assert dv._compare(["v=spf1 -all"], TOKEN_HASH).outcome == "not_found"
    assert dv._compare([], TOKEN_HASH).outcome == "not_found"
    # A lookalike prefix is not a match (exact value only).
    assert dv._compare([f"x{GOOD}"], TOKEN_HASH).outcome == "not_found"


# ── DNS check (stubbed resolver) ────────────────────────────────────────────────
async def test_check_dns_queries_the_exact_challenge_host(monkeypatch: pytest.MonkeyPatch) -> None:
    asked: list[str] = []

    async def fake_txt(name: str) -> list[str]:
        asked.append(name)
        return [GOOD]

    monkeypatch.setattr(dv, "txt_records", fake_txt)
    assert (await dv.check_dns("northstar.example", TOKEN_HASH)).matched
    assert asked == ["_trustlens-challenge.northstar.example"]


async def test_check_dns_failure_modes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def none(name: str) -> list[str]:
        return []

    async def boom(name: str) -> list[str]:
        raise dns.exception.Timeout()

    monkeypatch.setattr(dv, "txt_records", none)
    assert (await dv.check_dns("a.example", TOKEN_HASH)).outcome == "not_found"
    monkeypatch.setattr(dv, "txt_records", boom)
    assert (await dv.check_dns("a.example", TOKEN_HASH)).outcome == "fetch_failed"


# ── HTTP check (guard-respecting stub) ──────────────────────────────────────────
@pytest.mark.parametrize(
    ("status", "body", "outcome"),
    [
        (200, f"{GOOD}\n".encode(), "match"),
        (200, b"tl-verify=NOPE", "mismatch"),
        (200, b"hello", "not_found"),
        (404, b"", "not_found"),
        (301, b"", "not_found"),
        (500, b"", "fetch_failed"),
    ],
)
async def test_check_http_outcomes(
    monkeypatch: pytest.MonkeyPatch, status: int, body: bytes, outcome: str
) -> None:
    fetched: list[str] = []

    async def fake_fetch(url: str) -> tuple[int, bytes]:
        fetched.append(url)
        return status, body

    monkeypatch.setattr(dv, "fetch_file", fake_fetch)
    assert (await dv.check_http("northstar.example", TOKEN_HASH)).outcome == outcome
    assert fetched == ["https://northstar.example/.well-known/trustlens-verify.txt"]


async def test_check_http_network_errors_are_fetch_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def tls_fail(url: str) -> tuple[int, bytes]:
        raise httpx.ConnectError("certificate verify failed")

    monkeypatch.setattr(dv, "fetch_file", tls_fail)
    assert (await dv.check_http("a.example", TOKEN_HASH)).outcome == "fetch_failed"


async def test_fetch_file_goes_through_the_ssrf_guard() -> None:
    # Internal names are refused before any DNS query or connection.
    with pytest.raises(TargetNotAllowed):
        await dv.fetch_file("https://metadata.google.internal/.well-known/trustlens-verify.txt")
    result = await dv.check_http("printer.local", TOKEN_HASH)
    assert result.outcome == "fetch_failed"


async def test_fetch_file_refuses_private_addresses(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import guard

    async def resolve_private(host: str, timeout: float) -> list[str]:
        return ["169.254.169.254"]

    monkeypatch.setattr(guard, "_resolve", resolve_private)
    with pytest.raises(TargetNotAllowed):
        await dv.fetch_file("https://rebind.example/.well-known/trustlens-verify.txt")


async def test_run_check_dispatches(monkeypatch: pytest.MonkeyPatch) -> None:
    async def dns_ok(domain: str, token_hash: str) -> dv.CheckResult:
        return dv.CheckResult("match")

    async def http_ok(domain: str, token_hash: str) -> dv.CheckResult:
        return dv.CheckResult("not_found")

    monkeypatch.setattr(dv, "check_dns", dns_ok)
    monkeypatch.setattr(dv, "check_http", http_ok)
    assert (await dv.run_check("dns_txt", "a.example", TOKEN_HASH)).matched
    assert (await dv.run_check("http_file", "a.example", TOKEN_HASH)).outcome == "not_found"


# ── Audit writer ────────────────────────────────────────────────────────────────
class FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    def add(self, row: Any) -> None:
        self.added.append(row)


def _request(salt: str | None, host: str = "203.0.113.9") -> Any:
    settings = make_settings(ip_hash_salt=salt) if salt else make_settings()
    return SimpleNamespace(
        client=SimpleNamespace(host=host),
        app=SimpleNamespace(state=SimpleNamespace(settings=settings)),
    )


def test_audit_record_redacts_and_stages_without_commit() -> None:
    db = FakeSession()
    principal = SimpleNamespace(kind="user", user=SimpleNamespace(id="01" + "A" * 24))
    token = request_id_var.set("req_test")
    try:
        row = audit.record(
            db,  # type: ignore[arg-type]
            action="org.update",
            principal=principal,  # type: ignore[arg-type]
            target_type="organisation",
            target_id="X",
            organisation_id="X",
            before={"api_key": "tl_live_secret", "name": "Old"},
            after={"note": "card 4111 1111 1111 1111", "name": "New"},
            request=_request("pepper-pepper-pepper"),
        )
    finally:
        request_id_var.reset(token)
    assert db.added == [row]
    assert row.actor_kind == "user" and row.actor_user_id == principal.user.id
    assert row.before == {"api_key": "[redacted]", "name": "Old"}
    assert "4111" not in str(row.after) and row.after["name"] == "New"
    assert row.request_id == "req_test"
    assert row.ip_hash and len(row.ip_hash) == 64 and "203.0.113.9" not in row.ip_hash


def test_audit_record_system_actor_and_no_salt_means_no_ip_hash() -> None:
    db = FakeSession()
    row = audit.record(db, action="demo.seed", request=_request(None))  # type: ignore[arg-type]
    assert row.actor_kind == "system" and row.actor_user_id is None and row.ip_hash is None
    with pytest.raises(ValueError):
        audit.record(db, action="x", actor_kind="robot")  # type: ignore[arg-type]


# ── Email ───────────────────────────────────────────────────────────────────────
MESSAGE = email.invite_message(
    to="new@northstar.example",
    organisation="Northstar <University>",
    inviter="Ada",
    role="org_admin",
    accept_url="https://app.example/invites/abc",
    expires_at="2026-11-15T09:00:00Z",
)


def test_invite_message_escapes_html() -> None:
    assert "Northstar &lt;University&gt;" in MESSAGE.html
    assert "administrator" in MESSAGE.text and "https://app.example/invites/abc" in MESSAGE.text


async def test_email_without_key_logs_in_dev_and_never_in_production() -> None:
    assert await email.send(make_settings(), MESSAGE) == "logged"
    prod = SimpleNamespace(resend_api_key=None, is_production=True, email_from="x")
    assert await email.send(prod, MESSAGE) == "not_configured"  # type: ignore[arg-type]


async def test_email_with_key_posts_to_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200 if len(seen) == 1 else 422, json={"id": "e_1"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        email.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    settings = make_settings(resend_api_key=SecretStr("re_test_key"))
    assert await email.send(settings, MESSAGE) == "email"
    assert seen[0].headers["authorization"] == "Bearer re_test_key"
    assert seen[0].url == httpx.URL(email.RESEND_ENDPOINT)
    assert await email.send(settings, MESSAGE) == "failed"


async def test_email_network_failure_is_reported_not_raised(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        email.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    settings = make_settings(resend_api_key=SecretStr("re_test_key"))
    assert await email.send(settings, MESSAGE) == "failed"


# ── Request schemas ─────────────────────────────────────────────────────────────
def test_org_create_normalises_and_forbids_unknown_fields() -> None:
    body = OrganisationCreate(name="Acme", country="in", sector="Education", support_email="A@B.co")
    assert (body.country, body.sector, body.support_email) == ("IN", "education", "a@b.co")
    with pytest.raises(ValidationError):
        OrganisationCreate(name="Acme", status="active")  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        OrganisationCreate(name="A")
    with pytest.raises(ValidationError):
        OrganisationCreate(name="Acme", support_email="not-an-email")


def test_org_update_validates_tokens_phash_and_status() -> None:
    body = OrganisationUpdate(
        brand_tokens=["Acme", "acme ", "ACME2"], logo_phash="ABCDEF0123456789"
    )
    assert body.brand_tokens == ["acme", "acme2"] and body.logo_phash == "abcdef0123456789"
    for bad in ({"brand_tokens": ["a"]}, {"logo_phash": "xyz"}, {"status": "deleted"}):
        with pytest.raises(ValidationError):
            OrganisationUpdate(**bad)  # type: ignore[arg-type]


def test_member_invite_email_and_role() -> None:
    assert MemberInvite(email=" New@X.Example ").email == "new@x.example"
    with pytest.raises(ValidationError):
        MemberInvite(email="new@x.example", role="owner")  # type: ignore[arg-type]


async def test_txt_records_retries_once_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import dns.resolver

    calls: list[str] = []

    def flaky(self: object, name: str, rtype: str) -> object:
        calls.append(name)
        if len(calls) == 1:
            raise dns.resolver.LifetimeTimeout(timeout=4.0, errors=[])
        raise dns.resolver.NoAnswer()

    monkeypatch.setattr(dns.resolver.Resolver, "resolve", flaky)
    assert await dv.txt_records("_trustlens-challenge.a.example") == []
    assert len(calls) == 2

    def always_slow(self: object, name: str, rtype: str) -> object:
        raise dns.resolver.LifetimeTimeout(timeout=4.0, errors=[])

    monkeypatch.setattr(dns.resolver.Resolver, "resolve", always_slow)
    assert (await dv.check_dns("a.example", TOKEN_HASH)).outcome == "fetch_failed"
