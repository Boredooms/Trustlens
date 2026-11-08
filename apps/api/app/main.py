"""Application factory and lifecycle (BACKEND_OVERVIEW.md §3, MONITORING_HEALTHCHECKS.md §6)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import timedelta

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.handlers import install_handlers
from app.api.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    UnhandledErrorMiddleware,
)
from app.api.routes import (  # platform
    admin,
    anchors,  # web3 registry
    appeals,
    auth,
    certificates,
    developer,
    health,
    intelligence,
    internal_jobs,
    investigations,
    invites,  # governance
    organisations,
    reports,
    scans,
    webhooks,
)
from app.api.routes import audit as audit_routes  # governance
from app.config import Settings, get_settings
from app.db.engine import create_engine, create_session_factory
from app.logging import configure_logging, get_logger
from app.services.health import RuntimeState
from app.services.ratelimit import RateLimiter

log = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings: Settings = app.state.settings
    runtime: RuntimeState = app.state.runtime
    # Engine was created in create_app without connecting: startup never fails on DB availability.
    app.state.http = httpx.AsyncClient(
        follow_redirects=False,  # every hop is validated by the guard (SECURITY_THREAT_MODEL.md)
        timeout=httpx.Timeout(settings.probe_timeout_seconds),
        headers={"User-Agent": settings.scan_user_agent},
    )
    app.state.scan_semaphore = asyncio.Semaphore(settings.scan_concurrency)
    stack = AsyncExitStack()
    from app.services import investigations as investigation_service

    await investigation_service.init(app, stack)

    async def maintenance() -> None:
        # Best-effort and off the startup path: a sleeping database must not delay /health.
        await _sweep_stale_scans(app)
        await investigation_service.resume_unfinished(app)

    startup_task = asyncio.create_task(maintenance())
    runtime.background_tasks.add(startup_task)
    startup_task.add_done_callback(runtime.background_tasks.discard)
    if settings.demo_mode and settings.is_production:
        log.warning("startup.demo_mode_in_production", extra={"demo_mode": True})
    log.info(
        "startup",
        extra={
            "demo_mode": settings.demo_mode,
            "deep_scan_enabled": settings.deep_scan_enabled,
            "llm_configured": settings.llm_configured,
        },
    )
    try:
        yield
    finally:
        runtime.shutting_down = True  # /ready flips to 503 immediately (§6.2)
        pending = [*runtime.scan_tasks, *runtime.background_tasks]
        for task in pending:
            task.cancel()
        # Let cancelled tasks unwind before their resources close (no "Task was destroyed").
        await asyncio.gather(*pending, return_exceptions=True)
        await app.state.http.aclose()
        await app.state.rate_limiter.aclose()
        await stack.aclose()
        await app.state.engine.dispose()
        log.info("shutdown", extra={"uptime_s": runtime.uptime_s})


async def _sweep_stale_scans(app: FastAPI) -> None:
    """Fail scans a previous process left running > 5 min (MONITORING_HEALTHCHECKS §6.1)."""
    from sqlalchemy import update

    from app.models.tables import Scan
    from app.utils import utcnow

    try:
        async with app.state.session_factory() as db:
            result = await db.execute(
                update(Scan)
                .where(Scan.status.in_(("queued", "running")))
                .where(Scan.created_at < utcnow() - timedelta(minutes=5))
                .values(status="failed", failure_code="STALE_ON_STARTUP", completed_at=utcnow())
            )
            await db.commit()
            if result.rowcount:
                log.info("startup.stale_scans_swept", extra={"count": result.rowcount})
    except Exception:  # noqa: BLE001 — startup never fails on DB unavailability
        log.warning("startup.sweep_skipped_db_unavailable")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, env=settings.environment, version=settings.app_version)

    app = FastAPI(
        title="TrustLens API",
        version=settings.app_version,
        description=(
            "Website trust intelligence. Every decision is BLOCK, WARN, ALLOW, REVIEW or UNKNOWN. "
            "ALLOW means no known threat within the checks that ran — never 'safe'."
        ),
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.runtime = RuntimeState()
    app.state.engine = create_engine(settings.database_url)
    app.state.session_factory = create_session_factory(app.state.engine)
    token = settings.upstash_redis_rest_token
    app.state.rate_limiter = RateLimiter(  # shared Upstash counters when configured (§10)
        settings.upstash_redis_rest_url, token.get_secret_value() if token else None
    )

    install_handlers(app)

    # Starlette wraps in reverse order: the last added is the outermost.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,  # Bearer auth only; the API sets no cookie (ADR-015)
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Client",
            "X-Request-Id",
        ],
        expose_headers=[
            "X-Request-Id",
            "Retry-After",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
            "X-RateLimit-Degraded",
            "Idempotent-Replay",
        ],
        max_age=600,
    )
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health.router)
    for module in (
        auth,
        scans,
        organisations,
        reports,
        intelligence,
        certificates,
        investigations,
        developer,
    ):
        app.include_router(module.router)
    app.include_router(invites.router)  # governance
    app.include_router(audit_routes.router)  # governance
    app.include_router(appeals.router)  # platform
    app.include_router(internal_jobs.router)  # platform (not in the public OpenAPI)
    app.include_router(webhooks.router)  # Clerk user sync (not in the public OpenAPI)
    app.include_router(admin.router)  # operator demo controls
    app.include_router(anchors.router)  # web3 report registry (WEB3_REGISTRY.md)
    return app


def __getattr__(name: str) -> FastAPI:
    # ``uvicorn app.main:app`` resolves the app lazily so importing this module in tests does not
    # require a complete environment. Settings are still validated before the server starts.
    if name == "app":
        instance = create_app()
        globals()["app"] = instance
        return instance
    raise AttributeError(name)
