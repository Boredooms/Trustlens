"""Request dependencies (BACKEND_OVERVIEW.md §6)."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Any

from fastapi import BackgroundTasks, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import Forbidden, InsufficientScope, NotReady, RateLimited, Unauthenticated
from app.security.auth import Principal, authenticate
from app.services.ratelimit import RateLimiter
from app.services.usage import METERED_GROUPS, record_usage

bearer = HTTPBearer(auto_error=False)


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    session: AsyncSession = request.app.state.session_factory()
    try:
        yield session
    except (OperationalError, InterfaceError, ConnectionError, OSError) as exc:
        await session.rollback()
        raise NotReady() from exc
    except DBAPIError as exc:
        await session.rollback()
        if exc.connection_invalidated:
            raise NotReady() from exc
        raise
    finally:
        await session.close()


async def optional_principal(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> Principal | None:
    if creds is None:
        return None
    try:
        principal = await authenticate(db, creds.credentials, request.app.state.settings)
    except (OperationalError, InterfaceError, OSError) as exc:
        raise NotReady() from exc
    await db.commit()
    request.state.principal = principal
    return principal


async def current_principal(principal: Principal | None = Depends(optional_principal)) -> Principal:
    if principal is None:
        raise Unauthenticated()
    return principal


def require_scope(scope: str) -> Callable[..., Coroutine[Any, Any, Principal]]:
    async def dep(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.has_scope(scope):
            raise InsufficientScope()
        return principal

    return dep


async def require_human(principal: Principal = Depends(current_principal)) -> Principal:
    """Session-only endpoints: machine keys can never manage keys, orgs or reviews (AUTH §6.3)."""
    if principal.kind != "user":
        raise InsufficientScope()
    return principal


async def require_analyst(principal: Principal = Depends(require_human)) -> Principal:
    if not principal.is_analyst:
        raise Forbidden()
    return principal


async def require_operator(principal: Principal = Depends(require_human)) -> Principal:
    if not principal.is_operator:
        raise Forbidden()
    return principal


# ── Rate limiting (API_CONTRACTS.md §10) ────────────────────────────────────────
# Upstash Redis is the shared store in hosted environments (services/ratelimit.py); without it, or
# when it fails, limits degrade to per-worker counters (approximate, never stricter than documented)
# and say so in X-RateLimit-Degraded.
_ASSESS_LIMITS = {
    "anonymous": (20, 3600),
    "user": (300, 3600),
    "api_key": (3000, 3600),
    "extension": (1200, 3600),
}
LIMITS: dict[str, dict[str, tuple[int, int]]] = {
    "scans": {
        "anonymous": (5, 3600),
        "user": (60, 3600),
        "api_key": (600, 3600),
        "extension": (300, 3600),
    },
    "assess": _ASSESS_LIMITS,
    # verify-identity / verify-payment / inspect-redirect sit on the assessment budget per caller
    # kind but count separately (API_CONTRACTS §10 lists them under "assessment"; documented there).
    "verify": _ASSESS_LIMITS,
    "inspect": _ASSESS_LIMITS,
    "reports": {"user": (30, 3600), "api_key": (100, 3600), "extension": (30, 3600)},
    "investigations": {"user": (20, 86400), "api_key": (50, 86400)},
    "pair": {"user": (10, 3600)},
    # Anonymous appeal creation and challenge checks, per IP (API_CONTRACTS §10 "verification
    # attempts" budget applied to the public appeal path).
    "appeals": {"anonymous": (5, 3600), "user": (5, 3600)},
    "appeal_verify": {"anonymous": (20, 3600), "user": (20, 3600)},
    # Message analysis (MESSAGE_ANALYSIS.md §2): each call may assess up to 3 links.
    "messages": {"user": (60, 3600), "api_key": (600, 3600)},
    # Public report verification (WEB3_REGISTRY.md §5): every call reads the chain.
    "public_verify": {"anonymous": (60, 3600), "user": (120, 3600)},
}


def rate_limit(group: str) -> Callable[..., Coroutine[Any, Any, None]]:
    async def dep(
        request: Request,
        response: Response,
        background: BackgroundTasks,
        principal: Principal | None = Depends(optional_principal),
    ) -> None:
        settings: Settings = request.app.state.settings
        if principal is not None and group in METERED_GROUPS:
            # Usage is metered after the response is sent (never on the request path).
            background.add_task(
                record_usage,
                request.app.state.session_factory,
                principal.key_id or principal.user.id,
                principal.kind,
                group,
            )
        if not settings.rate_limit_enabled:
            return
        kind = principal.kind if principal else "anonymous"
        limit = LIMITS.get(group, {}).get(kind)
        if limit is None:
            return
        actor = principal.key_id or principal.user.id if principal else _client_ip(request)
        count, window = limit
        limiter: RateLimiter = request.app.state.rate_limiter
        hit = await limiter.hit(f"rl:{group}:{kind}:{actor}", count, window)
        headers = {
            "X-RateLimit-Limit": str(count),
            "X-RateLimit-Remaining": str(hit.remaining),
            "X-RateLimit-Reset": str(int(hit.reset_at)),
        }
        if hit.degraded:
            headers["X-RateLimit-Degraded"] = "true"
        if not hit.allowed:
            retry = max(1, int(hit.reset_at - time.time()) + 1)
            raise RateLimited(headers={**headers, "Retry-After": str(retry)})
        response.headers.update(headers)

    return dep


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
