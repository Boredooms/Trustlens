"""Live collectors: DNS, RDAP, TLS, redirects and static page analysis.

Every outbound request goes through ``guard.check_target`` — including each redirect hop, with DNS
re-resolution (SECURITY_THREAT_MODEL.md §4). Every collector has its own budget and degrades to
``unavailable`` rather than failing the scan (RISK_ENGINE.md §2.2: a failed check is never a pass).
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import ssl
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import certifi
import dns.exception
import dns.resolver
import httpx

from app.config import Settings
from app.errors import DomainError
from app.logging import get_logger
from app.services import guard
from app.services.demo_fixtures import demo_observations, is_demo_host
from app.services.observations import (
    DnsObs,
    EvidenceDraft,
    FormObs,
    Observations,
    PageObs,
    RedirectObs,
    RegistrationObs,
    TlsObs,
)

log = get_logger("collectors")

UPI_PATTERN = re.compile(r"\b[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z\-]{1,31}\b")


# ── Static HTML analysis (no script execution) ──────────────────────────────────
class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title: str | None = None
        self._in_title = False
        self._skip = 0
        self.text: list[str] = []
        self.forms: list[dict[str, Any]] = []
        self._form: dict[str, Any] | None = None
        self.password_fields = 0
        self.payees: list[dict[str, str]] = []
        self._payee_type: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "form":
            self._form = {"action": a.get("action"), "method": a.get("method", "get"), "pw": False}
            self.forms.append(self._form)
        elif tag == "input" and a.get("type", "").lower() == "password":
            # Only the field's *presence* is recorded — never a value.
            self.password_fields += 1
            if self._form is not None:
                self._form["pw"] = True
        if "data-payee" in a:
            self._payee_type = a["data-payee"] or "upi_vpa"

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag == "form":
            self._form = None

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_title:
            self.title = (self.title or "") + data.strip()
        if self._payee_type and data.strip():
            self.payees.append({"type": self._payee_type, "value": data.strip()})
            self._payee_type = None
        if data.strip():
            self.text.append(data.strip())


def analyse_html(html: str, base_url: str) -> PageObs:
    parser = _PageParser()
    try:
        parser.feed(html)
    except Exception:  # noqa: BLE001 — malformed HTML is data, not an error
        log.warning("page.parse_failed")
    text = " ".join(parser.text).lower()[:5000]
    payees = list(parser.payees)
    if not payees:
        for match in UPI_PATTERN.findall(" ".join(parser.text))[:3]:
            if "." not in match.split("@", 1)[1]:  # UPI handles have no dot; emails do
                payees.append({"type": "upi_vpa", "value": match})
    forms = [
        FormObs(
            action=urljoin(base_url, f["action"]) if f["action"] else None,
            method=str(f["method"]).lower(),
            has_password=bool(f["pw"]),
        )
        for f in parser.forms
    ]
    return PageObs(
        status="collected",
        title=parser.title,
        text_sample=text,
        password_fields=parser.password_fields,
        forms=forms,
        payees=payees,
    )


# ── Individual collectors ───────────────────────────────────────────────────────
async def collect_dns(host: str, timeout: float) -> DnsObs:
    # Blocking resolver in worker threads: dnspython's async resolver stalls under the Windows
    # selector loop (app.serve); threads behave identically on Linux.
    resolver = dns.resolver.Resolver()
    resolver.lifetime = timeout

    async def query(name: str, rtype: str) -> list[str]:
        try:
            answer = await asyncio.to_thread(resolver.resolve, name, rtype)
            return sorted(str(r).rstrip(".") for r in answer)
        except (dns.resolver.NoAnswer, dns.resolver.NoNameservers):
            return []

    try:
        a, aaaa = await asyncio.gather(query(host, "A"), query(host, "AAAA"))
    except dns.resolver.NXDOMAIN:
        return DnsObs(status="collected", nxdomain=True)
    except dns.exception.DNSException:
        return DnsObs(status="unavailable")
    ns: list[str] = []
    zone = guard.registrable_domain(host)
    try:
        ns = await query(host, "NS") or await query(zone, "NS")
    except dns.exception.DNSException:
        ns = []
    return DnsObs(status="collected", a=a, aaaa=aaaa, ns=ns)


async def guarded_get(
    client: httpx.AsyncClient, url: str, settings: Settings, *, max_bytes: int
) -> tuple[httpx.Response | None, bytes, RedirectObs]:
    """GET with manual redirects; every hop is re-validated and re-resolved by the guard."""
    hops: list[dict[str, Any]] = []
    current = url
    for _ in range(settings.max_redirect_hops + 1):
        try:
            await guard.check_target(current, dns_timeout=settings.dns_timeout_seconds)
        except DomainError as exc:
            blocked = {"url": current, "reason": str(exc.code).lower()}
            return None, b"", RedirectObs(status="collected", hops=hops, blocked_hop=blocked)
        started = asyncio.get_running_loop().time()
        async with client.stream("GET", current, timeout=settings.probe_timeout_seconds) as resp:
            try:
                guard.check_peer(resp, urlsplit(current).hostname or "")
            except DomainError as exc:
                blocked = {"url": current, "reason": str(exc.code).lower()}
                return None, b"", RedirectObs(status="collected", hops=hops, blocked_hop=blocked)
            if resp.is_redirect and "location" in resp.headers:
                nxt = urljoin(current, resp.headers["location"])
                hops.append(
                    {
                        "url": current,
                        "status": resp.status_code,
                        "location": nxt,
                        "elapsed_ms": round((asyncio.get_running_loop().time() - started) * 1000),
                    }
                )
                current = nxt
                continue
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) >= max_bytes:
                    break  # streaming discard after the cap
            return (
                resp,
                bytes(body[:max_bytes]),
                RedirectObs(status="collected", hops=hops, final_url=current),
            )
    return None, b"", RedirectObs(status="collected", hops=hops, too_many=True)


async def collect_page(
    client: httpx.AsyncClient, url: str, settings: Settings
) -> tuple[PageObs, RedirectObs]:
    try:
        async with asyncio.timeout(10):
            resp, body, redirects = await guarded_get(
                client, url, settings, max_bytes=settings.max_page_bytes
            )
    except (TimeoutError, httpx.HTTPError):
        return PageObs(status="unavailable"), RedirectObs(status="unavailable")
    if resp is None:
        return PageObs(status="unavailable"), redirects
    headers, cookies = response_posture(resp)
    if resp.status_code in (401, 403, 429, 503):
        return PageObs(
            status="unavailable", fetch_blocked=True, response_headers=headers, set_cookies=cookies
        ), redirects
    if "html" not in resp.headers.get("content-type", "html"):
        return PageObs(status="collected", response_headers=headers, set_cookies=cookies), redirects
    html = body.decode(resp.encoding or "utf-8", errors="replace")
    page = analyse_html(html, redirects.final_url or url)
    page.response_headers, page.set_cookies = headers, cookies
    if (redirects.final_url or url).startswith("https://"):
        page.mixed_content = len(MIXED_CONTENT_RE.findall(html))
    return page, redirects


# Header posture (CERTIFICATE_ANALYSIS.md §5): headers of the one response we already fetched.
POSTURE_HEADERS = (
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "server",
    "x-powered-by",
)
MIXED_CONTENT_RE = re.compile(
    r"(?is)<(?:script|img|iframe|link|audio|video|source|embed|object)\b[^>]*?"
    r"\b(?:src|href|data)\s*=\s*[\"']http://"
)


def response_posture(resp: httpx.Response) -> tuple[dict[str, str], list[dict[str, Any]]]:
    headers = {h: resp.headers[h][:300] for h in POSTURE_HEADERS if h in resp.headers}
    cookies = []
    for raw in resp.headers.get_list("set-cookie")[:20]:
        parts = [p.strip().lower() for p in raw.split(";")]
        cookies.append(
            {
                "name": raw.split("=", 1)[0].strip()[:64],  # name only: never the value
                "secure": "secure" in parts,
                "httponly": "httponly" in parts,
            }
        )
    return headers, cookies


async def collect_rdap(
    client: httpx.AsyncClient, registrable: str, settings: Settings
) -> RegistrationObs:
    try:
        async with asyncio.timeout(4):
            resp, body, _ = await guarded_get(
                client, f"https://rdap.org/domain/{registrable}", settings, max_bytes=262_144
            )
        if resp is None or resp.status_code != 200:
            return RegistrationObs(status="unavailable")
        import json

        data = json.loads(body)
        for event in data.get("events", []):
            if event.get("eventAction") == "registration":
                registered = datetime.fromisoformat(event["eventDate"].replace("Z", "+00:00"))
                return RegistrationObs(
                    status="collected", age_days=(datetime.now(UTC) - registered).days
                )
        return RegistrationObs(status="collected")
    except (TimeoutError, httpx.HTTPError, ValueError, KeyError):
        return RegistrationObs(status="unavailable")


async def collect_tls(
    target: guard.Target, settings: Settings, client: httpx.AsyncClient | None = None
) -> TlsObs:
    if target.scheme != "https":
        return TlsObs(status="collected", presented=False)
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, rsa

    address = target.addresses[0] if target.addresses else target.host
    verified, hostname_ok, der = True, True, None
    # Mozilla's root store via certifi (already shipped with httpx), not the OS store: on Windows,
    # OpenSSL cannot fetch missing roots on demand, which made valid public chains look untrusted.
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        async with asyncio.timeout(settings.probe_timeout_seconds):
            reader, writer = await asyncio.open_connection(
                address, target.port, ssl=context, server_hostname=target.host
            )
            sslobj = writer.get_extra_info("ssl_object")
            der = sslobj.getpeercert(binary_form=True) if sslobj else None
            writer.close()
    except ssl.SSLCertVerificationError as exc:
        verified = False
        hostname_ok = "hostname" not in str(exc).lower()
        insecure = ssl.create_default_context()
        insecure.check_hostname = False
        insecure.verify_mode = ssl.CERT_NONE  # observation only: we inspect, we never trust it
        try:
            async with asyncio.timeout(settings.probe_timeout_seconds):
                _, writer = await asyncio.open_connection(
                    address, target.port, ssl=insecure, server_hostname=target.host
                )
                sslobj = writer.get_extra_info("ssl_object")
                der = sslobj.getpeercert(binary_form=True) if sslobj else None
                writer.close()
        except (OSError, TimeoutError, ssl.SSLError):
            return TlsObs(status="collected", handshake_failed=True)
    except (ssl.SSLError, ConnectionError):
        return TlsObs(status="collected", handshake_failed=True)
    except (OSError, TimeoutError):
        return TlsObs(status="unavailable")
    if der is None:
        return TlsObs(status="unavailable")

    cert = x509.load_der_x509_certificate(der)

    def cn(name: x509.Name) -> str | None:
        attrs = name.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
        return str(attrs[0].value) if attrs else None

    try:
        sans = cert.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        sans = []
    key = cert.public_key()
    key_type = (
        "RSA"
        if isinstance(key, rsa.RSAPublicKey)
        else "EC"
        if isinstance(key, ec.EllipticCurvePublicKey)
        else "other"
    )
    key_bits = getattr(key, "key_size", None)
    not_after = cert.not_valid_after_utc
    from app.services import certificates

    # Revocation only for a chain that otherwise validates: an untrusted chain is already a
    # finding, and its AIA URLs deserve no extra fetches. Failures are "unavailable".
    revocation: dict[str, Any] = {"status": "skipped", "reason": "chain_not_verified"}
    if verified and client is not None:
        revocation = await certificates.check_revocation(cert, client, settings)
    return TlsObs(
        self_signed=cert.issuer == cert.subject,
        not_yet_valid=cert.not_valid_before_utc > datetime.now(UTC),
        sct_count=certificates.sct_count(cert),
        revocation=revocation,
        status="collected",
        presented=True,
        verified=verified,
        hostname_ok=hostname_ok,
        issuer_cn=cn(cert.issuer),
        subject_cn=cn(cert.subject),
        sans=list(sans),
        not_before=cert.not_valid_before_utc.isoformat(),
        not_after=not_after.isoformat(),
        days_to_expiry=(not_after - datetime.now(UTC)).days,
        fingerprint_sha256=cert.fingerprint(hashes.SHA256()).hex(),
        key_type=key_type,
        key_bits=key_bits,
        signature_algorithm=cert.signature_hash_algorithm.name
        if cert.signature_hash_algorithm
        else "unknown",
    )


# ── Orchestration of the collectors ─────────────────────────────────────────────
async def collect(
    target: guard.Target, settings: Settings, client: httpx.AsyncClient, *, deep: bool = False
) -> Observations:
    if settings.demo_mode and is_demo_host(target.host, target.registrable_domain):
        return demo_observations(
            target.host, target.registrable_domain, target.normalised_url, target.scheme
        )

    dns_obs, tls_obs, (page_obs, redirect_obs), reg_obs = await asyncio.gather(
        collect_dns(target.host, settings.dns_timeout_seconds),
        collect_tls(target, settings, client),
        collect_page(client, target.normalised_url, settings),
        collect_rdap(client, target.registrable_domain, settings),
    )
    if deep and settings.deep_scan_enabled:
        # TECH_STACK §4.5: rendered DOM when asked for and enabled; static otherwise.
        from app.services import deep_scan

        rendered = await deep_scan.render_page(target.normalised_url, settings)
        page_obs = deep_scan.merge(page_obs, rendered)
    obs = Observations(
        host=target.host,
        registrable_domain=target.registrable_domain,
        normalised_url=target.normalised_url,
        scheme=target.scheme,
        dns=dns_obs,
        registration=reg_obs,
        tls=tls_obs,
        redirects=redirect_obs,
        page=page_obs,
    )
    if dns_obs.status == "collected":
        obs.evidence.append(
            EvidenceDraft(
                "dns",
                "dns",
                f"{len(dns_obs.a)} A record(s), {len(dns_obs.ns)} NS",
                {
                    "a": dns_obs.a,
                    "aaaa": dns_obs.aaaa,
                    "ns": dns_obs.ns,
                    "nxdomain": dns_obs.nxdomain,
                },
            )
        )
    if reg_obs.status == "collected":
        obs.evidence.append(
            EvidenceDraft(
                "rdap",
                "rdap",
                f"Registered {reg_obs.age_days} days ago",
                {"age_days": reg_obs.age_days},
            )
        )
    if tls_obs.status == "collected":
        obs.evidence.append(
            EvidenceDraft(
                "tls",
                "tls",
                f"Issuer {tls_obs.issuer_cn}, verified={tls_obs.verified}"
                if tls_obs.presented
                else "No certificate presented",
                {
                    "issuer_cn": tls_obs.issuer_cn,
                    "verified": tls_obs.verified,
                    "days_to_expiry": tls_obs.days_to_expiry,
                    "fingerprint_sha256": tls_obs.fingerprint_sha256,
                    "handshake_failed": tls_obs.handshake_failed,
                },
            )
        )
    for i, hop in enumerate(redirect_obs.hops):
        obs.evidence.append(
            EvidenceDraft(
                f"hop{i}",
                "redirect_hop",
                f"{hop['status']} → {urlsplit(hop['location']).netloc}",
                hop,
            )
        )
    if page_obs.status == "collected":
        digest = hashlib.sha256(page_obs.text_sample.encode()).hexdigest()
        obs.evidence.append(
            EvidenceDraft(
                "page",
                "page",
                f"Page '{page_obs.title}': {page_obs.password_fields} password field(s), "
                f"{len(page_obs.forms)} form(s)",
                {
                    "title": page_obs.title,
                    "form_actions": [f.action for f in page_obs.forms],
                    "password_fields": page_obs.password_fields,
                    "payees": page_obs.payees,
                    "text_sha256": digest,
                    "dom_source": page_obs.dom_source,
                },
            )
        )
    return obs
