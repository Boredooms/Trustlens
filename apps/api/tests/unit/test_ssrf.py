"""SSRF policy (SECURITY_THREAT_MODEL.md §4): every blocked address class, URL validation, DNS."""

from __future__ import annotations

import pytest

from app.errors import DomainError
from app.schemas.enums import ErrorCode
from app.security.ssrf import classify_hostname, classify_ip
from app.services import guard


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "203.0.113.10",
    ],
)
def test_blocked_addresses(address: str) -> None:
    assert classify_ip(address) is not None


@pytest.mark.parametrize("address", ["8.8.8.8", "2606:4700:4700::1111"])
def test_public_addresses_allowed(address: str) -> None:
    assert classify_ip(address) is None


def test_metadata_address_named() -> None:
    assert classify_ip("169.254.169.254") == "metadata_address"


def test_ipv4_mapped_reports_inner_class() -> None:
    assert classify_ip("::ffff:127.0.0.1") == "loopback"


@pytest.mark.parametrize(
    "host",
    ["localhost", "foo.localhost", "x.internal", "x.local", "metadata.google.internal", "intranet"],
)
def test_internal_hostnames_blocked(host: str) -> None:
    assert classify_hostname(host) == "internal_name"


def test_public_hostname_allowed() -> None:
    assert classify_hostname("www.example.com") is None


def _code(url: str) -> str:
    with pytest.raises(DomainError) as excinfo:
        guard.parse_target(url)
    return str(excinfo.value.code)


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x"]
)
def test_unsupported_schemes(url: str) -> None:
    assert _code(url) == ErrorCode.UNSUPPORTED_SCHEME


def test_credentials_in_url_rejected() -> None:
    assert _code("https://user:pass@example.com/") == ErrorCode.URL_HAS_CREDENTIALS


def test_port_outside_allowlist_rejected() -> None:
    assert _code("http://example.com:22/") == ErrorCode.UNSUPPORTED_PORT


@pytest.mark.parametrize("url", ["", "not a url", "http://", "https://" + "a" * 2100 + ".com"])
def test_invalid_urls(url: str) -> None:
    assert _code(url) == ErrorCode.INVALID_URL


def test_idn_is_punycoded() -> None:
    target = guard.parse_target("https://bücher.example/path")
    assert target.host == "xn--bcher-kva.example"
    assert target.normalised_url == "https://xn--bcher-kva.example/path"


def test_default_port_dropped_and_path_defaulted() -> None:
    assert guard.parse_target("https://Example.com:443").normalised_url == "https://example.com/"
    assert guard.parse_target("http://example.com:8080/x").normalised_url == (
        "http://example.com:8080/x"
    )


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("apply.northstar-admissions.example", "northstar-admissions.example"),
        ("www.bbc.co.uk", "bbc.co.uk"),
        ("portal.iitb.ac.in", "iitb.ac.in"),
        ("example.com", "example.com"),
    ],
)
def test_registrable_domain(host: str, expected: str) -> None:
    assert guard.registrable_domain(host) == expected


async def test_dns_resolving_to_private_is_rejected_without_leaking_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve(host: str, timeout: float) -> list[str]:
        return ["93.184.216.34", "10.0.0.5"]  # one private answer is enough to reject (rebinding)

    monkeypatch.setattr(guard, "_resolve", fake_resolve)
    with pytest.raises(DomainError) as excinfo:
        await guard.check_target("https://rebind.example.com/")
    err = excinfo.value
    assert err.code == ErrorCode.TARGET_NOT_ALLOWED
    assert "10.0.0.5" not in str(err.details) and "10.0.0.5" not in err.message


async def test_private_ip_literal_rejected_without_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def must_not_resolve(host: str, timeout: float) -> list[str]:
        raise AssertionError("DNS must not be queried for an IP literal")

    monkeypatch.setattr(guard, "_resolve", must_not_resolve)
    for url in ("http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data"):
        with pytest.raises(DomainError) as excinfo:
            await guard.check_target(url)
        assert excinfo.value.code == ErrorCode.TARGET_NOT_ALLOWED


async def test_internal_name_rejected_before_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def must_not_resolve(host: str, timeout: float) -> list[str]:
        raise AssertionError("internal names are rejected before any DNS query")

    monkeypatch.setattr(guard, "_resolve", must_not_resolve)
    with pytest.raises(DomainError) as excinfo:
        await guard.check_target("http://metadata.google.internal/")
    assert excinfo.value.code == ErrorCode.TARGET_NOT_ALLOWED


async def test_dns_failure_is_distinct_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing(host: str, timeout: float) -> list[str]:
        raise OSError("nxdomain")

    monkeypatch.setattr(guard, "_resolve", failing)
    with pytest.raises(DomainError) as excinfo:
        await guard.check_target("https://does-not-exist.example.com/")
    assert excinfo.value.code == ErrorCode.DNS_RESOLUTION_FAILED


async def test_public_resolution_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def public(host: str, timeout: float) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr(guard, "_resolve", public)
    target = await guard.check_target("https://www.example.com/")
    assert target.addresses == ("93.184.216.34",)


async def test_demo_host_never_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    async def must_not_resolve(host: str, timeout: float) -> list[str]:
        raise AssertionError("demo hosts are answered by fixtures, never by DNS")

    monkeypatch.setattr(guard, "_resolve", must_not_resolve)
    target = await guard.check_target(
        "https://apply.northstar-admissions.example/pay", is_demo_host=True
    )
    assert target.addresses == ()
