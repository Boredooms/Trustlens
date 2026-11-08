"""Scheduled jobs called by Upstash QStash (BACKEND_OVERVIEW.md §9.3, HOSTED_SERVICES.md).

Two ways in, nothing else:

1. QStash: a valid ``Upstash-Signature`` (security/qstash.py) — the cron path.
2. An operator's own session (``Authorization: Bearer …``, role ``operator``) — the manual trigger
   HOSTED_SERVICES.md §5 asks for when the cron stalls.

These routes are excluded from the public OpenAPI document. Every job is idempotent.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.exc import InterfaceError, OperationalError

from app.api.deps import bearer
from app.errors import Forbidden, NotFound, NotReady, Unauthenticated
from app.logging import get_logger
from app.security import qstash
from app.security.auth import authenticate
from app.services.jobs import JOBS
from app.utils import iso_z, utcnow

router = APIRouter(prefix="/internal/jobs", tags=["internal"], include_in_schema=False)
log = get_logger("jobs")


async def _authorise(
    request: Request,
    signature: str | None,
    creds: HTTPAuthorizationCredentials | None,
) -> str:
    settings = request.app.state.settings
    if signature is not None:
        qstash.verify(signature, await request.body(), str(request.url), settings)
        return "qstash"
    if creds is None:
        raise Unauthenticated()
    try:
        async with request.app.state.session_factory() as db:
            principal = await authenticate(db, creds.credentials, settings)
            await db.commit()
    except (OperationalError, InterfaceError, OSError) as exc:
        raise NotReady() from exc
    if not principal.is_operator:
        raise Forbidden()
    return f"operator:{principal.user.id}"


@router.post("/{job}")
async def run_job(
    job: str,
    request: Request,
    upstash_signature: str | None = Header(None, alias="Upstash-Signature"),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Any:
    caller = await _authorise(request, upstash_signature, creds)
    fn = JOBS.get(job)
    if fn is None:
        raise NotFound("There is no such job.")
    started = time.perf_counter()
    try:
        result = await fn(request.app.state.session_factory, request.app.state.settings)
    except (OperationalError, InterfaceError, OSError) as exc:
        # Database unreachable: 503 so QStash retries later; the job is idempotent.
        log.warning("job.db_unavailable", extra={"job": job, "exc_type": type(exc).__name__})
        raise NotReady() from exc
    duration_ms = round((time.perf_counter() - started) * 1000)
    log.info(
        "job.completed",
        extra={"job": job, "caller": caller.split(":")[0], "duration_ms": duration_ms, **result},
    )
    return {
        "job": job,
        "ok": True,
        "result": result,
        "duration_ms": duration_ms,
        "ran_at": iso_z(utcnow()),
    }
