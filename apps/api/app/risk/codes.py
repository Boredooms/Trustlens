"""Finding-code registry (RISK_ENGINE.md §7). The only place a code, its group, default severity and
rule id are defined. Unknown codes cannot be emitted: ``rule()`` raises on lookup failure.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.enums import Severity, SignalGroup

# 1.1.0: message codes + policy (O-8…O-10), certificate depth, external intel, header posture.
ENGINE_VERSION = "1.1.0"

REP = SignalGroup.REPUTATION
IDN = SignalGroup.IDENTITY
CRD = SignalGroup.CREDENTIAL_DESTINATION
PAY = SignalGroup.PAYMENT_DESTINATION
INF = SignalGroup.INFRASTRUCTURE

C, H, M, L, NFO = Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO


@dataclass(frozen=True)
class Rule:
    rule_id: str
    code: str
    group: SignalGroup
    severity: Severity
    title: str


_RULES = [
    # 7.1 Reputation
    Rule("R-REP-01", "KNOWN_MALICIOUS_REPUTATION", REP, C, "Known malicious by confirmed reports"),
    Rule("R-REP-02", "RELATED_THREAT_FOUND", REP, H, "Connected to a confirmed threat"),
    Rule("R-REP-03", "REPORTED_BY_COMMUNITY", REP, M, "Reported by several community members"),
    Rule("R-REP-04", "DOMAIN_ON_ANALYST_BLOCKLIST", REP, C, "Blocked by an analyst"),
    Rule(
        "R-REP-05", "BRAND_UNDER_ACTIVE_ATTACK", REP, M, "This brand is being actively impersonated"
    ),
    # 7.2 Identity
    Rule(
        "R-ID-01",
        "DOMAIN_NOT_REGISTERED_BY_BRAND",
        IDN,
        H,
        "Domain is not registered by the organisation",
    ),
    Rule(
        "R-ID-02",
        "BRAND_CLAIM_ON_UNVERIFIED_DOMAIN",
        IDN,
        H,
        "Brand claimed on an unverified domain",
    ),
    Rule("R-ID-03", "IDENTITY_CLAIM_UNVERIFIABLE", IDN, M, "Identity claim cannot be verified"),
    Rule("R-ID-04", "LOGO_NEAR_DUPLICATE", IDN, M, "Logo closely matches the organisation's logo"),
    Rule("R-ID-05", "TYPOSQUATTING_PATTERN", IDN, L, "Domain resembles a verified domain"),
    Rule("R-ID-06", "SUBDOMAIN_IMPERSONATION", IDN, H, "Subdomain impersonates the brand"),
    Rule(
        "R-ID-07", "IDENTITY_MATCH_CONFIRMED", IDN, NFO, "Domain is registered by the organisation"
    ),
    # 7.3 Credential destination
    Rule(
        "R-CRED-01",
        "CREDENTIAL_DESTINATION_MISMATCH",
        CRD,
        C,
        "Credentials go somewhere the organisation does not use",
    ),
    Rule(
        "R-CRED-02",
        "CREDENTIALS_POSTED_TO_THIRD_PARTY",
        CRD,
        H,
        "Credentials are sent to a third party",
    ),
    Rule(
        "R-CRED-03",
        "CREDENTIALS_POSTED_OVER_HTTP",
        CRD,
        C,
        "Credentials are sent without encryption",
    ),
    Rule(
        "R-CRED-04",
        "PASSWORD_FIELD_ON_UNVERIFIED_DOMAIN",
        CRD,
        H,
        "Password requested on an unverified domain",
    ),
    Rule(
        "R-CRED-05",
        "LOGIN_ENDPOINT_NOT_AUTHORISED",
        CRD,
        H,
        "This host is not an approved login page",
    ),
    Rule(
        "R-CRED-06",
        "ACTION_NOT_OBSERVABLE",
        CRD,
        L,
        "Where the form sends data could not be determined",
    ),
    Rule("R-CRED-07", "LOGIN_ON_VERIFIED_ENDPOINT", CRD, NFO, "Login goes to an approved endpoint"),
    # 7.4 Payment destination
    Rule(
        "R-PAY-01",
        "PAYEE_NOT_IN_VERIFIED_PROFILE",
        PAY,
        C,
        "Payment address is not registered by the organisation",
    ),
    Rule("R-PAY-02", "PAYEE_UNVERIFIABLE", PAY, M, "Payment address cannot be verified"),
    Rule("R-PAY-03", "PAYEE_NOT_VERIFIED", PAY, M, "Payment address is awaiting attestation"),
    Rule(
        "R-PAY-04",
        "PAYEE_LINKED_TO_REPORTED_SCAM",
        PAY,
        C,
        "Payment address is linked to confirmed scams",
    ),
    Rule(
        "R-PAY-05", "PAYMENT_HOST_MISMATCH", PAY, H, "Payment page is not an approved payment host"
    ),
    Rule(
        "R-PAY-06",
        "PAYEE_MATCH_CONFIRMED",
        PAY,
        NFO,
        "Payment address is registered by the organisation",
    ),
    # 7.5 Infrastructure
    Rule("R-INF-01", "DOMAIN_RECENTLY_REGISTERED", INF, L, "Domain was registered recently"),
    Rule("R-INF-02", "DOMAIN_NXDOMAIN", INF, H, "Domain does not resolve"),
    Rule("R-INF-03", "TLS_HANDSHAKE_FAILED", INF, H, "Encrypted connection failed"),
    Rule("R-INF-04", "CERT_EXPIRED", INF, H, "Certificate has expired"),
    Rule("R-INF-05", "CERT_HOSTNAME_MISMATCH", INF, H, "Certificate does not cover this host"),
    Rule("R-INF-06", "CERT_CHAIN_UNVERIFIED", INF, H, "Certificate chain could not be verified"),
    Rule("R-INF-07", "CERT_WEAK_KEY", INF, M, "Certificate uses a weak key"),
    Rule("R-INF-08", "CERT_WEAK_SIGNATURE", INF, H, "Certificate uses a weak signature"),
    Rule(
        "R-INF-09",
        "CERT_ISSUER_AFFECTED_BY_INCIDENT",
        INF,
        H,
        "Certificate issuer is named in an incident",
    ),
    Rule(
        "R-INF-10",
        "SHARES_INFRA_WITH_REPORTED_THREAT",
        INF,
        M,
        "Shares infrastructure with a reported threat",
    ),
    Rule("R-INF-11", "REDIRECT_CHAIN_TOO_LONG", INF, L, "Redirect chain is unusually long"),
    Rule(
        "R-INF-12",
        "REDIRECT_TO_BLOCKED_TARGET",
        INF,
        H,
        "A redirect pointed into a blocked network",
    ),
    Rule("R-INF-13", "PAGE_FETCH_BLOCKED", INF, L, "The page refused our fetch"),
    Rule(
        "R-INF-14", "DOM_FINGERPRINT_MATCH", INF, M, "Page structure matches a known phishing kit"
    ),
    Rule("R-INF-15", "ALL_CHECKS_UNAVAILABLE", INF, H, "No check could complete"),
    # 7.7 Messages (MESSAGE_ANALYSIS.md §4) — emitted only by message analysis
    Rule("R-MSG-01", "MESSAGE_CREDENTIAL_REQUEST", CRD, H, "Message asks for secret credentials"),
    Rule("R-MSG-02", "MESSAGE_PAYMENT_DEMAND", PAY, H, "Message asks for a payment"),
    Rule(
        "R-MSG-03",
        "MESSAGE_IMPERSONATES_ORGANISATION",
        IDN,
        M,
        "Sender is not an address the organisation uses",
    ),
    Rule(
        "R-MSG-04",
        "MESSAGE_LINK_TO_UNVERIFIED_CLAIM",
        IDN,
        M,
        "Link goes to a domain the named organisation has not verified",
    ),
    Rule("R-MSG-05", "MESSAGE_URGENCY_PRESSURE", IDN, L, "Message uses pressure or urgency"),
    Rule(
        "R-MSG-06",
        "MESSAGE_CONTACT_CHANNEL_MISMATCH",
        IDN,
        L,
        "Message moves contact to an unofficial channel",
    ),
    Rule("R-MSG-07", "MESSAGE_LINK_BLOCKED", REP, C, "A link in the message was assessed BLOCK"),
    Rule("R-MSG-08", "MESSAGE_LINK_WARNED", REP, M, "A link in the message was assessed WARN"),
    Rule(
        "R-MSG-09",
        "MESSAGE_NO_MALICIOUS_INDICATOR",
        IDN,
        NFO,
        "No malicious indicator found in the executed checks",
    ),
]

# Message policy sets (RISK_ENGINE.md §8.1a).
LANGUAGE_ONLY_CODES = frozenset({"MESSAGE_URGENCY_PRESSURE", "MESSAGE_CONTACT_CHANNEL_MISMATCH"})
CORROBORATING_CODES = frozenset(
    {
        "PAYEE_NOT_IN_VERIFIED_PROFILE",
        "PAYEE_LINKED_TO_REPORTED_SCAM",
        "KNOWN_MALICIOUS_REPUTATION",
        "MESSAGE_IMPERSONATES_ORGANISATION",
        "MESSAGE_LINK_TO_UNVERIFIED_CLAIM",
        "MESSAGE_LINK_BLOCKED",
        "MESSAGE_LINK_WARNED",
    }
)
SENDER_VERIFIED_CODES = frozenset({"IDENTITY_MATCH_CONFIRMED", "PAYEE_MATCH_CONFIRMED"})

RULES: dict[str, Rule] = {r.code: r for r in _RULES}

# Cross-cutting, unscored codes (§7.6). They never contribute points.
TARGET_UNREACHABLE = "TARGET_UNREACHABLE"
NO_KNOWN_THREAT_IN_COVERAGE = "NO_KNOWN_THREAT_IN_COVERAGE"


def rule(code: str) -> Rule:
    try:
        return RULES[code]
    except KeyError:
        raise ValueError(
            f"unknown finding code {code!r} — add it to RISK_ENGINE.md §7 first"
        ) from None
