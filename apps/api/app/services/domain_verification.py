"""Domain ownership challenges (ORGANISATION_TRUST_PROFILES.md §4).

A domain becomes authoritative only after the organisation proves control of *that exact host*:

- ``dns_txt``: a TXT record ``tl-verify=<token>`` at ``_trustlens-challenge.<domain>``;
- ``http_file``: ``https://<domain>/.well-known/trustlens-verify.txt`` containing the same value,
  fetched through the SSRF guard (boundary B2), HTTPS with a verified chain, no redirects (a
  redirect would let another host answer for this one), 5 s timeout, 4 kB cap.

Only the SHA-256 of the token is stored; the raw token is shown once, in the challenge
instructions. Checks never raise for "not there" or "wrong value" — they return an outcome the
route maps to the documented status codes.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import dns.exception
import dns.resolver
import httpx
import idna

from app.errors import DomainError, ValidationFailed
from app.logging import get_logger
from app.schemas.enums import ErrorCode
from app.security.ssrf import classify_hostname
from app.services import guard
from app.utils import iso_z

log = get_logger("domain_verification")

CHALLENGE_TTL = timedelta(days=7)
VERIFICATION_VALIDITY = timedelta(days=180)
MAX_ATTEMPTS_PER_HOUR = 5
RECORD_PREFIX = "_trustlens-challenge"
FILE_PATH = "/.well-known/trustlens-verify.txt"
VALUE_PREFIX = "tl-verify="
HTTP_TIMEOUT_S = 5.0
HTTP_MAX_BYTES = 4096
DNS_TIMEOUT_S = 4.0
OBSERVED_MAX = 16

Method = Literal["dns_txt", "http_file"]
Outcome = Literal["match", "mismatch", "not_found", "fetch_failed"]


# ── Errors (API_CONTRACTS.md §7.3) ──────────────────────────────────────────────
class VerificationTokenMismatch(DomainError):
    code, status, message = (
        ErrorCode.VERIFICATION_TOKEN_MISMATCH,
        422,
        "We found a TrustLens record, but its value does not match this challenge.",
    )


class VerificationNotFound(DomainError):
    code, status, message = (
        ErrorCode.VERIFICATION_NOT_FOUND,
        422,
        "We could not find the verification record. It can take a few minutes to appear.",
    )


class VerificationFetchFailed(DomainError):
    code, status, message = (
        ErrorCode.VERIFICATION_FETCH_FAILED,
        502,
        "We could not reach the domain to check the challenge. Try again shortly.",
    )


class VerificationExpired(DomainError):
    code, status, message = (
        ErrorCode.VERIFICATION_EXPIRED,
        410,
        "This challenge has expired. Request a new one and try again.",
    )


class DomainAlreadyClaimed(DomainError):
    code, status, message = (
        ErrorCode.DOMAIN_ALREADY_CLAIMED,
        409,
        "Another organisation has already claimed this domain.",
    )


# ── Tokens and instructions ─────────────────────────────────────────────────────
def new_token() -> str:
    """32 random bytes, base32, uppercase, no padding (§4.1)."""
    return base64.b32encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def normalise_domain(raw: str) -> str:
    """Punycode, lowercase, no scheme/path/port/wildcard, at least one dot, not internal."""
    value = raw.strip().rstrip(".").lower()

    def bad(issue: str) -> ValidationFailed:
        return ValidationFailed(details=[{"field": "domain", "issue": issue}])

    if not value or "://" in value or "/" in value or ":" in value or "@" in value:
        raise bad("bare_domain_required")
    if "*" in value:
        raise bad("wildcard_not_allowed")
    try:
        ascii_value = idna.encode(value, uts46=True).decode("ascii").lower()
    except idna.IDNAError:
        raise bad("invalid_domain") from None
    labels = ascii_value.split(".")
    if len(labels) < 2 or len(ascii_value) > 253 or any(not 1 <= len(lb) <= 63 for lb in labels):
        raise bad("invalid_domain")
    if all(ch.isdigit() for ch in labels[-1]):
        raise bad("ip_literal_not_allowed")
    if classify_hostname(ascii_value):
        raise bad("internal_hostname")
    return ascii_value


def challenges(domain: str, token: str, expires_at: datetime) -> list[dict[str, str]]:
    value = f"{VALUE_PREFIX}{token}"
    expires = iso_z(expires_at)
    return [
        {
            "method": "dns_txt",
            "record_name": f"{RECORD_PREFIX}.{domain}",
            "record_type": "TXT",
            "record_value": value,
            "expires_at": expires,
        },
        {
            "method": "http_file",
            "url": f"https://{domain}{FILE_PATH}",
            "file_content": value,
            "expires_at": expires,
        },
    ]


# ── Checks ──────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class CheckResult:
    outcome: Outcome
    observed: str | None = None  # truncated, safe to echo (§4.2)
    observed_hash: str | None = None  # sha256 of the full observed value, for evidence

    @property
    def matched(self) -> bool:
        return self.outcome == "match"


def _compare(candidates: list[str], token_hash: str) -> CheckResult:
    """``match`` if a candidate equals ``tl-verify=<token>`` for the stored hash (constant time)."""
    tl_values = [c.strip() for c in candidates if c.strip().startswith(VALUE_PREFIX)]
    for value in tl_values:
        presented = value[len(VALUE_PREFIX) :]
        try:
            presented_hash = hash_token(presented)
        except UnicodeEncodeError:
            continue
        if hmac.compare_digest(presented_hash, token_hash):
            return CheckResult(
                "match", value[:OBSERVED_MAX], hashlib.sha256(value.encode()).hexdigest()
            )
    if tl_values:
        first = tl_values[0]
        return CheckResult(
            "mismatch", first[:OBSERVED_MAX], hashlib.sha256(first.encode()).hexdigest()
        )
    return CheckResult("not_found")


async def txt_records(name: str) -> list[str]:
    """TXT strings at ``name``; [] when absent. Raises ``dns.exception.DNSException`` otherwise."""
    # The blocking resolver in a worker thread works on every event loop; dnspython's asyncio
    # resolver times out under the Windows selector loop that app.serve needs for psycopg.
    resolver = dns.resolver.Resolver()
    resolver.lifetime = DNS_TIMEOUT_S
    for attempt in range(2):  # API_CONTRACTS.md §11: one retry on timeout (cold resolver caches)
        try:
            answer = await asyncio.to_thread(resolver.resolve, name, "TXT")
            break
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return []
        except dns.exception.Timeout:
            if attempt:
                raise
    out: list[str] = []
    for rdata in answer:
        # A TXT record may be split into several <=255-byte strings; they form one value.
        parts = getattr(rdata, "strings", ())
        out.append(b"".join(parts).decode("utf-8", errors="replace"))
    return out


async def check_dns(domain: str, token_hash: str) -> CheckResult:
    try:
        records = await txt_records(f"{RECORD_PREFIX}.{domain}")
    except dns.exception.DNSException as exc:
        log.info("verify.dns_unavailable", extra={"exc_type": type(exc).__name__})
        return CheckResult("fetch_failed")
    return _compare(records, token_hash)


async def fetch_file(url: str) -> tuple[int, bytes]:
    """GET through the SSRF guard: HTTPS only, verified chain, no redirects, 5 s, 4 kB cap.

    Raises ``DomainError`` (guard rejection) or ``httpx.HTTPError`` (network/TLS).
    """
    target = await guard.check_target(url)
    if target.scheme != "https":
        raise ValidationFailed(details=[{"field": "url", "issue": "https_required"}])
    async with (
        httpx.AsyncClient(
            verify=True,
            follow_redirects=False,
            timeout=HTTP_TIMEOUT_S,
            headers={"User-Agent": "TrustLensVerifier/1.0 (+https://trustlens.example/bot)"},
        ) as client,
        client.stream("GET", target.normalised_url) as resp,
    ):
        guard.check_peer(resp, target.host)  # DNS rebinding: refuse before reading the body
        body = bytearray()
        async for chunk in resp.aiter_bytes():
            body.extend(chunk)
            if len(body) >= HTTP_MAX_BYTES:
                break
        return resp.status_code, bytes(body[:HTTP_MAX_BYTES])


async def check_http(domain: str, token_hash: str) -> CheckResult:
    url = f"https://{domain}{FILE_PATH}"
    try:
        status, body = await fetch_file(url)
    except DomainError as exc:
        # SSRF guard / DNS refused the host: nothing we may fetch is there.
        log.info("verify.http_rejected", extra={"code": str(exc.code)})
        return CheckResult("fetch_failed")
    except httpx.HTTPError as exc:
        log.info("verify.http_unavailable", extra={"exc_type": type(exc).__name__})
        return CheckResult("fetch_failed")
    if status in (404, 410) or 300 <= status < 400:
        return CheckResult("not_found")  # a redirect means the exact host does not serve it
    if status != 200:
        return CheckResult("fetch_failed")
    text = body.decode("utf-8", errors="replace")
    return _compare([text.strip(), *text.splitlines()], token_hash)


async def run_check(method: Method, domain: str, token_hash: str) -> CheckResult:
    if method == "dns_txt":
        return await check_dns(domain, token_hash)
    return await check_http(domain, token_hash)
