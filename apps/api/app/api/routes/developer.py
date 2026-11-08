"""API keys and overview (API_ENDPOINTS.md §15–§16)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import LIMITS, get_db, require_human
from app.errors import Conflict, NotFound, ValidationFailed
from app.logging import get_logger
from app.models.tables import (
    ApiKey,
    AuditLog,
    Campaign,
    Certificate,
    CertificateMonitor,
    Entity,
    Scan,
    ThreatReport,
    UsageCounter,
)
from app.schemas.common import ERROR_RESPONSES
from app.schemas.platform import UsageOut
from app.schemas.resources import ApiKeyCreate, ApiKeyCreated, ApiKeyList, OverviewOut
from app.security.auth import API_KEY_SCOPES, Principal, new_secret, sha256_hex
from app.services.serialise import ts
from app.utils import new_ulid, utcnow

router = APIRouter(prefix="/api/v1", tags=["developer"], responses=ERROR_RESPONSES)
log = get_logger("overview")


def _key(k: ApiKey) -> dict[str, Any]:
    return {
        "id": k.id,
        "name": k.name,
        "prefix": k.prefix,
        "scopes": k.scopes,
        "kind": k.kind,
        "last_used_at": ts(k.last_used_at),
        "revoked_at": ts(k.revoked_at),
        "created_at": ts(k.created_at),
    }


@router.get("/api-keys", response_model=ApiKeyList, summary="List API keys")
async def list_keys(
    principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    rows = (
        await db.execute(
            select(ApiKey)
            .where(ApiKey.user_id == principal.user.id, ApiKey.kind == "api_key")
            .order_by(ApiKey.created_at.desc())
        )
    ).scalars()
    return {"data": [_key(k) for k in rows]}


@router.post(
    "/api-keys", status_code=201, response_model=ApiKeyCreated, summary="Create an API key"
)
async def create_key(
    body: ApiKeyCreate,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    unknown = [s for s in body.scopes if s not in API_KEY_SCOPES]
    if unknown or not body.scopes:
        raise ValidationFailed(
            details=[{"field": "scopes", "issue": "unknown_scope", "observed": ",".join(unknown)}]
        )
    active = (
        await db.execute(
            select(func.count()).where(
                ApiKey.user_id == principal.user.id,
                ApiKey.kind == "api_key",
                ApiKey.revoked_at.is_(None),
            )
        )
    ).scalar_one()
    if active >= 10:
        raise Conflict("You already have 10 active keys. Revoke one first.")
    secret, prefix = new_secret("tl_live_")
    key = ApiKey(
        id=new_ulid(),
        user_id=principal.user.id,
        kind="api_key",
        name=body.name,
        prefix=prefix,
        secret_hash=sha256_hex(secret),
        scopes=sorted(set(body.scopes)),
    )
    db.add(key)
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind="user",
            action="apikey.create",
            target_type="api_key",
            target_id=key.id,
        )
    )
    await db.commit()
    await db.refresh(key)
    return {**_key(key), "secret": secret}  # the only time the secret is ever returned


@router.delete("/api-keys/{key_id}", status_code=204, summary="Revoke an API key")
async def revoke_key(
    key_id: str, principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Response:
    key = await db.get(ApiKey, key_id)
    if key is None or key.user_id != principal.user.id or key.kind != "api_key":
        raise NotFound()
    key.revoked_at = utcnow()
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind="user",
            action="apikey.revoke",
            target_type="api_key",
            target_id=key.id,
        )
    )
    await db.commit()
    return Response(status_code=204)


MAX_USAGE_SPAN_DAYS = 90  # usage_counters retention (DATABASE_DESIGN.md §11)


@router.get("/usage", response_model=UsageOut, summary="Usage by day and endpoint group")
async def usage(
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    group_by: Literal["day", "endpoint_group"] | None = None,
    key_id: str | None = None,
) -> Any:
    """The caller's own usage: their session plus every API key and extension device they own
    (TL-024). ``key_id`` narrows to one of those keys. Default period: the last 7 days."""
    today = utcnow().date()
    end = to or today
    start = from_ or end - timedelta(days=6)
    if start > end:
        raise ValidationFailed(details=[{"field": "from", "issue": "after_to"}])
    if (end - start).days >= MAX_USAGE_SPAN_DAYS:
        raise ValidationFailed(details=[{"field": "from", "issue": "span_over_90_days"}])
    owned = set(
        (await db.execute(select(ApiKey.id).where(ApiKey.user_id == principal.user.id))).scalars()
    )
    if key_id is not None:
        if key_id not in owned:
            raise NotFound("We could not find that key.")
        actors = [key_id]
    else:
        actors = [principal.user.id, *owned]
    columns: list[Any] = []
    if group_by in (None, "day"):
        columns.append(UsageCounter.day)
    if group_by in (None, "endpoint_group"):
        columns.append(UsageCounter.endpoint_group)
    stmt = (
        select(*columns, func.sum(UsageCounter.count))
        .where(
            UsageCounter.actor_id.in_(actors),
            UsageCounter.day >= start,
            UsageCounter.day <= end,
        )
        .group_by(*columns)
        .order_by(*columns)
    )
    data = []
    for row in (await db.execute(stmt)).all():
        values = dict(zip([c.key for c in columns], row[:-1], strict=True))
        day = values.get("day")
        data.append(
            {
                "day": day.isoformat() if day is not None else None,
                "endpoint_group": values.get("endpoint_group"),
                "count": int(row[-1] or 0),
            }
        )
    since = utcnow() - timedelta(hours=1)
    used = (
        await db.execute(
            select(func.count()).where(Scan.user_id == principal.user.id, Scan.created_at > since)
        )
    ).scalar_one()
    return {
        "data": data,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        # Hourly POST /scans budget for this user (API_CONTRACTS §10), as on /overview.
        "quota": {
            "limit": LIMITS["scans"]["user"][0],
            "used": used,
            "reset_at": ts(utcnow() + timedelta(hours=1)) or "",
        },
    }


@router.get("/overview", response_model=OverviewOut, summary="Dashboard overview")
async def overview(
    principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    """Each block is independently nullable: one failing source never blanks the others."""
    out: dict[str, Any] = {}

    async def block(name: str, fn) -> None:  # type: ignore[no-untyped-def]
        try:
            out[name] = await fn()
        except Exception:  # noqa: BLE001
            log.exception("overview.block_failed", extra={"block": name})
            await db.rollback()
            out[name] = None

    async def recent() -> list[dict[str, Any]]:
        stmt = select(Scan).order_by(Scan.created_at.desc()).limit(8)
        if not principal.is_analyst:
            stmt = stmt.where((Scan.user_id == principal.user.id) | Scan.simulated)
        return [
            {
                "id": s.id,
                "url": s.url,
                "decision": s.decision,
                "risk_level": s.risk_level,
                "simulated": s.simulated,
                "created_at": ts(s.created_at),
            }
            for s in (await db.execute(stmt)).scalars()
        ]

    async def high_risk() -> list[dict[str, Any]]:
        rows = (
            await db.execute(
                select(Entity)
                .where(Entity.type == "domain", Entity.reputation_score < 0)
                .order_by(Entity.reputation_score)
                .limit(8)
            )
        ).scalars()
        return [
            {"entity_id": e.id, "domain": e.label, "reputation_score": e.reputation_score}
            for e in rows
        ]

    async def cert_alerts() -> list[dict[str, Any]]:
        rows = (
            await db.execute(
                select(CertificateMonitor, Certificate).join(
                    Certificate, Certificate.id == CertificateMonitor.current_certificate_id
                )
            )
        ).all()
        now = utcnow()
        alerts = [
            {"monitor_id": m.id, "domain": m.domain, "days_to_expiry": (c.not_after - now).days}
            for m, c in rows
        ]
        return sorted(
            [a for a in alerts if a["days_to_expiry"] <= 30], key=lambda a: a["days_to_expiry"]
        )

    async def camps() -> list[dict[str, Any]]:
        rows = (
            await db.execute(select(Campaign).order_by(Campaign.confidence.desc()).limit(5))
        ).scalars()
        return [
            {
                "id": c.id,
                "name": c.name,
                "confidence": float(c.confidence),
                "member_count": c.member_count,
                "simulated": c.simulated,
            }
            for c in rows
        ]

    async def queue() -> dict[str, int]:
        rows: dict[str, int] = dict(
            (
                await db.execute(
                    select(ThreatReport.status, func.count()).group_by(ThreatReport.status)
                )
            )
            .tuples()
            .all()
        )
        return {"pending": rows.get("pending", 0), "reviewing": rows.get("reviewing", 0)}

    async def quota() -> dict[str, Any]:
        since = utcnow() - timedelta(hours=1)
        used = (
            await db.execute(
                select(func.count()).where(
                    Scan.user_id == principal.user.id, Scan.created_at > since
                )
            )
        ).scalar_one()
        return {
            "scans_used": used,
            "scans_limit": LIMITS["scans"]["user"][0],
            "resets_at": ts(utcnow() + timedelta(hours=1)),
        }

    for name, fn in (
        ("recent_scans", recent),
        ("high_risk_domains", high_risk),
        ("certificate_alerts", cert_alerts),
        ("campaigns", camps),
        ("report_queue", queue),
        ("quota", quota),
    ):
        await block(name, fn)
    return out
