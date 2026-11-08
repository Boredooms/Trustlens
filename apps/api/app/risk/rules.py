"""Rule evaluation: observations + trust context → findings + coverage (RISK_ENGINE.md §6, §7, §12).

Pure. Context is loaded by services (app/services/context.py); nothing here touches the network
or the database.

Subsumption (documented in RISK_ENGINE.md §7.7): when a specific rule fires, the generic rule it
refines is not emitted, so one fact is never counted twice within a group:
- R-ID-01 DOMAIN_NOT_REGISTERED_BY_BRAND subsumes R-ID-02/05/06 for the same claim.
- R-CRED-01 CREDENTIAL_DESTINATION_MISMATCH subsumes R-CRED-02/04/05.
- R-PAY-01 PAYEE_NOT_IN_VERIFIED_PROFILE subsumes R-PAY-05.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from app.risk.engine import INTENT_GROUPS, Finding
from app.schemas.enums import CoverageState, Intent, Severity, SignalGroup
from app.services.observations import ClientObservation, Observations

D = Decimal


@dataclass(frozen=True)
class OrgContext:
    id: str
    name: str
    brand_tokens: tuple[str, ...]
    logo_phash: str | None
    verified_domains: tuple[tuple[str, str], ...]  # (domain, kind) with status verified
    verified_recipients: tuple[str, ...]  # normalised values, status verified
    pending_recipients: tuple[str, ...]  # normalised values, pending_attestation
    simulated: bool = False
    # ORGANISATION_TRUST_PROFILES.md §4.3: "domain_wildcard" (default) | "explicit_only"
    login_hosts_mode: str = "domain_wildcard"

    def domain_verified(self, host: str) -> bool:
        return any(host == d or host.endswith("." + d) for d, _ in self.verified_domains)

    def login_hosts(self) -> tuple[str, ...]:
        if self.login_hosts_mode == "explicit_only":
            return tuple(d for d, kind in self.verified_domains if kind == "login")
        return tuple(d for d, kind in self.verified_domains if kind in ("login", "official"))

    def login_host_approved(self, host: str) -> bool:
        """explicit_only: exact kind=login hosts only; wildcard: any subdomain is inherited."""
        if self.login_hosts_mode == "explicit_only":
            return host in self.login_hosts()
        return any(host == h or host.endswith("." + h) for h in self.login_hosts())


@dataclass(frozen=True)
class RelatedThreat:
    label: str
    via: str  # "submits_to" | "requests_payment_to"
    confidence: Decimal


@dataclass(frozen=True)
class TrustContext:
    claimed_org: OrgContext | None = None
    conflicting_claims: bool = False
    token_similarity: float = 0.0
    domain_reputation: int = 0
    analyst_blocked: bool = False
    pending_reporters_7d: int = 0
    related_threats: tuple[RelatedThreat, ...] = ()
    reported_infra_shares: tuple[str, ...] = ()  # human labels of shared features
    payee_confirmed_reports: int = 0
    incidents: tuple[tuple[str, str, bool], ...] = ()  # (issuer_cn, title, simulated)
    reputation_block_threshold: int = -60


@dataclass
class Evaluation:
    findings: list[Finding] = field(default_factory=list)
    coverage: dict[SignalGroup, CoverageState] = field(default_factory=dict)
    action: dict[str, object] = field(default_factory=dict)
    target_unreachable: bool = False


def normalise_payee(value: str) -> str:
    return value.strip().lower()


def _host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return (urlsplit(url).hostname or "").lower() or None
    except ValueError:
        return None


def _hamming_hex(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def evaluate(
    obs: Observations,
    ctx: TrustContext,
    intent: Intent,
    client: ClientObservation | None = None,
) -> Evaluation:
    ev = Evaluation()
    groups = INTENT_GROUPS[intent]
    sim = obs.simulated
    org = ctx.claimed_org
    client = client or ClientObservation()
    page_ok = obs.page.status == "collected"

    def add(
        code: str,
        conf: str | Decimal,
        detail: str,
        *,
        keys: tuple[str, ...] = (),
        **kw: Any,
    ) -> None:
        ev.findings.append(
            Finding(
                code=code,
                confidence=D(conf),
                detail=detail,
                evidence_keys=keys,
                simulated=sim,
                **kw,
            )
        )

    # ── Reputation (always evaluated; the DB lookup is authoritative) ──────────
    ev.coverage[SignalGroup.REPUTATION] = CoverageState.COLLECTED
    if ctx.analyst_blocked:
        add("DOMAIN_ON_ANALYST_BLOCKLIST", "1.00", f"An analyst has blocked {obs.host}.")
    if ctx.domain_reputation <= ctx.reputation_block_threshold:
        add(
            "KNOWN_MALICIOUS_REPUTATION",
            "1.00",
            f"{obs.host} has a reputation of {ctx.domain_reputation} from confirmed reports.",
            observed={"reputation_score": ctx.domain_reputation},
        )
    for src in obs.intel.sources:
        if src.get("status") == "listed":
            # Attribution travels with the finding; a fixture hit is labelled simulated.
            ev.findings.append(
                Finding(
                    code="LISTED_BY_EXTERNAL_FEED",
                    confidence=D("1.00"),
                    detail=(
                        f"{src['source_name']} lists {src['indicator']} "
                        f"({src.get('threat') or 'malicious'}), queried {src['queried_at']}."
                    ),
                    observed={
                        k: src.get(k)
                        for k in (
                            "source",
                            "source_name",
                            "mode",
                            "indicator",
                            "listing_id",
                            "threat",
                            "url_status",
                            "reference",
                            "queried_at",
                        )
                    },
                    evidence_keys=("intel",),
                    simulated=sim or src.get("mode") == "fixture",
                )
            )
            break
    strongest = max(ctx.related_threats, key=lambda t: t.confidence, default=None)
    if strongest is not None and strongest.confidence >= D("0.70"):
        add(
            "RELATED_THREAT_FOUND",
            strongest.confidence,
            f"This page sends data to {strongest.label}, which is part of a confirmed threat.",
            observed={"related": strongest.label, "via": strongest.via},
            keys=("page",),
        )
    if ctx.pending_reporters_7d >= 2:
        add(
            "REPORTED_BY_COMMUNITY",
            "0.80",
            f"{ctx.pending_reporters_7d} people reported {obs.host} in the last 7 days.",
            observed={"reporters": ctx.pending_reporters_7d},
        )

    # ── Identity ────────────────────────────────────────────────────────────────
    if org is not None:
        ev.coverage[SignalGroup.IDENTITY] = CoverageState.COLLECTED
        if ctx.conflicting_claims:
            add(
                "IDENTITY_CLAIM_UNVERIFIABLE",
                "0.80",
                "The page claims more than one organisation.",
                observed={"conflicting_claims": True},
            )
        elif org.domain_verified(obs.host):
            add(
                "IDENTITY_MATCH_CONFIRMED",
                "1.00",
                f"{obs.host} is a verified domain of {org.name}.",
                observed={"domain": obs.host},
                expected={"domains": [d for d, _ in org.verified_domains]},
            )
        elif not org.verified_domains:
            add(
                "IDENTITY_CLAIM_UNVERIFIABLE",
                "0.80",
                f"The page claims to be {org.name}, "
                "which has no verified domains to compare against.",
            )
        else:
            add(
                "DOMAIN_NOT_REGISTERED_BY_BRAND",
                "0.95",
                f"The page claims to be {org.name}, "
                f"but {obs.host} is not one of its verified domains.",
                observed={"domain": obs.host},
                expected={"domains": [d for d, _ in org.verified_domains]},
                keys=("page", "dns"),
            )
            if org.logo_phash and obs.page.logo_phash:
                distance = _hamming_hex(org.logo_phash, obs.page.logo_phash)
                if distance <= 8:
                    add(
                        "LOGO_NEAR_DUPLICATE",
                        "0.80",
                        f"The page logo is {distance}/64 bits from {org.name}'s registered logo.",
                        observed={"distance": distance},
                        keys=("page",),
                    )
    elif page_ok:
        ev.coverage[SignalGroup.IDENTITY] = CoverageState.COLLECTED  # no claim found: information
    else:
        ev.coverage[SignalGroup.IDENTITY] = CoverageState.UNAVAILABLE

    # ── Credential destination ─────────────────────────────────────────────────
    if SignalGroup.CREDENTIAL_DESTINATION not in groups:
        ev.coverage[SignalGroup.CREDENTIAL_DESTINATION] = CoverageState.SKIPPED
    else:
        pw_forms = [f for f in obs.page.forms if f.has_password]
        action = client.form_action if (client.form_action and intent == Intent.LOGIN) else None
        if action is None and pw_forms:
            action = pw_forms[0].action
        has_login = bool(pw_forms) or (intent == Intent.LOGIN and client.form_action is not None)
        if not page_ok and client.form_action is None:
            ev.coverage[SignalGroup.CREDENTIAL_DESTINATION] = CoverageState.UNAVAILABLE
        else:
            ev.coverage[SignalGroup.CREDENTIAL_DESTINATION] = CoverageState.COLLECTED
            if has_login:
                dest = _host(action)
                if dest is None:
                    add(
                        "ACTION_NOT_OBSERVABLE",
                        "0.80",
                        "The login form's destination could not be determined.",
                    )
                elif urlsplit(action or "").scheme == "http" and obs.scheme == "https":
                    add(
                        "CREDENTIALS_POSTED_OVER_HTTP",
                        "1.00",
                        f"Credentials are sent to {dest} without encryption.",
                        observed={"destination": action},
                        keys=("page",),
                    )
                elif org is not None:
                    approved = org.login_hosts()
                    if org.login_host_approved(dest):
                        add(
                            "LOGIN_ON_VERIFIED_ENDPOINT",
                            "1.00",
                            f"The login form posts to {dest}, approved by {org.name}.",
                            observed={"destination": dest},
                        )
                    else:
                        add(
                            "CREDENTIAL_DESTINATION_MISMATCH",
                            "0.90",
                            f"The login form sends credentials to {dest}; {org.name} uses "
                            f"{', '.join(approved) or 'no listed endpoint'}.",
                            observed={"destination": dest},
                            expected={"destinations": list(approved)},
                            keys=("page",),
                        )
                else:
                    from app.services.guard import registrable_domain

                    if registrable_domain(dest) != obs.registrable_domain:
                        add(
                            "CREDENTIALS_POSTED_TO_THIRD_PARTY",
                            "0.80",
                            f"The login form sends credentials to a different site, {dest}.",
                            observed={"destination": dest},
                            keys=("page",),
                        )
                ev.action.update({"observed_destination": action})

    # ── Payment destination ────────────────────────────────────────────────────
    if SignalGroup.PAYMENT_DESTINATION not in groups:
        ev.coverage[SignalGroup.PAYMENT_DESTINATION] = CoverageState.SKIPPED
    else:
        payee_raw = client.payee or (obs.page.payees[0]["value"] if obs.page.payees else None)
        if not page_ok and client.payee is None:
            ev.coverage[SignalGroup.PAYMENT_DESTINATION] = CoverageState.UNAVAILABLE
        else:
            ev.coverage[SignalGroup.PAYMENT_DESTINATION] = CoverageState.COLLECTED
            pay_forms = [f for f in obs.page.forms if not f.has_password and f.action]
            destination = client.form_action or (pay_forms[0].action if pay_forms else None)
            match = "unverifiable"
            if payee_raw:
                payee = normalise_payee(payee_raw)
                if ctx.payee_confirmed_reports >= 2:
                    add(
                        "PAYEE_LINKED_TO_REPORTED_SCAM",
                        "1.00",
                        f"{payee} is linked to {ctx.payee_confirmed_reports} "
                        "confirmed scam reports.",
                        observed={"payee": payee, "reports": ctx.payee_confirmed_reports},
                    )
                if org is not None:
                    expected = list(org.verified_recipients)
                    if payee in org.verified_recipients:
                        match = "exact"
                        add(
                            "PAYEE_MATCH_CONFIRMED",
                            "1.00",
                            f"{payee} is registered by {org.name}.",
                            observed={"payee": payee, "match": "exact"},
                            expected={"payees": expected},
                        )
                    elif payee in org.pending_recipients:
                        add(
                            "PAYEE_NOT_VERIFIED",
                            "1.00",
                            f"{payee} is awaiting attestation by {org.name}.",
                            observed={"payee": payee},
                            expected={"payees": expected},
                        )
                    elif expected:
                        match = "none"
                        add(
                            "PAYEE_NOT_IN_VERIFIED_PROFILE",
                            "1.00",
                            f"The page asks for a transfer to {payee}; "
                            f"{org.name} has registered {', '.join(expected)}.",
                            observed={"payee": payee, "match": "none"},
                            expected={"payees": expected},
                            keys=("page",),
                        )
                    else:
                        add(
                            "PAYEE_UNVERIFIABLE",
                            "1.00",
                            f"{org.name} has not registered payment addresses, "
                            f"so {payee} cannot be checked.",
                            observed={"payee": payee, "match": "unverifiable"},
                        )
                ev.action.update({"payee": payee})
            ev.action.update({"match": match})
            if destination:
                ev.action.setdefault("observed_destination", destination)
            if intent == Intent.PAYMENT and destination:
                ev.action["observed_destination"] = destination

    # ── Infrastructure ─────────────────────────────────────────────────────────
    dns_ok = obs.dns.status == "collected"
    tls_ok = obs.tls.status == "collected"
    ev.coverage[SignalGroup.INFRASTRUCTURE] = (
        CoverageState.COLLECTED if dns_ok and tls_ok else CoverageState.UNAVAILABLE
    )
    if obs.dns.nxdomain:
        add("DOMAIN_NXDOMAIN", "1.00", f"{obs.host} does not resolve.", keys=("dns",))
        ev.target_unreachable = True
    age = obs.registration.age_days
    if age is not None and age < 30:
        severity = Severity.MEDIUM if (age < 7 and org is not None) else None
        add(
            "DOMAIN_RECENTLY_REGISTERED",
            "1.00",
            f"{obs.registrable_domain} was registered {age} days ago.",
            observed={"age_days": age},
            keys=("rdap",),
            severity_override=severity,
        )
    t = obs.tls
    sensitive = intent in (Intent.LOGIN, Intent.PAYMENT)
    if t.handshake_failed:
        add(
            "TLS_HANDSHAKE_FAILED",
            "1.00",
            f"An encrypted connection to {obs.host} failed.",
            keys=("tls",),
            severity_override=None if sensitive else Severity.MEDIUM,
        )
    if t.presented:
        if t.days_to_expiry is not None and t.days_to_expiry < 0:
            add("CERT_EXPIRED", "1.00", "The certificate has expired.", keys=("tls",))
        if not t.hostname_ok:
            add(
                "CERT_HOSTNAME_MISMATCH",
                "1.00",
                f"The certificate does not cover {obs.host}.",
                keys=("tls",),
            )
        elif t.self_signed:
            # Subsumes CERT_CHAIN_UNVERIFIED: the same fact, stated precisely (§7.6a).
            add(
                "CERT_SELF_SIGNED",
                "1.00",
                f"The certificate is issued by itself ({t.issuer_cn}).",
                observed={"issuer": t.issuer_cn, "subject": t.subject_cn},
                keys=("tls",),
            )
        elif not t.verified:
            add(
                "CERT_CHAIN_UNVERIFIED",
                "1.00",
                "The certificate chain could not be verified.",
                keys=("tls",),
            )
        if t.days_to_expiry is not None and 0 <= t.days_to_expiry <= 14:
            add(
                "CERT_EXPIRING_SOON",
                "1.00",
                f"The certificate expires in {t.days_to_expiry} days.",
                observed={"days_to_expiry": t.days_to_expiry, "not_after": t.not_after},
                keys=("tls",),
            )
        if t.not_yet_valid:
            add(
                "CERT_NOT_YET_VALID",
                "1.00",
                "The certificate is not valid yet.",
                observed={"not_before": t.not_before},
                keys=("tls",),
            )
        if t.revocation.get("status") == "revoked":
            add(
                "CERT_REVOKED",
                "1.00",
                "The issuer reports this certificate as revoked.",
                observed={
                    k: t.revocation.get(k)
                    for k in ("responder", "this_update", "revoked_at", "reason")
                },
                keys=("tls",),
            )
        if t.sct_count == 0 and t.verified:
            # Low confidence: SCTs can also arrive in the TLS handshake or a stapled OCSP response.
            add(
                "CERT_NO_EMBEDDED_SCT",
                "0.50",
                "The certificate carries no embedded Certificate Transparency timestamps.",
                observed={"embedded_scts": 0},
                keys=("tls",),
            )
        if t.key_bits and (
            (t.key_type == "RSA" and t.key_bits < 2048) or (t.key_type == "EC" and t.key_bits < 224)
        ):
            add("CERT_WEAK_KEY", "1.00", f"{t.key_type} key of {t.key_bits} bits.", keys=("tls",))
        if t.signature_algorithm and t.signature_algorithm.lower() in ("md5", "sha1"):
            add(
                "CERT_WEAK_SIGNATURE",
                "1.00",
                f"Signature uses {t.signature_algorithm}.",
                keys=("tls",),
            )
        for issuer, title, simulated in ctx.incidents:
            if issuer in (t.issuer_cn, t.root_issuer_cn):
                ev.findings.append(
                    Finding(
                        code="CERT_ISSUER_AFFECTED_BY_INCIDENT",
                        confidence=D("1.00"),
                        detail=(
                            f"The certificate chain depends on {issuer}, "
                            f"named in incident '{title}'."
                        ),
                        observed={"issuer": issuer, "incident": title, "simulated": simulated},
                        evidence_keys=("tls",),
                        # §10: a simulated incident is info (0 points) but still shown and labelled.
                        severity_override=Severity.INFO if simulated else None,
                        simulated=simulated or sim,
                    )
                )
    if ctx.reported_infra_shares:
        add(
            "SHARES_INFRA_WITH_REPORTED_THREAT",
            "0.70",
            f"{obs.host} shares {', '.join(ctx.reported_infra_shares)} with a reported site.",
            observed={"shared": ", ".join(ctx.reported_infra_shares)},
            keys=("dns",),
        )
    if obs.redirects.too_many:
        add("REDIRECT_CHAIN_TOO_LONG", "1.00", "The address redirects more than 10 times.")
    if obs.redirects.blocked_hop:
        add(
            "REDIRECT_TO_BLOCKED_TARGET",
            "1.00",
            "A redirect pointed into a blocked network.",
            observed={"reason": obs.redirects.blocked_hop.get("reason")},
        )
    if obs.page.fetch_blocked:
        add("PAGE_FETCH_BLOCKED", "1.00", f"{obs.host} refused our page fetch.")

    if (
        not any(
            state == CoverageState.COLLECTED
            for g, state in ev.coverage.items()
            if g != SignalGroup.REPUTATION
        )
        and not dns_ok
    ):
        add("ALL_CHECKS_UNAVAILABLE", "1.00", f"No check could complete for {obs.host}.")
        ev.target_unreachable = True

    # Findings for groups not evaluated under this intent are dropped (§12): skipped ≠ passed.
    ev.findings = [f for f in ev.findings if f.group in groups]
    return ev
