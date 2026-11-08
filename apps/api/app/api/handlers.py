"""Exception → error envelope translation (BACKEND_OVERVIEW.md §7)."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.middleware import get_request_id
from app.errors import (
    DomainError,
    MalformedJson,
    MethodNotAllowed,
    NotFound,
    PayloadTooLarge,
    ValidationFailed,
)
from app.logging import get_logger

log = get_logger("errors")


def envelope(request: Request, err: DomainError) -> JSONResponse:
    body: dict[str, Any] = {
        "code": str(err.code),
        "message": err.message,
        "request_id": get_request_id(request.scope),
    }
    if err.details:
        body["details"] = err.details
    headers = dict(err.headers)
    if err.status == 401:
        headers.setdefault("WWW-Authenticate", "Bearer")
    return JSONResponse({**err.extra_body, "error": body}, status_code=err.status, headers=headers)


def _field_path(loc: tuple[Any, ...]) -> str | None:
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header")]
    return ".".join(parts) or None


async def domain_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, DomainError):
        raise exc
    log.warning("domain_error", extra={"code": str(exc.code), "status": exc.status})
    return envelope(request, exc)


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    errors = exc.errors()
    if any(e.get("type") == "json_invalid" for e in errors):
        return envelope(request, MalformedJson())
    # Field names are preserved; input values are never echoed (they may contain secrets).
    details = [
        {"field": _field_path(tuple(e.get("loc", ()))), "issue": str(e.get("type", "invalid"))}
        for e in errors
    ]
    return envelope(request, ValidationFailed(details=details))


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        raise exc
    mapped: DomainError
    if exc.status_code == 404:
        mapped = NotFound()
    elif exc.status_code == 405:
        mapped = MethodNotAllowed()
    elif exc.status_code == 413:
        mapped = PayloadTooLarge()
    elif exc.status_code == 400:
        mapped = MalformedJson()
    else:
        mapped = DomainError()
        mapped.status = exc.status_code
    return envelope(request, mapped)


def install_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, domain_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
