"""Audit log reader (API_ENDPOINTS.md §16, AUTHENTICATION_AUTHORIZATION.md §5.3: operators only).

Rows are append-only; ``before``/``after`` were redacted when written (services/audit.py). The IP
hash is never returned.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_operator
from app.errors import ValidationFailed
from app.models.tables import AuditLog, User
from app.schemas.common import ERROR_RESPONSES
from app.schemas.governance import AuditLogList
from app.security.auth import Principal
from app.utils import is_ulid, iso_z

router = APIRouter(prefix="/api/v1/audit-logs", tags=["audit"], responses=ERROR_RESPONSES)


@router.get("", response_model=AuditLogList, summary="Audit trail (operator only)")
async def list_audit_logs(
    response: Response,
    action: Annotated[str | None, Query(max_length=80)] = None,
    actor_id: str | None = None,
    organisation_id: str | None = None,
    target_id: Annotated[str | None, Query(max_length=80)] = None,
    since: Annotated[datetime | None, Query(alias="from")] = None,
    until: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
    principal: Principal = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> Any:
    for field, value in (
        ("cursor", cursor),
        ("actor_id", actor_id),
        ("organisation_id", organisation_id),
    ):
        if value is not None and not is_ulid(value):
            raise ValidationFailed(details=[{"field": field, "issue": "invalid_id"}])
    stmt = select(AuditLog, User.email).outerjoin(User, User.id == AuditLog.actor_user_id)
    if action:
        # A trailing dot filters a family, e.g. "org." or "domain.".
        family = action.endswith(".")
        stmt = stmt.where(
            AuditLog.action.startswith(action) if family else AuditLog.action == action
        )
    if actor_id:
        stmt = stmt.where(AuditLog.actor_user_id == actor_id)
    if organisation_id:
        stmt = stmt.where(AuditLog.organisation_id == organisation_id)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until:
        stmt = stmt.where(AuditLog.created_at < until)
    if cursor:
        stmt = stmt.where(AuditLog.id < cursor)
    rows = (await db.execute(stmt.order_by(AuditLog.id.desc()).limit(limit + 1))).all()
    more = len(rows) > limit
    rows = rows[:limit]
    response.headers["Cache-Control"] = "no-store"
    return {
        "data": [
            {
                "id": a.id,
                "actor_user_id": a.actor_user_id,
                "actor_email": actor_email,
                "actor_kind": a.actor_kind,
                "action": a.action,
                "target_type": a.target_type,
                "target_id": a.target_id,
                "organisation_id": a.organisation_id,
                "before": a.before,
                "after": a.after,
                "request_id": a.request_id,
                "created_at": iso_z(a.created_at),
            }
            for a, actor_email in rows
        ],
        "page": {"limit": limit, "next_cursor": rows[-1][0].id if more else None},
    }
