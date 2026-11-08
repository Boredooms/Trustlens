"""Idempotent replay for mutations (API_CONTRACTS.md §9).

Same key + same body hash within 24 h → stored response with ``Idempotent-Replay: true``.
Same key + different body → ``409 IDEMPOTENCY_KEY_REUSED``. Postgres is authoritative (ADR-013).
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError, ValidationFailed
from app.models.tables import IdempotencyKey
from app.schemas.enums import ErrorCode
from app.security.auth import Principal
from app.utils import new_ulid, utcnow

KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class IdempotencyKeyReused(DomainError):
    code, status, message = (
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        409,
        "This idempotency key was already used with a different request.",
    )


async def idempotent(
    request: Request,
    response: Response,
    db: AsyncSession,
    principal: Principal | None,
    body: dict[str, Any],
    status: int,
    run: Callable[[], Awaitable[dict[str, Any]]],
) -> Any:
    key = request.headers.get("idempotency-key")
    if key is None:
        response.status_code = status
        return await run()
    if not KEY_PATTERN.match(key):
        raise ValidationFailed(details=[{"field": "Idempotency-Key", "issue": "invalid_format"}])
    actor = (
        f"{principal.kind}:{principal.key_id or principal.user.id}"
        if principal
        else (f"ip:{request.client.host if request.client else 'unknown'}")
    )
    scope = f"{request.method} {request.url.path}"
    body_hash = hashlib.sha256(json.dumps([scope, body], sort_keys=True).encode()).hexdigest()
    existing = (
        await db.execute(
            select(IdempotencyKey).where(
                IdempotencyKey.actor_id == actor,
                IdempotencyKey.key == key,
                IdempotencyKey.expires_at > utcnow(),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.body_hash != body_hash:
            raise IdempotencyKeyReused()
        return JSONResponse(
            existing.response_body,
            status_code=200,
            headers={"Idempotent-Replay": "true"},
        )
    result = await run()
    await db.execute(
        insert(IdempotencyKey)
        .values(
            id=new_ulid(),
            actor_id=actor,
            key=key,
            body_hash=body_hash,
            response_status=status,
            response_body=json.loads(json.dumps(result, default=str)),
            expires_at=utcnow() + timedelta(hours=24),
        )
        .on_conflict_do_nothing(index_elements=["actor_id", "key"])
    )
    await db.commit()
    response.status_code = status
    return result
