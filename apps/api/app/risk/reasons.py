"""Deterministic reason sentences (RISK_ENGINE.md §9).

Ordered by (group_weight × points) desc, code asc; at most 5. Templates never say "safe".
"""

from __future__ import annotations

import string
from collections.abc import Iterable, Mapping
from typing import Any

from app.risk.engine import GROUP_WEIGHTS, Finding

TEMPLATES: dict[str, str] = {
    "KNOWN_MALICIOUS_REPUTATION": "{domain} has been confirmed as malicious by reviewed reports.",
    "RELATED_THREAT_FOUND": "This page is directly connected to a confirmed threat ({related}).",
    "REPORTED_BY_COMMUNITY": "Several people have reported {domain} in the last 7 days.",
    "DOMAIN_ON_ANALYST_BLOCKLIST": "An analyst has blocked {domain}.",
    "BRAND_UNDER_ACTIVE_ATTACK": "{org} is currently being impersonated by several sites.",
    "DOMAIN_NOT_REGISTERED_BY_BRAND": (
        "The page claims to be {org} but {domain} is not one of its verified domains."
    ),
    "BRAND_CLAIM_ON_UNVERIFIED_DOMAIN": (
        "The page uses the name {brand} but no verified organisation owns {domain}."
    ),
    "IDENTITY_CLAIM_UNVERIFIABLE": "The page claims an identity we could not verify.",
    "LOGO_NEAR_DUPLICATE": "The page shows a logo that closely matches {org}'s logo.",
    "TYPOSQUATTING_PATTERN": "{domain} resembles a domain verified by {org}.",
    "SUBDOMAIN_IMPERSONATION": "The subdomain uses the brand but {domain} is not verified.",
    "IDENTITY_MATCH_CONFIRMED": "{domain} is a verified domain of {org}.",
    "CREDENTIAL_DESTINATION_MISMATCH": (
        "The login form sends credentials to {destination}, which {org} does not use."
    ),
    "CREDENTIALS_POSTED_TO_THIRD_PARTY": "The login form sends credentials to {destination}.",
    "CREDENTIALS_POSTED_OVER_HTTP": "The login form sends credentials without encryption.",
    "PASSWORD_FIELD_ON_UNVERIFIED_DOMAIN": "The page asks for a password on an unverified domain.",
    "LOGIN_ENDPOINT_NOT_AUTHORISED": "{domain} is not one of {org}'s approved login pages.",
    "ACTION_NOT_OBSERVABLE": "We could not see where the form sends its data.",
    "LOGIN_ON_VERIFIED_ENDPOINT": "The login form goes to an endpoint approved by {org}.",
    "PAYEE_NOT_IN_VERIFIED_PROFILE": (
        "The payment address {payee} is not one registered by {org} (registered: {expected})."
    ),
    "PAYEE_UNVERIFIABLE": (
        "{org} has not registered any payment addresses, so {payee} cannot be checked."
    ),
    "PAYEE_NOT_VERIFIED": "The payment address {payee} is awaiting attestation by {org}.",
    "PAYEE_LINKED_TO_REPORTED_SCAM": "The payment address {payee} is linked to confirmed scams.",
    "PAYMENT_HOST_MISMATCH": "Payment is taken on {domain}, which is not an approved payment host.",
    "PAYEE_MATCH_CONFIRMED": "The payment address {payee} is registered by {org}.",
    "DOMAIN_RECENTLY_REGISTERED": "{domain} was registered {age_days} days ago.",
    "DOMAIN_NXDOMAIN": "{domain} does not resolve.",
    "TLS_HANDSHAKE_FAILED": "An encrypted connection to {domain} could not be established.",
    "CERT_EXPIRED": "The certificate for {domain} has expired.",
    "CERT_HOSTNAME_MISMATCH": "The certificate does not cover {domain}.",
    "CERT_CHAIN_UNVERIFIED": "The certificate chain for {domain} could not be verified.",
    "CERT_WEAK_KEY": "The certificate for {domain} uses a weak key.",
    "CERT_WEAK_SIGNATURE": "The certificate for {domain} uses a weak signature.",
    "CERT_ISSUER_AFFECTED_BY_INCIDENT": (
        "The certificate chain depends on an issuer named in {incident}."
    ),
    "SHARES_INFRA_WITH_REPORTED_THREAT": "{domain} shares {shared} with a reported threat.",
    "REDIRECT_CHAIN_TOO_LONG": "The address redirects more than 10 times.",
    "REDIRECT_TO_BLOCKED_TARGET": "A redirect pointed into a blocked network.",
    "PAGE_FETCH_BLOCKED": "{domain} refused our fetch, so page checks could not run.",
    "DOM_FINGERPRINT_MATCH": "The page structure matches a known phishing kit.",
    "ALL_CHECKS_UNAVAILABLE": "None of our checks could complete for {domain}.",
    # Messages (MESSAGE_ANALYSIS.md §4)
    "MESSAGE_CREDENTIAL_REQUEST": "The message asks you to share {categories}.",
    "MESSAGE_PAYMENT_DEMAND": "The message asks you to make a payment.",
    "MESSAGE_IMPERSONATES_ORGANISATION": (
        "The message claims to be {org} but was sent from {sender_domain}, "
        "which {org} does not use."
    ),
    "MESSAGE_LINK_TO_UNVERIFIED_CLAIM": (
        "The message claims to be {org} but links to {link_domain}, which {org} has not verified."
    ),
    "MESSAGE_URGENCY_PRESSURE": (
        "The message uses pressure ({categories}); language alone is not proof."
    ),
    "MESSAGE_CONTACT_CHANNEL_MISMATCH": "The message moves contact to an unofficial channel.",
    "MESSAGE_LINK_BLOCKED": "A link in the message ({link_domain}) was assessed BLOCK.",
    "MESSAGE_LINK_WARNED": "A link in the message ({link_domain}) was assessed WARN.",
    "MESSAGE_NO_MALICIOUS_INDICATOR": "No malicious indicator was found in the checks we ran.",
}

FORBIDDEN_WORDS = ("safe", "secure", "trusted")


class _Slots(dict[str, str]):
    def __missing__(self, key: str) -> str:
        return "this site" if key == "domain" else "the organisation" if key == "org" else "—"


def _fmt(value: Any) -> str:
    if isinstance(value, list | tuple):
        return ", ".join(str(v) for v in value) or "none"
    return str(value)


def render(finding: Finding, context: Mapping[str, Any]) -> str:
    slots = _Slots({k: _fmt(v) for k, v in context.items() if v is not None})
    for source in (finding.expected or {}, finding.observed or {}):
        for key, value in source.items():
            if value is not None:
                slots.setdefault(key, _fmt(value))
    expected = finding.expected or {}
    if "payees" in expected:
        slots["expected"] = _fmt(expected["payees"])
    return string.Formatter().vformat(TEMPLATES[finding.code], (), slots)


def reasons(findings: Iterable[Finding], context: Mapping[str, Any], limit: int = 5) -> list[str]:
    scored = [f for f in findings if f.points > 0]
    scored.sort(key=lambda f: (-(GROUP_WEIGHTS[f.group] * f.points), f.code))
    return [render(f, context) for f in scored[:limit]]
