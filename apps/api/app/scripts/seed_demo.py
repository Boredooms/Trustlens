"""Seed the canonical demo dataset (DEMO_RUNBOOK.md §3). Idempotent.

Run from apps/api: ``python -m app.scripts.seed_demo``. Refuses ENVIRONMENT=production unless
ALLOW_DEMO_SEED=1. Every seeded row carries ``simulated = true`` (ADR-010).

Order matters and is part of the story:
1. Northstar University's verified profile, recipients and monitored certificates.
2. Lookalike 2 is scanned and receives a *pending* community report.
3. Lookalikes 3 and 1 are scanned; they share nameservers and hosting with the reported lookalike 2,
   so ``SHARES_INFRA_WITH_REPORTED_THREAT`` fires — reproducing the RISK_ENGINE §5.2 worked example.
4. Campaign clustering runs over the three lookalikes.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.db.engine import create_engine, create_session_factory
from app.intelligence import campaigns
from app.models.tables import (
    Certificate,
    CertificateMonitor,
    Entity,
    Organisation,
    OrganisationMember,
    Scan,
    ThreatReport,
    User,
    VerifiedDomain,
    VerifiedRecipient,
)
from app.services import guard
from app.services.demo_fixtures import NORTHSTAR_LOGO_PHASH
from app.services.scan_orchestrator import execute
from app.utils import new_ulid, utcnow

ORG_NAME = "Northstar University"
USERS = [
    ("operator@trustlens.local", "Operator", "operator"),
    ("analyst@trustlens.local", "Analyst", "analyst"),
    ("admin@northstar-demo.example", "Northstar Admin", "user"),
    ("community@trustlens.local", "Community reporter (simulated)", "user"),
]
DOMAINS = [
    ("northstar-demo.example", "official"),
    ("login.northstar-demo.example", "login"),
    ("pay.northstar-demo.example", "payment"),
]
MONITORS = [  # domain, days to expiry, issuer, fingerprint seed
    ("northstar-demo.example", 89, "Demo Intermediate CA", "a1"),
    ("login.northstar-demo.example", 21, "Demo Intermediate CA", "b2"),
    ("pay.northstar-demo.example", 140, "Example Trust CA", "c3"),
]
LOOKALIKES = [  # url, intent — order is deliberate (module docstring)
    ("https://apply.northstar-scholarships.example/claim", "payment"),
    ("https://portal.northstar-placement.example/login", "login"),
    ("https://apply.northstar-admissions.example/register", "payment"),
]
GENUINE = [("https://pay.northstar-demo.example/fees", "payment")]


async def seed(
    factory: async_sessionmaker[AsyncSession] | None = None, settings: Settings | None = None
) -> None:
    """Seed the dataset. The API passes its own session factory (operator demo reset); the CLI
    creates and disposes an engine."""
    settings = settings or get_settings()
    if settings.is_production and not settings.allow_demo_seed:
        sys.exit("Refusing to seed demo data in production without ALLOW_DEMO_SEED=1.")
    demo_settings = settings.model_copy(update={"demo_mode": True})
    engine = create_engine(settings.database_url) if factory is None else None
    factory = factory or create_session_factory(engine)  # type: ignore[arg-type]
    now = utcnow()

    async with factory() as db:
        users: dict[str, User] = {}
        for email, name, role in USERS:
            user = (
                await db.execute(select(User).where(User.clerk_user_id == f"dev_{email}"))
            ).scalar_one_or_none()
            if user is None:
                user = User(
                    id=new_ulid(),
                    clerk_user_id=f"dev_{email}",
                    email=email,
                    display_name=name,
                    role=role,
                    email_verified_at=now,
                )
                db.add(user)
            users[email] = user
        await db.flush()

        org = (
            await db.execute(select(Organisation).where(Organisation.name == ORG_NAME))
        ).scalar_one_or_none()
        if org is None:
            org = Organisation(
                id=new_ulid(), name=ORG_NAME, created_by=users["admin@northstar-demo.example"].id
            )
            db.add(org)
        org.legal_name = "Northstar University Trust"
        org.country, org.sector = "IN", "education"
        org.support_email = "security@northstar-demo.example"
        org.brand_tokens = ["northstar"]
        org.logo_phash = NORTHSTAR_LOGO_PHASH
        org.status, org.simulated = "active", True
        await db.flush()

        admin = users["admin@northstar-demo.example"]
        member = (
            await db.execute(
                select(OrganisationMember).where(
                    OrganisationMember.organisation_id == org.id,
                    OrganisationMember.user_id == admin.id,
                )
            )
        ).scalar_one_or_none()
        if member is None:
            db.add(
                OrganisationMember(
                    id=new_ulid(), organisation_id=org.id, user_id=admin.id, role="org_admin"
                )
            )

        for domain, kind in DOMAINS:
            row = (
                await db.execute(select(VerifiedDomain).where(VerifiedDomain.domain == domain))
            ).scalar_one_or_none()
            if row is None:
                row = VerifiedDomain(id=new_ulid(), organisation_id=org.id, domain=domain)
                db.add(row)
            row.kind, row.status = kind, "verified"
            row.verified_at, row.expires_at = now, now + timedelta(days=180)

        recipient = (
            await db.execute(
                select(VerifiedRecipient).where(
                    VerifiedRecipient.organisation_id == org.id,
                    VerifiedRecipient.normalised_value == "fees@northstar-demo",
                )
            )
        ).scalar_one_or_none()
        if recipient is None:
            recipient = VerifiedRecipient(
                id=new_ulid(),
                organisation_id=org.id,
                recipient_type="upi_vpa",
                value="fees@northstar-demo",
                normalised_value="fees@northstar-demo",
            )
            db.add(recipient)
        recipient.label = "Admissions fee account"
        recipient.status, recipient.verified_at = "verified", now
        recipient.verified_by = users["analyst@trustlens.local"].id
        recipient.evidence_ref = "simulated attestation (demo seed)"

        for domain, days, issuer, seed_fp in MONITORS:
            fingerprint = (seed_fp * 64)[:64]
            cert = (
                await db.execute(
                    select(Certificate).where(Certificate.fingerprint_sha256 == fingerprint)
                )
            ).scalar_one_or_none()
            if cert is None:
                cert = Certificate(id=new_ulid(), fingerprint_sha256=fingerprint, first_seen_at=now)
                db.add(cert)
            cert.subject_cn, cert.issuer_cn = domain, issuer
            cert.root_issuer_cn = (
                "Demo Root CA" if issuer == "Demo Intermediate CA" else "Example Root"
            )
            cert.sans = [domain]
            cert.not_before, cert.not_after = (
                now - timedelta(days=90 - days % 90),
                now + timedelta(days=days),
            )
            cert.key_type, cert.key_bits, cert.signature_algorithm = "EC", 256, "ecdsa-with-SHA256"
            cert.chain_length, cert.simulated, cert.last_seen_at = 3, True, now
            await db.flush()
            monitor = (
                await db.execute(
                    select(CertificateMonitor).where(
                        CertificateMonitor.organisation_id == org.id,
                        CertificateMonitor.domain == domain,
                    )
                )
            ).scalar_one_or_none()
            if monitor is None:
                monitor = CertificateMonitor(id=new_ulid(), organisation_id=org.id, domain=domain)
                db.add(monitor)
            monitor.current_certificate_id, monitor.last_checked_at = cert.id, now
        await db.commit()
        org_id = org.id
        community_id = users["community@trustlens.local"].id
        analyst_id = users["analyst@trustlens.local"].id

    async with httpx.AsyncClient() as http:
        for index, (url, intent) in enumerate(LOOKALIKES + GENUINE):
            target = guard.parse_target(url)
            async with factory() as db:
                existing = (
                    (
                        await db.execute(
                            select(Scan).where(
                                Scan.normalised_url == target.normalised_url,
                                Scan.intent == intent,
                                Scan.status == "completed",
                                Scan.simulated.is_(True),
                            )
                        )
                    )
                    .scalars()
                    .first()
                )
                if existing is None:
                    scan = Scan(
                        id=new_ulid(),
                        user_id=analyst_id,
                        url=url,
                        normalised_url=target.normalised_url,
                        registrable_domain=target.registrable_domain,
                        intent=intent,
                        simulated=True,
                    )
                    db.add(scan)
                    await db.commit()
                    scan_id = scan.id
                else:
                    scan_id = existing.id
            if existing is None:
                outcome = await execute(factory, demo_settings, http, scan_id)
                if outcome:
                    print(
                        f"  scan {url} [{intent}] -> {outcome.scan.decision} "
                        f"{outcome.scan.risk_level} {outcome.scan.risk_score} "
                        f"coverage {outcome.scan.coverage.get('percent')}% "
                        f"overrides {outcome.scan.overrides}"
                    )
            else:
                print(f"  scan {url} [{intent}] already seeded ({scan_id})")
            if index == 0:
                await _community_report(factory, community_id, url, scan_id)

    async with factory() as db:
        ids = await campaigns.recompute(db)
        await db.commit()
        print(f"  campaigns: {ids}")
    if engine is not None:
        await engine.dispose()
    print(f"Seeded {ORG_NAME} ({org_id}).")


async def _community_report(factory, reporter_id: str, url: str, scan_id: str) -> None:  # type: ignore[no-untyped-def]
    target = guard.parse_target(url)
    async with factory() as db:
        exists = (
            (
                await db.execute(
                    select(ThreatReport).where(
                        ThreatReport.normalised_url == target.normalised_url,
                        ThreatReport.simulated.is_(True),
                    )
                )
            )
            .scalars()
            .first()
        )
        if exists:
            return
        entity = (
            await db.execute(select(Entity).where(Entity.key == f"domain:{target.host}"))
        ).scalar_one()
        db.add(
            ThreatReport(
                id=new_ulid(),
                reporter_user_id=reporter_id,
                reporter_channel="web",
                url=url,
                normalised_url=target.normalised_url,
                entity_id=entity.id,
                scan_id=scan_id,
                justification=(
                    "Asked for a scholarship processing fee to a personal UPI ID "
                    "(simulated report)."
                ),
                intent="payment",
                observed_payee="fees@okaxis",
                status="pending",
                simulated=True,
            )
        )
        await db.commit()


async def reset(
    factory: async_sessionmaker[AsyncSession] | None = None, settings: Settings | None = None
) -> None:
    """Remove seeded scans/reports/campaigns/graph; keep org, domains, recipients (§10)."""
    settings = settings or get_settings()
    if settings.is_production and not settings.allow_demo_seed:
        sys.exit("Refusing to reset demo data in production without ALLOW_DEMO_SEED=1.")
    engine = create_engine(settings.database_url) if factory is None else None
    factory = factory or create_session_factory(engine)  # type: ignore[arg-type]
    async with factory() as db:
        from app.models.tables import Campaign, CertificateIncident, Investigation, Relationship

        await db.execute(delete(Investigation))
        from app.services.demo_fixtures import DEMO_REGISTRABLE_DOMAINS

        await db.execute(delete(ThreatReport).where(ThreatReport.simulated.is_(True)))
        for domain in DEMO_REGISTRABLE_DOMAINS:  # rehearsal reports filed through the API
            await db.execute(
                delete(ThreatReport).where(ThreatReport.normalised_url.like(f"%{domain}/%"))
            )
        await db.execute(delete(CertificateIncident).where(CertificateIncident.simulated.is_(True)))
        await db.execute(delete(Scan).where(Scan.simulated.is_(True)))
        await db.execute(delete(Relationship))
        await db.execute(
            delete(Entity).where(
                Entity.simulated.is_(True) | (Entity.type == "certificate_authority")
            )
        )
        await db.execute(delete(Campaign).where(Campaign.simulated.is_(True)))
        await db.commit()
    if engine is not None:
        await engine.dispose()
    print("Demo data reset (organisation, domains and recipients kept; audit rows untouched).")


if __name__ == "__main__":
    asyncio.run(seed())
