"""GET /health, GET /ready, GET /api/v1/health (MONITORING_HEALTHCHECKS.md §1)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.middleware import get_request_id
from app.errors import NotReady
from app.schemas.common import ErrorBody
from app.schemas.health import HealthResponse, ReadyResponse
from app.services.health import RuntimeState, readiness
from app.utils import iso_z, utcnow

router = APIRouter(tags=["health"])

_NO_STORE = {"Cache-Control": "no-store"}


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness",
    description="Is the process alive? Never touches the database.",
)
async def health(request: Request) -> JSONResponse:
    state: RuntimeState = request.app.state.runtime
    body = HealthResponse(
        status="ok",
        service="trustlens-api",
        version=request.app.state.settings.app_version,
        uptime_s=state.uptime_s,
        timestamp=iso_z(utcnow()),
    )
    return JSONResponse(body.model_dump(mode="json"), headers=_NO_STORE)


async def _ready(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    checks = await readiness(request.app.state.engine, request.app.state.runtime, settings)
    ready = checks.database.status == "ok"
    body = ReadyResponse(
        status="ready" if ready else "not_ready",
        checks=checks,
        version=settings.app_version,
        error=None
        if ready
        else ErrorBody(
            code=NotReady.code,
            message=NotReady.message,
            request_id=get_request_id(request.scope),
        ),
    )
    return JSONResponse(
        body.model_dump(mode="json", exclude_none=True),
        status_code=200 if ready else 503,
        headers={**_NO_STORE, **({} if ready else {"Retry-After": "5"})},
    )


_READY_DOC = {
    "response_model": ReadyResponse,
    "responses": {503: {"model": ReadyResponse, "description": "Database unavailable"}},
    "summary": "Readiness",
    "description": "Can it serve traffic? Queries the database; LLM absence is only degraded.",
}


@router.get("/ready", **_READY_DOC)  # type: ignore[arg-type]
async def ready(request: Request) -> JSONResponse:
    return await _ready(request)


@router.get("/api/v1/health", operation_id="versioned_health", **_READY_DOC)  # type: ignore[arg-type]
async def versioned_health(request: Request) -> JSONResponse:
    return await _ready(request)
