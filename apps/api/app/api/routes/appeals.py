"""False-positive appeals (API_ENDPOINTS.md §11, USER_JOURNEYS.md J10, BR-006).

Flow:

1. ``POST /appeals`` (no account needed): the site owner names the domain and gets a DNS TXT or
   HTTPS-file challenge — the same mechanism as domain verification
   (ORGANISATION_TRUST_PROFILES §4).
2. ``POST /appeals/{id}/verify``: we check the challenge. Success moves the appeal to
   ``challenge_verified``; only then does it enter the analyst queue.
3. ``POST /appeals/{id}/review`` (analyst): ``approve`` resets the domain's reputation toward 0 by
   +30 (THREAT_INTELLIGENCE_ENGINE §4.1) and dismisses its still-open reports; ``reject`` closes it.

An appeal never changes a verdict by itself (BR-006): nothing happens to reputation until an analyst
approves, and approval needs a verified challenge.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, optional_principal, rate_limit, require_analyst
from app.errors import Conflict, DomainError, NotFound, ValidationFailed
from app.models.tables import Appeal, Entity, ThreatReport
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.platform import (
    AppealCreate,
    AppealCreated,
    AppealList,
    AppealOut,
    AppealReviewRequest,
    AppealVerifyResult,
)
from app.security.auth import Principal
from app.services import audit
from app.services import domain_verification as dv
from app.services.serialise import ts
from app.utils import is_ulid, new_ulid, utcnow

router = APIRouter(prefix="/api/v1/appeals", tags=["appeals"], responses=ERROR_RESPONSES)

APPEAL_REPUTATION_STEP = 30  # THREAT_INTELLIGENCE_ENGINE.md §4.1: "+30/step", capped at 0
MAX_ATTEMPTS = 20
OPEN_APPEALS_PER_DOMAIN = 3


class AppealNotVerified(DomainError):
    code, status, message = (
        ErrorCode.APPEAL_NOT_VERIFIED,
        409,
        "The owner has not completed the domain challenge, so this appeal cannot be approved.",
    )


class AppealAlreadyReviewed(DomainError):
    code, status, message = (
        ErrorCode.APPEAL_ALREADY_REVIEWED,
        409,
        "This appeal has already been reviewed.",
    )


class AppealAttemptsExhausted(DomainError):
    code, status, message = (
        ErrorCode.APPEAL_ATTEMPTS_EXHAUSTED,
        409,
        "Too many checks for this appeal. Submit a new appeal to get a fresh challenge.",
    )


def _challenge(appeal: Appeal, token: str) -> dict[str, Any]:
    value = f"{dv.VALUE_PREFIX}{token}"
    expires = ts(appeal.challenge_expires_at) or ""
    if appeal.challenge_method == "dns_txt":
        name = f"{dv.RECORD_PREFIX}.{appeal.domain}"
        return {
            "method": "dns_txt",
            "record_name": name,
            "record_type": "TXT",
            "record_value": value,
            "expires_at": expires,
            "instructions": (
                f"Add a TXT record named {name} with the value {value}, then ask us to check it. "
                "DNS changes can take a few minutes to appear."
            ),
        }
    url = f"https://{appeal.domain}{dv.FILE_PATH}"
    return {
        "method": "http_file",
        "record_name": url,
        "record_type": "FILE",
        "record_value": value,
        "expires_at": expires,
        "instructions": (
            f"Serve a file at {url} whose content is exactly {value} (HTTPS with a valid "
            "certificate, no redirect), then ask us to check it."
        ),
    }


async def _domain_entity(db: AsyncSession, domain: str) -> Entity | None:
    return (
        await db.execute(
            select(Entity).where(Entity.type == "domain", Entity.key == f"domain:{domain}")
        )
    ).scalar_one_or_none()


async def _open_reports(db: AsyncSession, domain: str) -> list[ThreatReport]:
    rows = (
        await db.execute(
            select(ThreatReport).where(
                ThreatReport.status.in_(("pending", "reviewing")),
                ThreatReport.normalised_url.like(f"%://{domain}/%")
                | ThreatReport.normalised_url.like(f"%://{domain}:%"),
            )
        )
    ).scalars()
    return list(rows)


async def _out(db: AsyncSession, a: Appeal) -> dict[str, Any]:
    entity = await _domain_entity(db, a.domain)
    review = (
        {
            "reviewed_by": a.reviewed_by,
            "reviewed_at": ts(a.reviewed_at),
            "reason": a.review_reason,
            "reputation_before": a.reputation_before,
            "reputation_after": a.reputation_after,
        }
        if a.reviewed_at
        else None
    )
    return {
        "id": a.id,
        "domain": a.domain,
        "email": a.email,
        "message": a.message,
        "challenge_method": a.challenge_method,
        "status": a.status,
        "attempts": a.attempts,
        "challenge_expires_at": ts(a.challenge_expires_at) or "",
        "challenge_verified_at": ts(a.challenge_verified_at),
        "current_reputation": entity.reputation_score if entity else None,
        "open_reports": len(await _open_reports(db, a.domain)),
        "review": review,
        "created_at": ts(a.created_at) or "",
    }


async def _get(db: AsyncSession, appeal_id: str) -> Appeal:
    appeal = await db.get(Appeal, appeal_id) if is_ulid(appeal_id) else None
    if appeal is None:
        raise NotFound("We could not find that appeal.")
    return appeal


@router.post("", status_code=201, response_model=AppealCreated, summary="Appeal a verdict")
async def create_appeal(
    body: AppealCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal | None = Depends(optional_principal),
    _: None = Depends(rate_limit("appeals")),
) -> Any:
    domain = dv.normalise_domain(body.domain)
    open_count = (
        await db.execute(
            select(func.count()).where(
                Appeal.domain == domain,
                Appeal.status.in_(("pending_challenge", "challenge_verified")),
            )
        )
    ).scalar_one()
    if open_count >= OPEN_APPEALS_PER_DOMAIN:
        raise Conflict("There are already open appeals for this domain. Complete one of those.")
    entity = await _domain_entity(db, domain)
    token = dv.new_token()
    appeal = Appeal(
        id=new_ulid(),
        domain=domain,
        email=body.email,
        message=body.message,
        challenge_method=body.challenge_method,
        token_hash=dv.hash_token(token),
        status="pending_challenge",
        challenge_expires_at=utcnow() + dv.CHALLENGE_TTL,
        entity_id=entity.id if entity else None,
        ip_hash=audit.hash_ip(request),
    )
    db.add(appeal)
    # AUDIT: appeal.create
    audit.record(
        db,
        action="appeal.create",
        principal=principal,
        target_type="appeal",
        target_id=appeal.id,
        after={"domain": domain, "method": body.challenge_method},
        request=request,
    )
    await db.commit()
    return {
        "appeal_id": appeal.id,
        "status": appeal.status,
        "challenge": _challenge(appeal, token),  # the raw token is shown once, here
    }


@router.post(
    "/{appeal_id}/verify", response_model=AppealVerifyResult, summary="Check an appeal challenge"
)
async def verify_appeal(
    appeal_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit("appeal_verify")),
) -> Any:
    appeal = await _get(db, appeal_id)

    def result(verified: bool, message: str) -> dict[str, Any]:
        return {
            "appeal_id": appeal.id,
            "status": appeal.status,
            "verified": verified,
            "attempts": appeal.attempts,
            "message": message,
        }

    if appeal.status != "pending_challenge":
        verified = appeal.challenge_verified_at is not None
        return result(verified, "This appeal's challenge has already been checked.")
    if utcnow() > appeal.challenge_expires_at:
        appeal.status = "expired"
        await db.commit()
        raise dv.VerificationExpired()
    if appeal.attempts >= MAX_ATTEMPTS:
        raise AppealAttemptsExhausted()
    appeal.attempts += 1
    check = await dv.run_check(appeal.challenge_method, appeal.domain, appeal.token_hash)  # type: ignore[arg-type]
    appeal.observed_value = check.observed
    if check.matched:
        appeal.status = "challenge_verified"
        appeal.challenge_verified_at = utcnow()
        # AUDIT: appeal.challenge_verified
        audit.record(
            db,
            action="appeal.challenge_verified",
            actor_kind="system",
            target_type="appeal",
            target_id=appeal.id,
            after={"domain": appeal.domain, "method": appeal.challenge_method},
            request=request,
        )
        await db.commit()
        return result(True, "Challenge verified. An analyst will review your appeal.")
    await db.commit()
    if check.outcome == "mismatch":
        raise dv.VerificationTokenMismatch()
    if check.outcome == "fetch_failed":
        raise dv.VerificationFetchFailed()
    raise dv.VerificationNotFound()


@router.get("", response_model=AppealList, summary="Appeal queue")
async def list_appeals(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_analyst),
    status: str | None = None,
    domain: str | None = Query(None, max_length=253),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
) -> Any:
    stmt = select(Appeal).order_by(Appeal.id.desc()).limit(limit + 1)
    if status:
        stmt = stmt.where(Appeal.status == status)
    if domain:
        stmt = stmt.where(Appeal.domain == domain.strip().lower())
    if cursor:
        if not is_ulid(cursor):
            raise ValidationFailed(details=[{"field": "cursor", "issue": "invalid_cursor"}])
        stmt = stmt.where(Appeal.id < cursor)
    rows = list((await db.execute(stmt)).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "data": [await _out(db, a) for a in rows],
        "page": {"limit": limit, "next_cursor": rows[-1].id if more else None},
    }


@router.get("/{appeal_id}", response_model=AppealOut, summary="Appeal detail")
async def get_appeal(
    appeal_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_analyst),
) -> Any:
    return await _out(db, await _get(db, appeal_id))


@router.post("/{appeal_id}/review", response_model=AppealOut, summary="Approve or reject an appeal")
async def review_appeal(
    appeal_id: str,
    body: AppealReviewRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_analyst),
) -> Any:
    appeal = await _get(db, appeal_id)
    if appeal.status in ("approved", "rejected"):
        raise AppealAlreadyReviewed()
    if body.action == "approve" and appeal.status != "challenge_verified":
        raise AppealNotVerified()
    reason = body.reason.strip()
    now = utcnow()
    before_status = appeal.status
    if body.action == "approve":
        entity = await _domain_entity(db, appeal.domain)
        if entity is not None:
            appeal.reputation_before = entity.reputation_score
            await _reset_toward_zero(db, entity, appeal, now)
            appeal.reputation_after = entity.reputation_score
        for report in await _open_reports(db, appeal.domain):
            report.status = "dismissed"
            report.reviewed_by, report.reviewed_at = principal.user.id, now
            report.review_reason = f"Appeal {appeal.id} approved: {reason}"[:500]
        appeal.status = "approved"
    else:
        appeal.status = "rejected"
    appeal.reviewed_by, appeal.reviewed_at, appeal.review_reason = principal.user.id, now, reason
    # AUDIT: appeal.review
    audit.record(
        db,
        action="appeal.review",
        principal=principal,
        target_type="appeal",
        target_id=appeal.id,
        before={"status": before_status, "reputation": appeal.reputation_before},
        after={"status": appeal.status, "reputation": appeal.reputation_after, "reason": reason},
        request=request,
    )
    await db.commit()
    return await _out(db, appeal)


async def _reset_toward_zero(
    db: AsyncSession, domain: Entity, appeal: Appeal, now: datetime
) -> None:
    """+30 toward 0 for the domain and its page URLs; clear the threat flag once fully reset."""
    pages = list(
        (
            await db.execute(
                select(Entity).where(
                    Entity.type == "url",
                    Entity.key.like(f"url:https://{appeal.domain}/%")
                    | Entity.key.like(f"url:http://{appeal.domain}/%"),
                )
            )
        ).scalars()
    )
    for entity in (domain, *pages):
        if entity.reputation_score < 0:
            entity.reputation_score = min(0, entity.reputation_score + APPEAL_REPUTATION_STEP)
        attributes = {**entity.attributes, "appeal_approved_at": now.isoformat()}
        if entity.reputation_score == 0:
            attributes.pop("confirmed_threat", None)
        entity.attributes = attributes


__all__ = ["router"]
