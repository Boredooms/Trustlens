"""Certificate depth, external intelligence and header posture (Workstreams C and D).

Owners: docs/03-backend/CERTIFICATE_ANALYSIS.md and
docs/02-architecture/THREAT_INTELLIGENCE_SOURCES.md.
No network: the feed client runs against httpx.MockTransport and the guard is stubbed.
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.intelligence import feeds
from app.risk.engine import compute_coverage, decide
from app.risk.posture import certificate_report, header_posture
from app.risk.rules import TrustContext, evaluate
from app.schemas.enums import Decision, Intent
from app.services import certificates, guard
from app.services.demo_fixtures import demo_observations
from app.services.observations import IntelObs, Observations

from ..conftest import make_settings


def obs(url: str) -> Observations:
    t = guard.parse_target(url)
    return demo_observations(t.host, t.registrable_domain, t.normalised_url, t.scheme)


def verdict(o: Observations, intent: Intent = Intent.BROWSE):  # type: ignore[no-untyped-def]
    ev = evaluate(o, TrustContext(), intent)
    v = decide(
        ev.findings,
        compute_coverage(ev.coverage),
        intent,
        target_unreachable=ev.target_unreachable,
    )
    return {f.code for f in ev.findings}, v, ev


# ── Certificates ─────────────────────────────────────────────────────────────────
def test_expiring_certificate_is_a_misconfiguration_not_a_trust_failure() -> None:
    o = obs("https://old.northstar-demo.example/")
    codes, _, ev = verdict(o)
    assert "CERT_EXPIRING_SOON" in codes
    report = certificate_report(o.tls, ev.findings, o.scheme)
    assert report["assessment"] == "misconfigured"
    assert {i["category"] for i in report["issues"]} == {"configuration"}
    assert "not evidence that the site is legitimate" in report["note"]


def test_self_signed_is_trust_and_subsumes_chain_unverified() -> None:
    o = obs("https://selfsigned.badhost.example/")
    codes, _, ev = verdict(o)
    assert "CERT_SELF_SIGNED" in codes and "CERT_CHAIN_UNVERIFIED" not in codes
    assert certificate_report(o.tls, ev.findings, o.scheme)["assessment"] == "trust_compromised"
    assert "CERT_NO_EMBEDDED_SCT" not in codes  # only judged for a verified chain


def test_revoked_certificate_is_critical_trust_failure() -> None:
    o = obs("https://revoked.badhost.example/")
    codes, v, ev = verdict(o)
    assert "CERT_REVOKED" in codes
    assert certificate_report(o.tls, ev.findings, o.scheme)["assessment"] == "trust_compromised"
    assert v.decision != Decision.ALLOW  # critical floor


def test_revocation_unavailable_is_never_treated_as_good() -> None:
    o = obs("https://northstar-demo.example/")
    o.tls = dataclasses.replace(o.tls, revocation={"status": "unavailable", "reason": "timeout"})
    codes, _, ev = verdict(o)
    assert "CERT_REVOKED" not in codes
    report = certificate_report(o.tls, ev.findings, o.scheme)
    assert report["revocation"]["status"] == "unavailable"
    assert "never as good" in report["limitations"]


def test_genuine_certificate_is_valid_but_never_called_proof() -> None:
    o = obs("https://northstar-demo.example/")
    codes, _, ev = verdict(o)
    assert not {c for c in codes if c.startswith("CERT_")}
    report = certificate_report(o.tls, ev.findings, o.scheme)
    assert report["assessment"] == "valid" and report["embedded_scts"] == 2


def test_no_embedded_sct_is_low_confidence_low_severity() -> None:
    o = obs("https://northstar-demo.example/")
    o.tls = dataclasses.replace(o.tls, sct_count=0)
    _, _, ev = verdict(o)
    f = next(f for f in ev.findings if f.code == "CERT_NO_EMBEDDED_SCT")
    assert f.severity.value == "low" and float(f.confidence) == 0.5


def _cert(*, days: int = 30) -> x509.Certificate:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test.example")])
    now = datetime.now(UTC)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=days))
        .sign(key, hashes.SHA256())
    )


def test_sct_and_aia_parsing_on_a_bare_certificate() -> None:
    cert = _cert()
    assert certificates.sct_count(cert) == 0
    assert certificates.aia_urls(cert) == ([], [])


def test_unparseable_ocsp_response_is_unavailable() -> None:
    assert certificates.interpret_ocsp(b"not der")["status"] == "unavailable"


async def test_revocation_without_ocsp_url_is_unavailable() -> None:
    async with httpx.AsyncClient() as client:
        out = await certificates.check_revocation(_cert(), client, make_settings())
    assert out["status"] == "unavailable"


# ── External intelligence ────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("overrides", "mode"),
    [
        ({}, "off"),
        ({"demo_mode": True}, "fixture"),
        ({"urlhaus_auth_key": "k"}, "live"),
        ({"intel_mode": "live"}, "off"),  # no key: the source is absent, never faked
        ({"intel_mode": "off", "urlhaus_auth_key": "k"}, "off"),
    ],
)
def test_intel_mode_resolution(overrides: dict[str, object], mode: str) -> None:
    assert feeds.resolve_mode(make_settings(**overrides)) == mode


def test_fixture_hit_is_attributed_and_simulated_and_forces_block() -> None:
    hit = feeds.fixture_lookup("secure-pay.badhost.example")
    assert hit["status"] == "listed" and hit["source_name"] == "URLhaus (abuse.ch)"
    assert hit["mode"] == "fixture" and hit["simulated"] is True
    o = obs("https://secure-pay.badhost.example/")
    o.intel = IntelObs(status="collected", sources=[hit])
    codes, v, ev = verdict(o)
    assert "LISTED_BY_EXTERNAL_FEED" in codes and v.decision == Decision.BLOCK
    assert "O-6" in v.overrides
    finding = next(f for f in ev.findings if f.code == "LISTED_BY_EXTERNAL_FEED")
    assert finding.simulated and finding.observed and finding.observed["listing_id"]


def test_unavailable_intel_adds_no_finding_and_no_pass() -> None:
    o = obs("https://secure-pay.badhost.example/")
    o.intel = IntelObs(
        status="unavailable",
        sources=[feeds._result("secure-pay.badhost.example", "live", "unavailable")],
    )
    codes, _, _ = verdict(o)
    assert "LISTED_BY_EXTERNAL_FEED" not in codes
    assert o.result_blocks()["intel"]["status"] == "unavailable"


def _transport(
    status: int, body: object, headers: dict[str, str] | None = None
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Auth-Key"] == "k"
        assert b"host=evil.example" in request.content
        return httpx.Response(status, json=body, headers=headers)

    return httpx.MockTransport(handler)


@pytest.fixture
def no_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    async def ok(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(feeds.guard, "check_target", ok)


@pytest.mark.usefixtures("no_guard")
@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (
            200,
            {
                "query_status": "ok",
                "urlhaus_reference": "https://urlhaus.abuse.ch/host/evil.example/",
                "url_count": 2,
                "urls": [{"id": 31337, "url_status": "online", "threat": "malware_download"}],
            },
            "listed",
        ),
        (200, {"query_status": "no_results"}, "not_listed"),
        (200, {"query_status": "invalid_host"}, "unavailable"),
        (500, {}, "unavailable"),
    ],
)
async def test_live_urlhaus_responses(status: int, body: object, expected: str) -> None:
    settings = make_settings(urlhaus_auth_key="k")
    async with httpx.AsyncClient(transport=_transport(status, body)) as http:
        out = await feeds.live_lookup("evil.example", settings, http)
    assert out["status"] == expected and out["mode"] == "live"
    if expected == "listed":
        assert out["listing_id"] == "31337" and out["url_status"] == "online"


@pytest.mark.usefixtures("no_guard")
async def test_live_rate_limit_and_timeout_are_unavailable() -> None:
    settings = make_settings(urlhaus_auth_key="k")
    async with httpx.AsyncClient(transport=_transport(429, {}, {"retry-after": "60"})) as http:
        out = await feeds.live_lookup("evil.example", settings, http)
    assert out["status"] == "unavailable" and out["retry_after"] == "60"

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as http:
        out = await feeds.live_lookup("evil.example", settings, http)
    assert out["status"] == "unavailable" and out["reason"] == "ReadTimeout"


# ── Header posture (unscored) ────────────────────────────────────────────────────
def test_lookalike_headers_produce_posture_findings_but_no_score() -> None:
    o = obs("https://apply.northstar-admissions.example/register")
    posture = header_posture(o)
    codes = {f["code"] for f in posture["findings"]}
    assert {"HSTS_MISSING", "CSP_MISSING_OR_WEAK", "SERVER_VERSION_DISCLOSED"} <= codes
    assert "COOKIE_WITHOUT_SECURE_OR_HTTPONLY" in codes
    assert posture["scored"] is False
    for f in posture["findings"]:
        assert (
            f["impact"] and f["remediation"] and "one unauthenticated response" in f["limitations"]
        )
    before = verdict(o)[1].risk_score
    o.page = dataclasses.replace(o.page, response_headers={})
    assert verdict(o)[1].risk_score == before  # headers never move the score


def test_genuine_headers_are_clean_and_cookie_values_never_recorded() -> None:
    o = obs("https://northstar-demo.example/")
    assert header_posture(o)["findings"] == []
    o.page = dataclasses.replace(
        o.page, set_cookies=[{"name": "session", "secure": True, "httponly": False}]
    )
    finding = next(f for f in header_posture(o)["findings"])
    assert finding["evidence"] == {"cookies": ["session"]}


def test_plain_http_site_and_mixed_content() -> None:
    o = obs("https://northstar-demo.example/")
    o.page = dataclasses.replace(o.page, mixed_content=3)
    assert "MIXED_CONTENT" in {f["code"] for f in header_posture(o)["findings"]}
    o.scheme = "http"
    assert "PLAIN_HTTP_SITE" in {f["code"] for f in header_posture(o)["findings"]}


def test_unobserved_headers_are_unavailable_not_clean() -> None:
    o = obs("https://northstar-demo.example/")
    o.page = dataclasses.replace(o.page, response_headers=None)
    o.simulated = False
    assert header_posture(o)["status"] == "unavailable"


# ── Regressions found by the evidence run against real targets (2026-11-09) ──────
def _f(code: str):  # type: ignore[no-untyped-def]
    from decimal import Decimal

    from app.risk.engine import Finding

    return Finding(code=code, confidence=Decimal("1.00"), detail="t")


def test_regression_nxdomain_lookalike_is_unknown_not_allow() -> None:
    """A non-resolving brand lookalike scored 24 → ALLOW: NXDOMAIN was counted as an 'other finding'
    so O-7 never fired, and an unreached target could still be ALLOW."""
    from app.risk.engine import CoverageResult
    from app.schemas.enums import SignalGroup

    cov = CoverageResult(55, (SignalGroup.REPUTATION, SignalGroup.IDENTITY), (), ())
    alone = decide([_f("DOMAIN_NXDOMAIN")], cov, Intent.BROWSE, target_unreachable=True)
    assert alone.decision == Decision.UNKNOWN and "O-7" in alone.overrides
    with_claim = decide(
        [_f("DOMAIN_NXDOMAIN"), _f("DOMAIN_NOT_REGISTERED_BY_BRAND")],
        cov,
        Intent.BROWSE,
        target_unreachable=True,
    )
    # The hostname impersonation is real evidence, so a high enough score may WARN — never ALLOW.
    assert with_claim.decision != Decision.ALLOW
    o = obs("https://ghost.northstar-admissions.example/")
    assert verdict(o)[1].decision == Decision.UNKNOWN


@pytest.mark.parametrize(
    "code", ["CERT_SELF_SIGNED", "CERT_CHAIN_UNVERIFIED", "CERT_HOSTNAME_MISMATCH"]
)
def test_regression_tls_trust_failure_alone_is_review_not_allow(code: str) -> None:
    """A self-signed certificate alone scored 7 → ALLOW; the trust floor (§8.5a) makes it REVIEW."""
    from app.risk.engine import CoverageResult
    from app.schemas.enums import SignalGroup

    cov = CoverageResult(100, tuple(SignalGroup), (), ())
    assert decide([_f(code)], cov, Intent.BROWSE).decision == Decision.REVIEW
    assert verdict(obs("https://selfsigned.badhost.example/"))[1].decision != Decision.ALLOW


async def test_regression_fixture_intel_never_answers_for_real_hosts() -> None:
    """Fixture mode reported 'URLhaus: not_listed' for example.com — a fabricated answer."""
    assert feeds.fixture_lookup("example.com") is None
    settings = make_settings(demo_mode=True)
    async with httpx.AsyncClient() as http:
        out = await feeds.lookup(None, settings, http, ["example.com"])  # type: ignore[arg-type]
    assert out.status == "skipped" and out.sources == []


def test_nat64_target_resolution_is_allowed_when_embedded_ipv4_is_public() -> None:
    from app.security.ssrf import classify_ip

    assert classify_ip("64:ff9b::9765:d115") is None  # 151.101.209.21


def _crl(issuer_key, issuer_name, *, revoked_serial=None, next_update_days=7):  # type: ignore[no-untyped-def]
    now = datetime.now(UTC)
    b = (
        x509.CertificateRevocationListBuilder()
        .issuer_name(issuer_name)
        .last_update(now - timedelta(days=10))
        .next_update(now + timedelta(days=next_update_days))
    )
    if revoked_serial is not None:
        b = b.add_revoked_certificate(
            x509.RevokedCertificateBuilder()
            .serial_number(revoked_serial)
            .revocation_date(now - timedelta(minutes=5))
            .build()
        )
    from cryptography.hazmat.primitives import serialization

    return b.sign(issuer_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)


def _issuer_and_leaf():  # type: ignore[no-untyped-def]
    ikey = ec.generate_private_key(ec.SECP256R1())
    iname = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Issuing CA")])
    now = datetime.now(UTC)
    issuer = (
        x509.CertificateBuilder()
        .subject_name(iname)
        .issuer_name(iname)
        .public_key(ikey.public_key())
        .serial_number(1)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .sign(ikey, hashes.SHA256())
    )
    lkey = ec.generate_private_key(ec.SECP256R1())
    leaf = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "leaf.example")]))
        .issuer_name(iname)
        .public_key(lkey.public_key())
        .serial_number(4242)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .sign(ikey, hashes.SHA256())
    )
    return ikey, iname, issuer, leaf


def test_crl_revoked_good_forged_and_stale() -> None:
    ikey, iname, issuer, leaf = _issuer_and_leaf()
    assert (
        certificates.interpret_crl(_crl(ikey, iname, revoked_serial=4242), leaf, issuer)["status"]
        == "revoked"
    )
    assert certificates.interpret_crl(_crl(ikey, iname), leaf, issuer)["status"] == "good"
    forged = _crl(ec.generate_private_key(ec.SECP256R1()), iname, revoked_serial=None)
    assert certificates.interpret_crl(forged, leaf, issuer)["reason"] == "crl_signature_invalid"
    stale = _crl(ikey, iname, next_update_days=-1)
    assert certificates.interpret_crl(stale, leaf, issuer)["reason"] == "crl_stale"
    assert certificates.interpret_crl(b"junk", leaf, issuer)["status"] == "unavailable"
