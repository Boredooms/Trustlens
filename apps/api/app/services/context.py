"""Load the trust context a scan is judged against (profiles, reputation, related threats)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.tables import (
    CertificateIncident,
    Entity,
    Organisation,
    Relationship,
    ThreatReport,
    VerifiedDomain,
    VerifiedRecipient,
)
from app.risk.rules import OrgContext, RelatedThreat, TrustContext, normalise_payee
from app.services.observations import ClientObservation, Observations
from app.utils import utcnow


async def load_org(db: AsyncSession, org_id: str) -> OrgContext | None:
    org = await db.get(Organisation, org_id)
    if org is None or org.status == "suspended":
        return None
    domains = (
        await db.execute(
            select(VerifiedDomain.domain, VerifiedDomain.kind).where(
                VerifiedDomain.organisation_id == org.id,
                VerifiedDomain.status == "verified",
                # A lapsed verification no longer vouches for the domain (lazy expiry,
                # ORGANISATION_TRUST_PROFILES.md §4.1); the cert-sweep job marks it expired.
                or_(VerifiedDomain.expires_at.is_(None), VerifiedDomain.expires_at > utcnow()),
            )
        )
    ).all()
    recipients = (
        await db.execute(
            select(VerifiedRecipient.normalised_value, VerifiedRecipient.status).where(
                VerifiedRecipient.organisation_id == org.id
            )
        )
    ).all()
    return OrgContext(
        id=org.id,
        name=org.name,
        brand_tokens=tuple(org.brand_tokens),
        logo_phash=org.logo_phash,
        verified_domains=tuple((d, k) for d, k in domains),
        verified_recipients=tuple(v for v, s in recipients if s == "verified"),
        pending_recipients=tuple(v for v, s in recipients if s == "pending_attestation"),
        simulated=org.simulated,
        login_hosts_mode=org.login_hosts_mode,
    )


async def detect_claims(db: AsyncSession, obs: Observations) -> list[str]:
    """Organisations whose brand tokens appear in the page title/text or the host labels."""
    haystack = " ".join(
        [
            (obs.page.title or "").lower(),
            obs.page.text_sample,
            obs.host.replace("-", " ").replace(".", " "),
        ]
    )
    rows = (
        await db.execute(
            select(Organisation.id, Organisation.brand_tokens).where(
                Organisation.status == "active"
            )
        )
    ).all()
    claimed = []
    for org_id, tokens in rows:
        if any(token and token.lower() in haystack for token in tokens):
            claimed.append(org_id)
    return claimed


async def build_context(
    db: AsyncSession,
    obs: Observations,
    settings: Settings,
    *,
    organisation_id: str | None,
    client: ClientObservation | None = None,
) -> TrustContext:
    claims = await detect_claims(db, obs)
    org_id = organisation_id or (claims[0] if claims else None)
    conflicting = organisation_id is None and len(set(claims)) > 1
    org = await load_org(db, org_id) if org_id else None

    domain_entity = (
        await db.execute(
            select(Entity).where(Entity.type == "domain", Entity.key == f"domain:{obs.host}")
        )
    ).scalar_one_or_none()

    pending = 0
    if domain_entity is not None:
        pending = (
            await db.execute(
                select(func.count(func.distinct(ThreatReport.reporter_user_id))).where(
                    ThreatReport.entity_id == domain_entity.id,
                    ThreatReport.status == "pending",
                    ThreatReport.created_at > utcnow() - timedelta(days=7),
                )
            )
        ).scalar_one()

    # 1-hop relations to confirmed threats through what this page sends data to (THREAT_GRAPH §4).
    client = client or ClientObservation()
    sink_urls = {f.action for f in obs.page.forms if f.action}
    if client.form_action:
        sink_urls.add(client.form_action)
    payees = {normalise_payee(p["value"]) for p in obs.page.payees}
    if client.payee:
        payees.add(normalise_payee(client.payee))
    keys = [f"url:{u}" for u in sink_urls] + [f"payee:upi_vpa:{p}" for p in payees]
    related: list[RelatedThreat] = []
    if keys:
        for entity in (await db.execute(select(Entity).where(Entity.key.in_(keys)))).scalars():
            if entity.attributes.get("confirmed_threat"):
                via = "requests_payment_to" if entity.type == "payment_recipient" else "submits_to"
                conf = Decimal("0.90") if via == "requests_payment_to" else Decimal("0.85")
                related.append(RelatedThreat(label=entity.label, via=via, confidence=conf))

    shares = await reported_infra_shares(db, obs)

    payee_reports = 0
    if payees:
        payee_reports = (
            await db.execute(
                select(func.count()).where(
                    func.lower(ThreatReport.observed_payee).in_(payees),
                    ThreatReport.status == "confirmed",
                )
            )
        ).scalar_one()

    incidents = tuple(
        (i.issuer_cn, i.title, i.simulated)
        for i in (await db.execute(select(CertificateIncident))).scalars()
    )
    return TrustContext(
        claimed_org=org,
        conflicting_claims=conflicting,
        domain_reputation=domain_entity.reputation_score if domain_entity else 0,
        analyst_blocked=bool(domain_entity and domain_entity.attributes.get("analyst_blocked")),
        pending_reporters_7d=int(pending),
        related_threats=tuple(related),
        reported_infra_shares=shares,
        payee_confirmed_reports=int(payee_reports),
        incidents=incidents,
        reputation_block_threshold=settings.reputation_block_threshold,
    )


async def reported_infra_shares(db: AsyncSession, obs: Observations) -> tuple[str, ...]:
    """Infrastructure this host shares with a *different* site that has a report (R-INF-10)."""
    reported_domains = (
        select(ThreatReport.entity_id)
        .where(ThreatReport.status.in_(("pending", "reviewing", "confirmed")))
        .where(ThreatReport.entity_id.is_not(None))
    )
    shared: list[str] = []
    ns_keys = [f"nameserver:{ns}" for ns in obs.dns.ns]
    if ns_keys and await _other_site(db, obs, "MANAGED_BY", ns_keys, reported_domains):
        shared.append("nameservers " + ", ".join(sorted(obs.dns.ns)))
    prefixes = {".".join(a.split(".")[:3]) for a in obs.dns.a}
    for prefix in sorted(prefixes):
        ip_keys_like = f"ip:{prefix}.%"
        if await _other_site(db, obs, "RESOLVES_TO", None, reported_domains, like=ip_keys_like):
            shared.append(f"hosting range {prefix}.0/24")
    return tuple(shared)


async def _other_site(db, obs, edge_type, keys, reported_domains, like=None) -> bool:  # type: ignore[no-untyped-def]
    target = select(Entity.id).where(Entity.key.in_(keys) if keys else Entity.key.like(like))
    rows = (
        await db.execute(
            select(Entity.key)
            .join(Relationship, Relationship.source_entity_id == Entity.id)
            .where(
                Relationship.type == edge_type,
                Relationship.target_entity_id.in_(target),
                Relationship.source_entity_id.in_(reported_domains),
            )
        )
    ).all()
    from app.services.guard import registrable_domain

    return any(
        registrable_domain(k.removeprefix("domain:")) != obs.registrable_domain for (k,) in rows
    )
