"""Scans and assessment (API_ENDPOINTS.md §4, §6)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, optional_principal, rate_limit, require_scope
from app.errors import DomainError
from app.models.tables import (
    Evidence,
    Organisation,
    Scan,
    ScanFinding,
    ThreatReport,
    VerifiedDomain,
    VerifiedRecipient,
)
from app.risk.classes import risk_class
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode, Intent
from app.schemas.platform import InspectRedirectRequest, InspectRedirectResponse
from app.schemas.resources import (
    AssessRequest,
    AssessResponse,
    ScanAccepted,
    ScanCreate,
    ScanList,
    ScanOut,
    VerifyIdentityRequest,
    VerifyIdentityResponse,
    VerifyPaymentRequest,
    VerifyPaymentResponse,
)
from app.security.auth import Principal
from app.services import guard
from app.services.demo_fixtures import is_demo_host
from app.services.idempotency import idempotent
from app.services.observations import ClientObservation
from app.services.redirects import inspect_chain
from app.services.scan_orchestrator import execute, finding_to_wire, schedule_scan
from app.services.serialise import scan_full, scan_summary, ts
from app.services.validation import normalise_recipient
from app.utils import is_ulid, new_ulid, utcnow

router = APIRouter(prefix="/api/v1", tags=["scans"], responses=ERROR_RESPONSES)


class ScanNotFound(DomainError):
    code, status, message = ErrorCode.SCAN_NOT_FOUND, 404, "We could not find that scan."


class DeepScanDisabled(DomainError):
    code, status, message = ErrorCode.DEEP_SCAN_DISABLED, 422, "Deep scans are not enabled."


class OrganisationNotFound(DomainError):
    code, status, message = (
        ErrorCode.ORGANISATION_NOT_FOUND,
        404,
        "We could not find that organisation.",
    )


async def _validated_target(request: Request, url: str) -> guard.Target:
    settings = request.app.state.settings
    target = guard.parse_target(url)
    demo = settings.demo_mode and is_demo_host(target.host, target.registrable_domain)
    return await guard.check_target(
        url, dns_timeout=settings.dns_timeout_seconds, is_demo_host=demo
    )


async def _check_org(db: AsyncSession, org_id: str | None) -> None:
    if org_id and await db.get(Organisation, org_id) is None:
        raise OrganisationNotFound()


@router.post("/scans", status_code=202, response_model=ScanAccepted, summary="Submit a scan")
async def create_scan(
    body: ScanCreate,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal | None = Depends(optional_principal),
    _: None = Depends(rate_limit("scans")),
) -> Any:
    if principal is not None and not principal.has_scope("scan:write"):
        from app.errors import InsufficientScope

        raise InsufficientScope()
    if body.deep and not request.app.state.settings.deep_scan_enabled:
        raise DeepScanDisabled()

    async def run() -> dict[str, Any]:
        target = await _validated_target(request, body.url)  # SSRF rejection → 422, never a verdict
        await _check_org(db, body.organisation_id)
        scan = Scan(
            id=new_ulid(),
            user_id=principal.user.id if principal else None,
            organisation_id=body.organisation_id,
            url=body.url,
            normalised_url=target.normalised_url,
            registrable_domain=target.registrable_domain,
            intent=body.intent.value,
            deep=body.deep,
        )
        db.add(scan)
        await db.commit()
        schedule_scan(request.app, scan.id)
        return {
            "id": scan.id,
            "status": "queued",
            "url": scan.url,
            "intent": scan.intent,
            "created_at": ts(utcnow()),
            "poll_after_ms": 1000,
        }

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 202, run
    )


@router.get("/scans", response_model=ScanList, summary="List scans")
async def list_scans(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("assess:read")),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    decision: str | None = None,
    status: str | None = None,
    q: str | None = Query(None, max_length=200),
) -> Any:
    stmt = select(Scan).order_by(Scan.id.desc()).limit(limit + 1)
    if not principal.is_analyst:
        stmt = stmt.where(Scan.user_id == principal.user.id)
    if cursor:
        if not is_ulid(cursor):
            from app.errors import ValidationFailed

            raise ValidationFailed(details=[{"field": "cursor", "issue": "invalid_cursor"}])
        stmt = stmt.where(Scan.id < cursor)
    if decision:
        stmt = stmt.where(Scan.decision == decision)
    if status:
        stmt = stmt.where(Scan.status == status)
    if q:
        stmt = stmt.where(Scan.url.ilike(f"%{q}%"))
    rows = list((await db.execute(stmt)).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "data": [scan_summary(s) for s in rows],
        "page": {"limit": limit, "next_cursor": rows[-1].id if more else None},
    }


async def load_scan(db: AsyncSession, scan_id: str, principal: Principal) -> Scan:
    scan = await db.get(Scan, scan_id) if is_ulid(scan_id) else None
    if scan is None:
        raise ScanNotFound()
    visible = (
        principal.is_analyst
        or scan.user_id == principal.user.id
        or scan.simulated  # seeded demo scans are shared demo material, labelled as such
    )
    if not visible:
        raise ScanNotFound()  # existence hiding
    return scan


@router.get("/scans/{scan_id}", response_model=ScanOut, summary="Get a scan")
async def get_scan(
    scan_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("assess:read")),
) -> Any:
    scan = await load_scan(db, scan_id, principal)
    findings = list(
        (await db.execute(select(ScanFinding).where(ScanFinding.scan_id == scan.id))).scalars()
    )
    findings.sort(
        key=lambda f: (
            {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}[f.severity],
            f.code,
        )
    )
    evidence = list(
        (
            await db.execute(
                select(Evidence).where(Evidence.scan_id == scan.id).order_by(Evidence.id)
            )
        ).scalars()
    )
    terminal = scan.status in ("completed", "partial", "failed")
    response.headers["Cache-Control"] = "private, max-age=60" if terminal else "no-store"
    return scan_full(scan, findings, evidence)


@router.post("/assess", response_model=AssessResponse, summary="Assess an action (hot path)")
async def assess(
    body: AssessRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("assess:read")),
    _: None = Depends(rate_limit("assess")),
) -> Any:
    async def run() -> dict[str, Any]:
        target = await _validated_target(request, body.url)
        await _check_org(db, body.organisation_id)
        scan = Scan(
            id=new_ulid(),
            user_id=principal.user.id,
            organisation_id=body.organisation_id,
            url=body.url,
            normalised_url=target.normalised_url,
            registrable_domain=target.registrable_domain,
            intent=body.intent.value,
        )
        db.add(scan)
        await db.commit()
        client = ClientObservation(
            form_action=body.form_action, payee=body.payee, destination_host=body.destination_host
        )
        app = request.app
        async with app.state.scan_semaphore:
            outcome = await execute(
                app.state.session_factory,
                app.state.settings,
                app.state.http,
                scan.id,
                client=client,
            )
        if outcome is None:
            from app.errors import NotReady

            raise NotReady("We could not complete the assessment. Try again.")
        s = outcome.scan
        action = s.result.get("action", {})
        identity_verified = any(
            f.code == "IDENTITY_MATCH_CONFIRMED" for f in outcome.findings
        ) and not any(
            f.code in ("CREDENTIAL_DESTINATION_MISMATCH", "PAYEE_NOT_IN_VERIFIED_PROFILE")
            for f in outcome.findings
        )
        return {
            "assessment_id": new_ulid(),
            "decision": s.decision,
            "risk_level": s.risk_level,
            "risk_score": s.risk_score,
            "risk_class": risk_class(s.decision) if s.decision else None,
            "coverage": s.coverage,
            "reasons": s.reasons,
            "identity_verified": identity_verified,
            "action": action,
            "findings": [finding_to_wire(f) for f in outcome.findings],
            "scan_id": s.id,
            "cached": False,
            "simulated": s.simulated,
            "decided_at": ts(s.completed_at),
        }

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 200, run
    )


@router.post(
    "/verify-identity", response_model=VerifyIdentityResponse, summary="Verify a domain's identity"
)
async def verify_identity(
    body: VerifyIdentityRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("identity:read")),
    _: None = Depends(rate_limit("verify")),
) -> Any:
    domain = body.domain.strip().lower().rstrip(".")
    orgs: list[Organisation] = []
    if body.organisation_id:
        org = await db.get(Organisation, body.organisation_id)
        if org is None:
            raise OrganisationNotFound()
        orgs = [org]
    else:
        haystack = domain.replace("-", " ").replace(".", " ")
        for org in (
            await db.execute(select(Organisation).where(Organisation.status == "active"))
        ).scalars():
            if any(t.lower() in haystack for t in org.brand_tokens):
                orgs.append(org)
    now = ts(utcnow())
    if not orgs:
        return {
            "domain": domain,
            "claimed_organisation": None,
            "identity_verified": False,
            "reason_code": "NO_PROFILE",
            "verified_domains": [],
            "confidence": 0.0,
            "checked_at": now,
        }
    if len(orgs) > 1:
        return {
            "domain": domain,
            "claimed_organisation": None,
            "identity_verified": False,
            "reason_code": "CLAIM_AMBIGUOUS",
            "verified_domains": [],
            "confidence": 0.5,
            "checked_at": now,
        }
    org = orgs[0]
    verified = list(
        (
            await db.execute(
                select(VerifiedDomain.domain).where(
                    VerifiedDomain.organisation_id == org.id, VerifiedDomain.status == "verified"
                )
            )
        ).scalars()
    )
    ok = any(domain == d or domain.endswith("." + d) for d in verified)
    return {
        "domain": domain,
        "claimed_organisation": {"id": org.id, "name": org.name},
        "identity_verified": ok,
        "reason_code": "DOMAIN_VERIFIED" if ok else "DOMAIN_NOT_REGISTERED_BY_BRAND",
        "verified_domains": verified,
        "confidence": 1.0 if ok else 0.95,
        "checked_at": now,
    }


@router.post("/verify-payment", response_model=VerifyPaymentResponse, summary="Verify a payee")
async def verify_payment(
    body: VerifyPaymentRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("payments:read")),
    _: None = Depends(rate_limit("verify")),
) -> Any:
    org = await db.get(Organisation, body.organisation_id)
    if org is None:
        raise OrganisationNotFound()
    value = normalise_recipient(body.recipient_type.value, body.value)
    recipients = list(
        (
            await db.execute(
                select(VerifiedRecipient).where(VerifiedRecipient.organisation_id == org.id)
            )
        ).scalars()
    )
    verified = [r for r in recipients if r.status == "verified"]
    match = next(
        (
            r
            for r in recipients
            if r.normalised_value == value and r.recipient_type == body.recipient_type.value
        ),
        None,
    )
    reports = list(
        (
            await db.execute(
                select(ThreatReport).where(
                    ThreatReport.observed_payee.ilike(value), ThreatReport.status == "confirmed"
                )
            )
        ).scalars()
    )
    if match is not None and match.status == "verified":
        result, codes = "exact", ["PAYEE_MATCH_CONFIRMED"]
    elif match is not None:
        result, codes = "none", ["PAYEE_NOT_VERIFIED"]
    elif verified:
        result, codes = "none", ["PAYEE_NOT_IN_VERIFIED_PROFILE"]
    else:
        result, codes = "unverifiable", ["PAYEE_UNVERIFIABLE"]
    if len(reports) >= 2:
        codes.append("PAYEE_LINKED_TO_REPORTED_SCAM")
    return {
        "match": result,
        "recipient_status": match.status if match else "unknown",
        "normalised_value": value,
        "organisation_has_verified_recipients": bool(verified),
        "expected_recipients": [{"type": r.recipient_type, "handle": r.value} for r in verified],
        "related_reports": [
            {"report_id": r.id, "confirmed_at": ts(r.reviewed_at)} for r in reports
        ],
        "finding_codes": codes,
        "confidence": 1.0 if result != "unverifiable" else 0.5,
    }


@router.post(
    "/inspect-redirect",
    response_model=InspectRedirectResponse,
    summary="Follow a redirect chain safely",
)
async def inspect_redirect(
    body: InspectRedirectRequest,
    request: Request,
    principal: Principal = Depends(require_scope("assess:read")),
    _: None = Depends(rate_limit("inspect")),
) -> Any:
    """Every hop is SSRF-checked before it is requested. A blocked hop is reported in
    ``blocked_hop`` with a ``200`` — it is a finding, not a client error (API_ENDPOINTS §6)."""
    return await inspect_chain(
        request.app.state.http, body.url, body.max_hops, request.app.state.settings
    )


__all__ = ["router", "load_scan", "ScanNotFound", "Intent", "current_principal"]
