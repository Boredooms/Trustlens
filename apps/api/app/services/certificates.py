"""Certificate depth: SCT presence, OCSP revocation (CERTIFICATE_ANALYSIS.md §2–§3).

Revocation is best-effort and **fails to "unavailable", never to "good"**. Every fetch goes through
the guarded GET (``collectors.guarded_get``): the AIA and OCSP URLs come from an attacker-controlled
certificate and could point anywhere, including private networks.
"""

from __future__ import annotations

import asyncio
import base64
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID

from app.config import Settings

REVOCATION_BUDGET_SECONDS = 4.0
CRL_MAX = 2_000_000


def sct_count(cert: x509.Certificate) -> int | None:
    """Embedded SCTs in the leaf. 0 = none embedded (SCTs may still arrive via TLS/OCSP)."""
    try:
        ext = cert.extensions.get_extension_for_class(
            x509.PrecertificateSignedCertificateTimestamps
        )
    except x509.ExtensionNotFound:
        return 0
    except ValueError:  # malformed extension: not determined
        return None
    return len(list(ext.value))


def aia_urls(cert: x509.Certificate) -> tuple[list[str], list[str]]:
    try:
        aia = cert.extensions.get_extension_for_class(x509.AuthorityInformationAccess).value
    except (x509.ExtensionNotFound, ValueError):
        return [], []
    ocsp_urls, issuer_urls = [], []
    for desc in aia:
        if not isinstance(desc.access_location, x509.UniformResourceIdentifier):
            continue
        url = desc.access_location.value
        if desc.access_method == AuthorityInformationAccessOID.OCSP:
            ocsp_urls.append(url)
        elif desc.access_method == AuthorityInformationAccessOID.CA_ISSUERS:
            issuer_urls.append(url)
    return ocsp_urls[:2], issuer_urls[:2]


def interpret_ocsp(der: bytes) -> dict[str, Any]:
    """Map an OCSP response to our revocation block. Anything unexpected is 'unavailable'."""
    try:
        resp = ocsp.load_der_ocsp_response(der)
    except ValueError:
        return {"status": "unavailable", "reason": "unparseable_response"}
    if resp.response_status != ocsp.OCSPResponseStatus.SUCCESSFUL:
        return {"status": "unavailable", "reason": resp.response_status.name.lower()}
    status = resp.certificate_status
    out: dict[str, Any] = {
        "status": {
            ocsp.OCSPCertStatus.GOOD: "good",
            ocsp.OCSPCertStatus.REVOKED: "revoked",
            ocsp.OCSPCertStatus.UNKNOWN: "unknown",
        }[status],
        "this_update": resp.this_update_utc.isoformat(),
    }
    if status == ocsp.OCSPCertStatus.REVOKED:
        out["revoked_at"] = (
            resp.revocation_time_utc.isoformat() if resp.revocation_time_utc else None
        )
        out["reason"] = resp.revocation_reason.name if resp.revocation_reason else None
    return out


async def check_revocation(
    cert: x509.Certificate, client: httpx.AsyncClient, settings: Settings
) -> dict[str, Any]:
    from app.services.collectors import guarded_get  # local import: collectors imports us

    ocsp_urls, issuer_urls = aia_urls(cert)
    crls = crl_urls(cert)
    if not issuer_urls:
        return {"status": "unavailable", "reason": "no_issuer_url"}
    if not ocsp_urls and not crls:
        return {"status": "unavailable", "reason": "no_revocation_endpoint"}
    try:
        async with asyncio.timeout(REVOCATION_BUDGET_SECONDS):
            resp, body, _ = await guarded_get(client, issuer_urls[0], settings, max_bytes=65_536)
            if resp is None or resp.status_code != 200:
                return {"status": "unavailable", "reason": "issuer_fetch_failed"}
            try:
                issuer = x509.load_der_x509_certificate(body)
            except ValueError:
                issuer = x509.load_pem_x509_certificate(body)
            if not ocsp_urls:
                # Issuers that dropped OCSP (e.g. Let's Encrypt, 2025) publish CRLs instead.
                resp, body, _ = await guarded_get(client, crls[0], settings, max_bytes=CRL_MAX)
                if resp is None or resp.status_code != 200:
                    return {"status": "unavailable", "reason": "crl_fetch_failed"}
                result = interpret_crl(body, cert, issuer)
                result["responder"] = httpx.URL(crls[0]).host
                return result
            req = (
                ocsp.OCSPRequestBuilder()
                .add_certificate(cert, issuer, hashes.SHA1())  # noqa: S303 — RFC 6960 CertID
                .build()
                .public_bytes(serialization.Encoding.DER)
            )
            # RFC 6960 A.1: GET {responder}/{url-encoded base64 DER request}.
            encoded = quote(base64.b64encode(req).decode(), safe="")
            url = ocsp_urls[0].rstrip("/") + "/" + encoded
            resp, body, _ = await guarded_get(client, url, settings, max_bytes=65_536)
            if resp is None or resp.status_code != 200:
                return {"status": "unavailable", "reason": "responder_failed"}
    except (TimeoutError, httpx.HTTPError, ValueError):
        return {"status": "unavailable", "reason": "timeout_or_error"}
    result = interpret_ocsp(body)
    result["responder"] = httpx.URL(ocsp_urls[0]).host
    result["method"] = "ocsp"
    return result


def crl_urls(cert: x509.Certificate) -> list[str]:
    try:
        points = cert.extensions.get_extension_for_class(x509.CRLDistributionPoints).value
    except (x509.ExtensionNotFound, ValueError):
        return []
    urls = [
        name.value
        for point in points
        for name in (point.full_name or [])
        if isinstance(name, x509.UniformResourceIdentifier)
        and name.value.lower().startswith(("http://", "https://"))
    ]
    return urls[:2]


def interpret_crl(der: bytes, cert: x509.Certificate, issuer: x509.Certificate) -> dict[str, Any]:
    """Revocation from a CRL. It must be signed by the issuer and current, or it says nothing."""
    try:
        crl = x509.load_der_x509_crl(der)
    except ValueError:
        return {"status": "unavailable", "reason": "unparseable_crl", "method": "crl"}
    if crl.issuer != issuer.subject or not crl.is_signature_valid(issuer.public_key()):  # type: ignore[arg-type]
        return {"status": "unavailable", "reason": "crl_signature_invalid", "method": "crl"}
    if crl.next_update_utc is not None and crl.next_update_utc < datetime.now(UTC):
        return {"status": "unavailable", "reason": "crl_stale", "method": "crl"}
    entry = crl.get_revoked_certificate_by_serial_number(cert.serial_number)
    out: dict[str, Any] = {
        "status": "revoked" if entry is not None else "good",
        "this_update": crl.last_update_utc.isoformat(),
        "method": "crl",
    }
    if entry is not None:
        out["revoked_at"] = entry.revocation_date_utc.isoformat()
    return out
