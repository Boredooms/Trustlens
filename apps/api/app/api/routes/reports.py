"""Reports and review (API_ENDPOINTS.md §11, TL-012/TL-019).

Confirmation propagates (THREAT_GRAPH.md §4, RISK_ENGINE R-REP-02): the reported domain and URL lose
reputation, and the infrastructure the reported page sends data to — its credential sink URLs and
its payees — is marked ``confirmed_threat``. Any other page that submits to that sink or asks for
payment to that payee is then one hop from a confirmed threat. Community findings carry their own
label and never override our own signals.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, rate_limit, require_analyst, require_scope
from app.config import Settings
from app.errors import DomainError
from app.intelligence import campaigns
from app.intelligence.graph import entity_by_key, upsert_edge, upsert_entity
from app.models.tables import AuditLog, Entity, Relationship, Scan, ThreatReport
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.resources import ReportCreate, ReportCreated, ReportList, ReportOut, ReviewRequest
from app.security.auth import Principal
from app.services import guard
from app.services.idempotency import idempotent
from app.services.serialise import scan_summary, ts
from app.utils import is_ulid, new_ulid, utcnow

router = APIRouter(prefix="/api/v1/reports", tags=["reports"], responses=ERROR_RESPONSES)

CONFIRMED_REPUTATION_DELTA = -40


class ReportNotFound(DomainError):
    code, status, message = ErrorCode.NOT_FOUND, 404, "We could not find that report."


class ReportDuplicate(DomainError):
    code, status, message = (
        ErrorCode.REPORT_DUPLICATE,
        409,
        "You already reported this address today.",
    )


class ReportAlreadyReviewed(DomainError):
    code, status, message = (
        ErrorCode.REPORT_ALREADY_REVIEWED,
        409,
        "This report has already been reviewed.",
    )


class ReviewReasonRequired(DomainError):
    code, status, message = (
        ErrorCode.REVIEW_REASON_REQUIRED,
        422,
        "Give a reason of at least 10 characters.",
    )


class InsufficientCoverage(DomainError):
    code, status, message = (
        ErrorCode.INSUFFICIENT_COVERAGE_FOR_REVIEW,
        422,
        "The linked scan checked too little to confirm this report. Run a fuller scan first.",
    )


def _channel(principal: Principal) -> str:
    return {"extension": "extension", "api_key": "sdk"}.get(
        principal.kind, "analyst" if principal.is_analyst else "web"
    )


async def _summary(db: AsyncSession, r: ThreatReport) -> dict[str, Any]:
    scan = await db.get(Scan, r.scan_id) if r.scan_id else None
    return {
        "id": r.id,
        "url": r.url,
        "status": r.status,
        "reporter_channel": r.reporter_channel,
        "observed_payee": r.observed_payee,
        "linked_scan_id": r.scan_id,
        "decision": scan.decision if scan else None,
        "simulated": r.simulated,
        "created_at": ts(r.created_at),
    }


@router.post("", status_code=201, response_model=ReportCreated, summary="Report a site")
async def create_report(
    body: ReportCreate,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("reports:write")),
    _: None = Depends(rate_limit("reports")),
) -> Any:
    async def run() -> dict[str, Any]:
        target = guard.parse_target(body.url)
        dup = (
            await db.execute(
                select(ThreatReport.id).where(
                    ThreatReport.reporter_user_id == principal.user.id,
                    ThreatReport.normalised_url == target.normalised_url,
                    ThreatReport.created_at > utcnow() - timedelta(hours=24),
                )
            )
        ).scalar_one_or_none()
        if dup:
            raise ReportDuplicate()
        scan_id = body.scan_id
        if scan_id is None:
            scan_id = (
                await db.execute(
                    select(Scan.id)
                    .where(Scan.normalised_url == target.normalised_url, Scan.status == "completed")
                    .order_by(Scan.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        domain_id = await upsert_entity(db, "domain", f"domain:{target.host}", target.host)
        report = ThreatReport(
            id=new_ulid(),
            reporter_user_id=principal.user.id,
            reporter_channel=_channel(principal),
            url=body.url,
            normalised_url=target.normalised_url,
            entity_id=domain_id,
            scan_id=scan_id,
            justification=body.justification,
            intent=body.intent.value if body.intent else None,
            observed_payee=body.observed_payee,
        )
        db.add(report)
        await db.flush()
        report_entity = await upsert_entity(
            db,
            "threat_report",
            f"report:{report.id}",
            f"Report {report.id[-6:]}",
            {"status": "pending", "channel": report.reporter_channel},
        )
        await upsert_edge(db, domain_id, report_entity, "REPORTED_AS")
        db.add(
            AuditLog(
                id=new_ulid(),
                actor_user_id=principal.user.id,
                actor_kind=principal.actor_kind,
                action="report.create",
                target_type="threat_report",
                target_id=report.id,
            )
        )
        await db.commit()
        return {
            "id": report.id,
            "status": "pending",
            "created_at": ts(utcnow()),
            "linked_scan_id": scan_id,
        }

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 201, run
    )


@router.get("", response_model=ReportList, summary="List reports")
async def list_reports(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
    status: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
) -> Any:
    stmt = select(ThreatReport).order_by(ThreatReport.id.desc()).limit(limit + 1)
    if not principal.is_analyst:
        stmt = stmt.where(ThreatReport.reporter_user_id == principal.user.id)
    if status:
        stmt = stmt.where(ThreatReport.status == status)
    if cursor and is_ulid(cursor):
        stmt = stmt.where(ThreatReport.id < cursor)
    rows = list((await db.execute(stmt)).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "data": [await _summary(db, r) for r in rows],
        "page": {"limit": limit, "next_cursor": rows[-1].id if more else None},
    }


async def _detail(
    db: AsyncSession, r: ThreatReport, principal: Principal, **extra: Any
) -> dict[str, Any]:
    scan = await db.get(Scan, r.scan_id) if r.scan_id else None
    reporter = (
        "You"
        if r.reporter_user_id == principal.user.id
        else (
            f"user …{r.reporter_user_id[-6:]}"
            if principal.is_analyst and r.reporter_user_id
            else "Community member"
        )
    )
    review = (
        {"reviewed_by": r.reviewed_by, "reviewed_at": ts(r.reviewed_at), "reason": r.review_reason}
        if r.reviewed_at
        else None
    )
    return {
        **(await _summary(db, r)),
        "justification": r.justification,
        "reporter": reporter,
        "linked_scan": scan_summary(scan) if scan else None,
        "review": review,
        **extra,
    }


@router.get("/{report_id}", response_model=ReportOut, summary="Report detail")
async def get_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Any:
    r = await db.get(ThreatReport, report_id) if is_ulid(report_id) else None
    if r is None or (not principal.is_analyst and r.reporter_user_id != principal.user.id):
        raise ReportNotFound()
    return await _detail(db, r, principal)


@router.post("/{report_id}/review", response_model=ReportOut, summary="Confirm or dismiss a report")
async def review_report(
    report_id: str,
    body: ReviewRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_analyst),
) -> Any:
    settings: Settings = request.app.state.settings
    r = await db.get(ThreatReport, report_id) if is_ulid(report_id) else None
    if r is None:
        raise ReportNotFound()
    if r.status in ("confirmed", "dismissed"):
        raise ReportAlreadyReviewed()
    if not body.reason or len(body.reason.strip()) < 10:
        raise ReviewReasonRequired()
    scan = await db.get(Scan, r.scan_id) if r.scan_id else None
    if body.action == "confirm" and (
        scan is None or (scan.coverage or {}).get("percent", 0) < settings.report_min_coverage
    ):
        raise InsufficientCoverage()

    r.status = "confirmed" if body.action == "confirm" else "dismissed"
    r.reviewed_by, r.reviewed_at, r.review_reason = principal.user.id, utcnow(), body.reason.strip()
    applied, campaign_id = False, None
    if body.action == "confirm":
        await propagate_confirmation(db, r)
        applied = True
        ids = await campaigns.recompute(db)
        campaign_id = ids[0] if ids else None
    report_entity = await entity_by_key(db, "threat_report", f"report:{r.id}")
    if report_entity is not None:
        report_entity.attributes = {**report_entity.attributes, "status": r.status}
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind="user",
            action="report.review",
            target_type="threat_report",
            target_id=r.id,
            before={"status": "pending"},
            after={"status": r.status, "reason": r.review_reason},
        )
    )
    await db.commit()
    return await _detail(db, r, principal, reputation_applied=applied, campaign_id=campaign_id)


async def _mark_threat(entity: Entity) -> None:
    entity.reputation_score = max(-100, entity.reputation_score + CONFIRMED_REPUTATION_DELTA)
    entity.attributes = {**entity.attributes, "confirmed_threat": True}


async def propagate_confirmation(db: AsyncSession, report: ThreatReport) -> None:
    target = guard.parse_target(report.url)
    domain = await entity_by_key(db, "domain", f"domain:{target.host}")
    if domain is not None:
        await _mark_threat(domain)
    page_urls = list(
        (
            await db.execute(
                select(Entity).where(
                    Entity.type == "url", Entity.key.like(f"url:{target.scheme}://{target.host}%")
                )
            )
        ).scalars()
    )
    for url in page_urls:
        await _mark_threat(url)
        downstream = (
            await db.execute(
                select(Entity)
                .join(Relationship, Relationship.target_entity_id == Entity.id)
                .where(
                    Relationship.source_entity_id == url.id,
                    Relationship.type.in_(("SUBMITS_TO", "REQUESTS_PAYMENT_TO")),
                )
            )
        ).scalars()
        for entity in downstream:
            if not entity.attributes.get("confirmed_threat"):
                await _mark_threat(entity)
    if report.observed_payee:
        payee = await entity_by_key(
            db, "payment_recipient", f"payee:upi_vpa:{report.observed_payee.strip().lower()}"
        )
        if payee is not None and not payee.attributes.get("confirmed_threat"):
            await _mark_threat(payee)
