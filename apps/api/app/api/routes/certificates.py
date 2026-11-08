"""Certificates, monitors and incidents (API_ENDPOINTS.md §13, TL-020).

``POST /certificates/incidents`` needs role ``operator`` **and** DEMO_MODE; ``simulated`` cannot be
false (real advisory ingestion is FUTURE). The database also refuses an unflagged simulation.

Monitors belong to an organisation: ``org_admin`` (or an operator) creates and deletes them, only
for the organisation's verified domains and their subdomains (AUTHENTICATION_AUTHORIZATION.md §5.2).
Cross-tenant access is a 404, never a 403 (§5.4). Monitor lists are scoped to the caller's
organisations plus the seeded demo organisation; analysts and operators see all.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_human, require_operator
from app.errors import Conflict, DemoModeRequired, DomainError, Forbidden, NotFound
from app.models.tables import (
    AuditLog,
    Certificate,
    CertificateIncident,
    CertificateMonitor,
    Organisation,
    OrganisationMember,
    VerifiedDomain,
)
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.platform import CertificateDetail, MonitorCreate
from app.schemas.resources import (
    CertificateList,
    IncidentCreate,
    IncidentList,
    IncidentOut,
    MonitorList,
    MonitorOut,
)
from app.security.auth import Principal
from app.services import audit, guard
from app.services.collectors import collect_tls
from app.services.demo_fixtures import demo_observations, is_demo_host
from app.services.jobs import upsert_certificate
from app.services.serialise import ts
from app.utils import is_ulid, new_ulid, utcnow

router = APIRouter(prefix="/api/v1/certificates", tags=["certificates"], responses=ERROR_RESPONSES)
AFFECTED_CAP = 100
MAX_MONITORS_PER_ORG = 50
FIRST_CHECK_TIMEOUT_S = 8.0


class IncidentNotSimulated(DomainError):
    code, status, message = (
        ErrorCode.INCIDENT_NOT_SIMULATED,
        403,
        "Only simulated incidents can be created.",
    )


class OrganisationNotFound(DomainError):
    code, status, message = (
        ErrorCode.ORGANISATION_NOT_FOUND,
        404,
        "We could not find that organisation.",
    )


class DomainNotVerified(DomainError):
    code, status, message = (
        ErrorCode.DOMAIN_NOT_VERIFIED,
        409,
        "Only domains the organisation has verified (or their subdomains) can be monitored.",
    )


def _days(c: Certificate) -> int:
    return (c.not_after - utcnow()).days


async def _visible_org_ids(db: AsyncSession, principal: Principal) -> set[str] | None:
    """``None`` = every organisation (analyst/operator). Otherwise the user's organisations plus
    seeded demo organisations, which are shared demo material labelled as simulated."""
    if principal.is_analyst:
        return None
    rows = (
        await db.execute(
            select(Organisation.id)
            .outerjoin(
                OrganisationMember,
                (OrganisationMember.organisation_id == Organisation.id)
                & (OrganisationMember.user_id == principal.user.id),
            )
            .where(or_(OrganisationMember.id.is_not(None), Organisation.simulated.is_(True)))
        )
    ).scalars()
    return set(rows)


async def _require_org_admin(db: AsyncSession, org_id: str, principal: Principal) -> Organisation:
    """§5.4: unknown or cross-tenant -> 404; member (or analyst) without admin rights -> 403."""
    org = await db.get(Organisation, org_id) if is_ulid(org_id) else None
    if org is None:
        raise OrganisationNotFound()
    if principal.is_operator:
        return org
    role = (
        await db.execute(
            select(OrganisationMember.role).where(
                OrganisationMember.organisation_id == org_id,
                OrganisationMember.user_id == principal.user.id,
            )
        )
    ).scalar_one_or_none()
    if role is None and not principal.is_analyst:
        raise OrganisationNotFound()
    if role != "org_admin":
        raise Forbidden()
    return org


def _monitor(m: CertificateMonitor, c: Certificate | None) -> dict[str, Any]:
    return {
        "id": m.id,
        "organisation_id": m.organisation_id,
        "domain": m.domain,
        "enabled": m.enabled,
        "current_certificate_id": m.current_certificate_id,
        "issuer_cn": c.issuer_cn if c else None,
        "days_to_expiry": _days(c) if c else None,
        "last_checked_at": ts(m.last_checked_at),
    }


def _certificate(c: Certificate, monitored_domain: str | None) -> dict[str, Any]:
    return {
        "id": c.id,
        "fingerprint_sha256": c.fingerprint_sha256,
        "subject_cn": c.subject_cn,
        "issuer_cn": c.issuer_cn,
        "root_issuer_cn": c.root_issuer_cn,
        "sans": c.sans,
        "not_before": ts(c.not_before),
        "not_after": ts(c.not_after),
        "days_to_expiry": _days(c),
        "key_type": c.key_type,
        "key_bits": c.key_bits,
        "signature_algorithm": c.signature_algorithm,
        "monitored_domain": monitored_domain,
        "simulated": c.simulated,
    }


@router.get("", response_model=CertificateList, summary="Certificate inventory")
async def list_certificates(
    issuer: str | None = None,
    expiring_within_days: int | None = Query(None, ge=0, le=3650),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    monitors = {
        m.current_certificate_id: m.domain
        for m in (await db.execute(select(CertificateMonitor))).scalars()
    }
    stmt = select(Certificate).order_by(Certificate.not_after)
    if issuer:
        stmt = stmt.where(Certificate.issuer_cn == issuer)
    rows = [
        c
        for c in (await db.execute(stmt)).scalars()
        if expiring_within_days is None or _days(c) <= expiring_within_days
    ]
    return {
        "data": [_certificate(c, monitors.get(c.id)) for c in rows],
        "page": {"limit": len(rows), "next_cursor": None},
    }


@router.get("/monitors", response_model=MonitorList, summary="Monitored domains")
async def list_monitors(
    organisation_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    stmt = (
        select(CertificateMonitor, Certificate)
        .outerjoin(Certificate, Certificate.id == CertificateMonitor.current_certificate_id)
        .order_by(CertificateMonitor.domain)
    )
    if organisation_id:
        stmt = stmt.where(CertificateMonitor.organisation_id == organisation_id)
    visible = await _visible_org_ids(db, principal)
    if visible is not None:
        stmt = stmt.where(CertificateMonitor.organisation_id.in_(visible))
    rows = (await db.execute(stmt)).all()
    return {"data": [_monitor(m, c) for m, c in rows]}


@router.post("/monitors", status_code=201, response_model=MonitorOut, summary="Monitor a domain")
async def create_monitor(
    body: MonitorCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    org = await _require_org_admin(db, body.organisation_id, principal)
    try:
        domain = guard.parse_target(f"https://{body.domain}/").host
    except DomainError:
        raise DomainNotVerified() from None
    verified = (
        await db.execute(
            select(VerifiedDomain.domain).where(
                VerifiedDomain.organisation_id == org.id, VerifiedDomain.status == "verified"
            )
        )
    ).scalars()
    if not any(domain == d or domain.endswith("." + d) for d in verified):
        raise DomainNotVerified()
    existing = (
        await db.execute(
            select(CertificateMonitor.id).where(
                CertificateMonitor.organisation_id == org.id, CertificateMonitor.domain == domain
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise Conflict("This domain is already monitored for the organisation.")
    count = (
        await db.execute(select(func.count()).where(CertificateMonitor.organisation_id == org.id))
    ).scalar_one()
    if count >= MAX_MONITORS_PER_ORG:
        raise Conflict(f"An organisation can monitor at most {MAX_MONITORS_PER_ORG} domains.")
    monitor = CertificateMonitor(id=new_ulid(), organisation_id=org.id, domain=domain)
    db.add(monitor)
    cert = await _first_check(db, request, domain)
    if cert is not None:
        monitor.current_certificate_id, monitor.last_checked_at = cert.id, utcnow()
    # AUDIT: certificate_monitor.create
    audit.record(
        db,
        action="certificate_monitor.create",
        principal=principal,
        target_type="certificate_monitor",
        target_id=monitor.id,
        organisation_id=org.id,
        after={"domain": domain},
        request=request,
    )
    await db.commit()
    return _monitor(monitor, cert)


async def _first_check(db: AsyncSession, request: Request, domain: str) -> Certificate | None:
    """Best-effort immediate certificate read so a new monitor is useful at once. Any failure is
    fine: the certificate sweep (QStash, every 15 min) checks it again."""
    settings = request.app.state.settings
    now = utcnow()
    try:
        target = guard.parse_target(f"https://{domain}/")
        if settings.demo_mode and is_demo_host(target.host, target.registrable_domain):
            tls = demo_observations(
                target.host, target.registrable_domain, target.normalised_url, "https"
            ).tls
            if tls.status != "collected" or not tls.fingerprint_sha256:
                return None
            cert = await upsert_certificate(db, tls, now)
            cert.simulated = True  # recorded fixture, never a live observation
            await db.flush()
            return cert
        async with asyncio.timeout(FIRST_CHECK_TIMEOUT_S):
            target = await guard.check_target(
                target.normalised_url, dns_timeout=settings.dns_timeout_seconds
            )
            tls = await collect_tls(target, settings)
    except (DomainError, TimeoutError):
        return None
    if tls.status != "collected" or not tls.presented or not tls.fingerprint_sha256:
        return None
    cert = await upsert_certificate(db, tls, now)
    await db.flush()
    return cert


@router.delete("/monitors/{monitor_id}", status_code=204, summary="Stop monitoring a domain")
async def delete_monitor(
    monitor_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Response:
    monitor = await db.get(CertificateMonitor, monitor_id) if is_ulid(monitor_id) else None
    if monitor is None:
        raise NotFound("We could not find that monitor.")
    try:
        await _require_org_admin(db, monitor.organisation_id, principal)
    except OrganisationNotFound:
        raise NotFound("We could not find that monitor.") from None
    # AUDIT: certificate_monitor.delete
    audit.record(
        db,
        action="certificate_monitor.delete",
        principal=principal,
        target_type="certificate_monitor",
        target_id=monitor.id,
        organisation_id=monitor.organisation_id,
        before={"domain": monitor.domain},
        request=request,
    )
    await db.delete(monitor)
    await db.commit()
    return Response(status_code=204)


async def _affected(db: AsyncSession, issuer: str) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(CertificateMonitor, Certificate)
            .join(Certificate, Certificate.id == CertificateMonitor.current_certificate_id)
            .where((Certificate.issuer_cn == issuer) | (Certificate.root_issuer_cn == issuer))
        )
    ).all()
    return [
        {
            "domain": m.domain,
            "certificate_id": c.id,
            "monitor_id": m.id,
            "organisation_id": m.organisation_id,
        }
        for m, c in rows
    ]


async def _incident(db: AsyncSession, i: CertificateIncident) -> dict[str, Any]:
    affected = await _affected(db, i.issuer_cn)
    return {
        "id": i.id,
        "issuer_cn": i.issuer_cn,
        "title": i.title,
        "severity": i.severity,
        "description": i.description,
        "source": i.source,
        "simulated": i.simulated,
        "published_at": ts(i.published_at),
        "affected_domain_count": len(affected),
        "affected": affected[:AFFECTED_CAP],
        "affected_truncated": len(affected) > AFFECTED_CAP,
    }


@router.get("/incidents", response_model=IncidentList, summary="Certificate incidents")
async def list_incidents(
    simulated: bool | None = None,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    stmt = select(CertificateIncident).order_by(CertificateIncident.published_at.desc())
    if simulated is not None:
        stmt = stmt.where(CertificateIncident.simulated.is_(simulated))
    rows = list((await db.execute(stmt)).scalars())
    return {
        "data": [await _incident(db, i) for i in rows],
        "page": {"limit": len(rows), "next_cursor": None},
    }


@router.post(
    "/incidents", status_code=201, response_model=IncidentOut, summary="Create a simulated incident"
)
async def create_incident(
    body: IncidentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_operator),
) -> Any:
    if not request.app.state.settings.demo_mode:
        raise DemoModeRequired()
    if not body.simulated:
        raise IncidentNotSimulated()
    affected = await _affected(db, body.issuer_cn)
    incident = CertificateIncident(
        id=new_ulid(),
        issuer_cn=body.issuer_cn,
        title=body.title,
        severity=body.severity,
        description=body.description,
        source="simulation",
        simulated=True,
        published_at=utcnow(),
        affected_domain_count=len(affected),
        created_by=principal.user.id,
    )
    db.add(incident)
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind="user",
            action="incident.simulate",
            target_type="certificate_incident",
            target_id=incident.id,
            after={"issuer_cn": body.issuer_cn, "simulated": True, "affected": len(affected)},
        )
    )
    await db.commit()
    return await _incident(db, incident)


# Declared last so the static paths above (/monitors, /incidents) win over the id route.
@router.get("/{certificate_id}", response_model=CertificateDetail, summary="Certificate detail")
async def get_certificate(
    certificate_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    cert = await db.get(Certificate, certificate_id) if is_ulid(certificate_id) else None
    if cert is None:
        raise NotFound("We could not find that certificate.")
    stmt = select(CertificateMonitor).where(CertificateMonitor.current_certificate_id == cert.id)
    visible = await _visible_org_ids(db, principal)
    if visible is not None:
        stmt = stmt.where(CertificateMonitor.organisation_id.in_(visible))
    monitors = list((await db.execute(stmt.order_by(CertificateMonitor.domain))).scalars())
    return {
        **_certificate(cert, monitors[0].domain if monitors else None),
        "is_self_signed": cert.is_self_signed,
        "chain_length": cert.chain_length,
        "first_seen_at": ts(cert.first_seen_at),
        "last_seen_at": ts(cert.last_seen_at),
        "monitors": [_monitor(m, cert) for m in monitors],
    }
