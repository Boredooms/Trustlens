"""The SSRF choke point (SYSTEM_ARCHITECTURE.md §5 boundary B2).

Every outbound request to a user-supplied target — the submitted URL, every redirect hop, every
verification-file fetch — goes through ``check_target``. It validates syntax, scheme,
credentials and port, rejects internal names, resolves DNS *before* connecting, and rejects any
resolved address in a blocked range. Callers connect only to the addresses returned here.

Demo hosts: the seeded demo domains live under ``.example`` (RFC 2606 — reserved, can never resolve
or belong to anyone). In DEMO_MODE they are answered by recorded fixtures and **no network request
is ever made for them**, so they never reach DNS or a socket (see services/demo_fixtures.py).
"""

from __future__ import annotations

import asyncio
import socket
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

import idna

from app.errors import (
    DnsResolutionFailed,
    InvalidUrl,
    TargetNotAllowed,
    UnsupportedPort,
    UnsupportedScheme,
    UrlHasCredentials,
)
from app.logging import get_logger
from app.security.ssrf import classify_hostname, classify_ip

ALLOWED_PORTS = {80, 443, 8080, 8443}
MAX_URL_LENGTH = 2048

# Multi-label public suffixes we expect to meet. A full Public Suffix List is a documented FUTURE
# improvement; without it, unknown multi-label suffixes fall back to "last two labels".
_MULTI_LABEL_SUFFIXES = {
    "co.uk",
    "ac.uk",
    "gov.uk",
    "org.uk",
    "co.in",
    "ac.in",
    "edu.in",
    "gov.in",
    "net.in",
    "org.in",
    "res.in",
    "nic.in",
    "com.au",
    "edu.au",
    "gov.au",
    "co.nz",
    "co.jp",
    "com.br",
    "com.sg",
    "edu.sg",
    "co.za",
    "com.mx",
}

log = get_logger("guard")


@dataclass(frozen=True)
class Target:
    url: str
    normalised_url: str
    scheme: str
    host: str
    port: int
    registrable_domain: str
    addresses: tuple[str, ...] = field(default=())


def registrable_domain(host: str) -> str:
    labels = host.rstrip(".").lower().split(".")
    if len(labels) <= 2:
        return ".".join(labels)
    if ".".join(labels[-2:]) in _MULTI_LABEL_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def parse_target(url: str) -> Target:
    """Syntax-level validation and normalisation. No network access."""
    raw = url.strip()
    if not raw or len(raw) > MAX_URL_LENGTH:
        raise InvalidUrl()
    try:
        parts = urlsplit(raw)
    except ValueError:
        raise InvalidUrl() from None
    scheme = parts.scheme.lower()
    if not scheme:
        raise InvalidUrl()
    if scheme not in ("http", "https"):
        raise UnsupportedScheme()
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UrlHasCredentials()
    host = (parts.hostname or "").rstrip(".")
    if not host or len(host) > 253:
        raise InvalidUrl()
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError:
        raise InvalidUrl() from None
    if port not in ALLOWED_PORTS:
        raise UnsupportedPort()
    try:
        ascii_host = idna.encode(host, uts46=True).decode("ascii").lower()
    except idna.IDNAError:
        if _is_ip_literal(host):
            ascii_host = host.lower()
        else:
            raise InvalidUrl() from None
    default_port = (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
    display_host = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    netloc = display_host if default_port else f"{display_host}:{port}"
    normalised = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return Target(
        url=raw,
        normalised_url=normalised,
        scheme=scheme,
        host=ascii_host,
        port=port,
        registrable_domain=ascii_host
        if _is_ip_literal(ascii_host)
        else registrable_domain(ascii_host),
    )


def _is_ip_literal(host: str) -> bool:
    try:
        socket.inet_pton(socket.AF_INET6 if ":" in host else socket.AF_INET, host)
    except OSError:
        return False
    return True


async def _resolve(host: str, timeout: float) -> list[str]:
    loop = asyncio.get_running_loop()
    async with asyncio.timeout(timeout * 2):  # A + AAAA, one retry budget
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


async def check_target(
    url: str,
    *,
    dns_timeout: float = 2.0,
    is_demo_host: bool = False,
) -> Target:
    """Validate and resolve. Raises a DomainError on any policy violation."""
    target = parse_target(url)
    if is_demo_host:
        return target  # answered by fixtures; never contacted (module docstring)

    reason = classify_hostname(target.host) if not _is_ip_literal(target.host) else None
    if reason:
        log.warning("ssrf.rejected", extra={"host": target.host, "reason": reason})
        raise TargetNotAllowed(details=[{"field": "url", "issue": reason}])

    if _is_ip_literal(target.host):
        addresses = [target.host]
    else:
        try:
            addresses = await _resolve(target.host, dns_timeout)
        except (TimeoutError, OSError):
            raise DnsResolutionFailed() from None
    if not addresses:
        raise DnsResolutionFailed()
    for address in addresses:
        reason = classify_ip(address)
        if reason:
            # Never echo the resolved private IP to the client (MONITORING_HEALTHCHECKS.md §3.1).
            log.warning("ssrf.rejected", extra={"host": target.host, "reason": reason})
            raise TargetNotAllowed(details=[{"field": "url", "issue": reason}])
    return Target(**{**target.__dict__, "addresses": tuple(addresses)})


def peer_address(response: object) -> str | None:
    """IP the connection actually reached (httpx/httpcore ``network_stream``), if exposed."""
    extensions = getattr(response, "extensions", None) or {}
    stream = extensions.get("network_stream") if isinstance(extensions, dict) else None
    if stream is None:
        return None
    try:
        addr = stream.get_extra_info("server_addr")
    except Exception:  # noqa: BLE001 — transports differ; absence just means "unknown"
        return None
    if isinstance(addr, tuple) and addr:
        return str(addr[0])
    return None


def check_peer(response: object, host: str) -> None:
    """Close the DNS-rebinding window: the pre-flight resolution was checked, but the socket may
    have connected to a different (rebound) address. Validate the connected peer before reading
    the body. Raises TargetNotAllowed; an unknown peer (mock transports) is allowed."""
    address = peer_address(response)
    if address is None:
        return
    reason = classify_ip(address)
    if reason:
        log.warning("ssrf.rebinding_rejected", extra={"host": host, "reason": reason})
        raise TargetNotAllowed(details=[{"field": "url", "issue": reason}])
