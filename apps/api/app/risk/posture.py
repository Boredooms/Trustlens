"""Certificate report and security-header posture (CERTIFICATE_ANALYSIS.md §4–§5). Pure.

The certificate report separates **misconfiguration** (expired, weak, no CT proof) from **trust
compromise** (untrusted or self-signed chain, revocation, issuer under an incident), because those
mean different things to a user. A valid certificate is never presented as proof of legitimacy.

Header posture is unscored: it describes hygiene, not whether the page is a phish.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from app.risk.codes import POSTURE, POSTURE_LIMITATION
from app.risk.engine import Finding
from app.services.observations import Observations, TlsObs

TRUST_CODES = frozenset(
    {
        "CERT_REVOKED",
        "CERT_SELF_SIGNED",
        "CERT_CHAIN_UNVERIFIED",
        "CERT_HOSTNAME_MISMATCH",
        "CERT_ISSUER_AFFECTED_BY_INCIDENT",
        "TLS_HANDSHAKE_FAILED",
    }
)
MISCONFIG_CODES = frozenset(
    {
        "CERT_EXPIRED",
        "CERT_EXPIRING_SOON",
        "CERT_NOT_YET_VALID",
        "CERT_WEAK_KEY",
        "CERT_WEAK_SIGNATURE",
        "CERT_NO_EMBEDDED_SCT",
    }
)
VALID_IS_NOT_PROOF = (
    "A valid certificate proves only that the connection is encrypted to whoever controls this "
    "name. It is not evidence that the site is legitimate."
)
_VERSION = re.compile(r"\d+\.\d+")


def certificate_report(tls: TlsObs, findings: Iterable[Finding], scheme: str) -> dict[str, Any]:
    issues = [
        {
            "code": f.code,
            "category": "trust" if f.code in TRUST_CODES else "configuration",
            "severity": f.severity.value,
            "detail": f.detail,
            "simulated": f.simulated,
        }
        for f in findings
        if f.code in TRUST_CODES | MISCONFIG_CODES
    ]
    if scheme != "https":
        assessment = "no_tls"
    elif tls.status != "collected":
        assessment = "unavailable"
    elif any(i["category"] == "trust" and i["severity"] != "info" for i in issues):
        assessment = "trust_compromised"
    elif issues and any(i["severity"] != "info" for i in issues):
        assessment = "misconfigured"
    else:
        assessment = "valid"
    return {
        "assessment": assessment,
        "issues": issues,
        "subject_cn": tls.subject_cn,
        "issuer_cn": tls.issuer_cn,
        "root_issuer_cn": tls.root_issuer_cn,
        "sans": tls.sans[:20],
        "not_before": tls.not_before,
        "not_after": tls.not_after,
        "days_to_expiry": tls.days_to_expiry,
        "key": {"type": tls.key_type, "bits": tls.key_bits},
        "signature_algorithm": tls.signature_algorithm,
        "chain_verified": tls.verified if tls.presented else None,
        "self_signed": tls.self_signed,
        "embedded_scts": tls.sct_count,
        "revocation": tls.revocation,
        "note": VALID_IS_NOT_PROOF,
        "limitations": (
            "Revocation is checked by OCSP when the issuer publishes a responder; a timeout is "
            "reported as unavailable, never as good. We cannot detect a certificate authority's "
            "internal key-generation weakness from a website; incident matching relies on "
            "recorded advisories."
        ),
    }


def _item(code: str, evidence: dict[str, Any]) -> dict[str, Any]:
    p = POSTURE[code]
    return {
        "check_id": p.check_id,
        "code": p.code,
        "severity": p.severity.value,
        "title": p.title,
        "evidence": evidence,
        "impact": p.impact,
        "remediation": p.remediation,
        "limitations": POSTURE_LIMITATION,
    }


def header_posture(obs: Observations) -> dict[str, Any]:
    """One response, headers only. Status mirrors the page fetch; unscored."""
    page = obs.page
    if obs.scheme == "http" and page.status == "collected":
        base = [_item("PLAIN_HTTP_SITE", {"scheme": "http"})]
    else:
        base = []
    if page.response_headers is None:
        return {
            "status": "unavailable" if not obs.simulated else "skipped",
            "findings": base,
            "scored": False,
            "limitations": POSTURE_LIMITATION,
        }
    h = page.response_headers
    out = list(base)
    https = obs.scheme == "https"
    if https and "strict-transport-security" not in h:
        out.append(_item("HSTS_MISSING", {"strict-transport-security": None}))
    csp = h.get("content-security-policy")
    if csp is None or "'unsafe-inline'" in csp or re.search(r"script-src[^;]*\*", csp):
        out.append(_item("CSP_MISSING_OR_WEAK", {"content-security-policy": csp}))
    if h.get("x-content-type-options", "").lower() != "nosniff":
        out.append(
            _item("NOSNIFF_MISSING", {"x-content-type-options": h.get("x-content-type-options")})
        )
    if "referrer-policy" not in h:
        out.append(_item("REFERRER_POLICY_MISSING", {"referrer-policy": None}))
    if "permissions-policy" not in h:
        out.append(_item("PERMISSIONS_POLICY_MISSING", {"permissions-policy": None}))
    weak = [c["name"] for c in page.set_cookies if https and not (c["secure"] and c["httponly"])]
    if weak:
        out.append(_item("COOKIE_WITHOUT_SECURE_OR_HTTPONLY", {"cookies": weak[:5]}))
    disclosed = {k: h[k] for k in ("server", "x-powered-by") if k in h and _VERSION.search(h[k])}
    if disclosed:
        out.append(_item("SERVER_VERSION_DISCLOSED", disclosed))
    if page.mixed_content:
        out.append(_item("MIXED_CONTENT", {"http_subresources": page.mixed_content}))
    return {
        "status": "collected",
        "findings": out,
        "headers_observed": sorted(h),
        "scored": False,
        "limitations": POSTURE_LIMITATION,
    }
