"""HTTP middleware, outermost first (BACKEND_OVERVIEW.md §5).

Pure ASGI implementations so streaming and exception propagation behave predictably:

1. RequestContextMiddleware   accept or mint X-Request-Id, bind to logs, echo, one request log line
2. SecurityHeadersMiddleware  nosniff, referrer policy, frame deny, HSTS in production
3. BodySizeLimitMiddleware    reject > 256 kB before parsing
4. CORSMiddleware             explicit allowlist (Starlette's, configured in main.py)
5. UnhandledErrorMiddleware   innermost: any unhandled exception → 500 envelope, stack server-side

Timing is folded into (1) as ``Server-Timing`` plus the request log's ``duration_ms``. The Origin
check for cookie-authenticated mutations (#6) does not apply: the API sets no auth cookie (ADR-015).
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.errors import PayloadTooLarge
from app.logging import get_logger, request_id_var
from app.schemas.enums import ErrorCode
from app.utils import new_ulid

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
MAX_BODY_BYTES = 256 * 1024
SLOW_REQUEST_MS = 2000

log = get_logger("http")


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return bytes(value).decode("latin-1")
    return None


def get_request_id(scope: Scope) -> str:
    state = scope.setdefault("state", {})
    rid = state.get("request_id")
    if not rid:
        rid = f"req_{new_ulid()}"
        state["request_id"] = rid
    return str(rid)


def error_body(code: str, message: str, request_id: str, details: Any = None) -> bytes:
    error: dict[str, Any] = {"code": code, "message": message, "request_id": request_id}
    if details:
        error["details"] = details
    return json.dumps({"error": error}).encode()


async def send_json(
    send: Send, status: int, body: bytes, headers: list[tuple[bytes, bytes]]
) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
                *headers,
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = _header(scope, b"x-request-id")
        rid = supplied if supplied and REQUEST_ID_PATTERN.match(supplied) else f"req_{new_ulid()}"
        scope.setdefault("state", {})["request_id"] = rid
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                elapsed_ms = (time.perf_counter() - started) * 1000
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode()))
                headers.append((b"server-timing", f"app;dur={elapsed_ms:.1f}".encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000)
            status = status_holder["status"]
            level = "error" if status >= 500 else "warning" if status > 422 else "info"
            # Path only — never the query string, which may carry tokens (§3.2).
            getattr(log, level)(
                "request.completed",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status,
                    "duration_ms": duration_ms,
                    "slow": duration_ms > SLOW_REQUEST_MS,
                },
            )
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        self.headers: list[tuple[bytes, bytes]] = [
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"x-frame-options", b"DENY"),
            (b"cross-origin-resource-policy", b"same-site"),
        ]
        if hsts:
            self.headers.append(
                (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *self.headers]
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    """Reject bodies over the limit before any parsing.

    Content-Length is checked first; bodies without it (chunked) are buffered up to the limit and
    replayed. Buffering is bounded by the limit itself (256 kB), so it cannot be used to exhaust
    memory, and it avoids FastAPI converting a mid-parse failure into a generic 400.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        declared = _header(scope, b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await self._reject(scope, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _reject(scope: Scope, send: Send) -> None:
        err = PayloadTooLarge()
        await send_json(
            send, err.status, error_body(err.code, err.message, get_request_id(scope)), []
        )


class UnhandledErrorMiddleware:
    """Innermost safety net: an unexpected exception becomes a 500 envelope.

    Sitting inside CORS means browsers still receive CORS headers and can read the request ID.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            log.exception("request.unhandled_exception", extra={"path": scope.get("path")})
            if response_started:
                raise
            await send_json(
                send,
                500,
                error_body(
                    ErrorCode.INTERNAL_ERROR,
                    "Something went wrong on our side. Try again; if it persists, quote the "
                    "request ID.",
                    get_request_id(scope),
                ),
                [],
            )
