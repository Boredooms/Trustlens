"""Domain errors and their translation to the single error envelope.

Owner documents: docs/03-backend/BACKEND_OVERVIEW.md §7, docs/02-architecture/API_CONTRACTS.md §5.3.
Routes signal failure only by raising a DomainError. The client never sees ``str(exc)``.
"""

from __future__ import annotations

from typing import Any

from app.schemas.enums import ErrorCode


class DomainError(Exception):
    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    status: int = 500
    message: str = (
        "Something went wrong on our side. Try again; if it persists, quote the request ID."
    )

    def __init__(
        self,
        message: str | None = None,
        *,
        details: list[dict[str, Any]] | None = None,
        headers: dict[str, str] | None = None,
        extra_body: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or type(self).message
        self.details = details
        self.headers = headers or {}
        # Top-level keys next to "error" — only for documented interop hints (e.g. Clerk's
        # reverification hint, which @clerk/shared detects at the top level of the body).
        self.extra_body = extra_body or {}
        super().__init__(self.message)


# ── 7.1 General / auth ──────────────────────────────────────────────────────────
class ValidationFailed(DomainError):
    code, status, message = (
        ErrorCode.VALIDATION_FAILED,
        422,
        "Some fields are invalid. Check the details and try again.",
    )


class MalformedJson(DomainError):
    code, status, message = ErrorCode.MALFORMED_JSON, 400, "The request body is not valid JSON."


class Unauthenticated(DomainError):
    code, status, message = ErrorCode.UNAUTHENTICATED, 401, "Sign in to continue."


class InvalidToken(DomainError):
    code, status, message = ErrorCode.INVALID_TOKEN, 401, "Your session has expired. Sign in again."


class InvalidApiKey(DomainError):
    code, status, message = ErrorCode.INVALID_API_KEY, 401, "The API key is unknown or revoked."


class InsufficientScope(DomainError):
    code, status, message = (
        ErrorCode.INSUFFICIENT_SCOPE,
        403,
        "This key does not have the scope required for this action.",
    )


class Forbidden(DomainError):
    code, status, message = ErrorCode.FORBIDDEN, 403, "You do not have permission to do that."


class CsrfOriginMismatch(DomainError):
    code, status, message = (
        ErrorCode.CSRF_ORIGIN_MISMATCH,
        403,
        "This request came from an origin that is not allowed.",
    )


class DemoModeRequired(DomainError):
    code, status, message = (
        ErrorCode.DEMO_MODE_REQUIRED,
        403,
        "This simulated capability is available only in demo mode.",
    )


class NotFound(DomainError):
    code, status, message = ErrorCode.NOT_FOUND, 404, "We could not find that."


class MethodNotAllowed(DomainError):
    code, status, message = (
        ErrorCode.METHOD_NOT_ALLOWED,
        405,
        "That method is not supported on this resource.",
    )


class Conflict(DomainError):
    code, status, message = ErrorCode.CONFLICT, 409, "That conflicts with the current state."


class PayloadTooLarge(DomainError):
    code, status, message = (
        ErrorCode.PAYLOAD_TOO_LARGE,
        413,
        "The request body is larger than the 256 kB limit.",
    )


class RateLimited(DomainError):
    code, status, message = (
        ErrorCode.RATE_LIMITED,
        429,
        "Too many requests. Wait a moment and try again.",
    )


class NotReady(DomainError):
    code, status, message = (
        ErrorCode.NOT_READY,
        503,
        "The service is starting or a dependency is unavailable. Try again shortly.",
    )


class NotImplementedYet(DomainError):
    code, status, message = (
        ErrorCode.NOT_IMPLEMENTED,
        501,
        "This capability is documented but not implemented yet.",
    )


# ── 7.2 Scanning and assessment ─────────────────────────────────────────────────
class InvalidUrl(DomainError):
    code, status, message = (
        ErrorCode.INVALID_URL,
        422,
        "Enter a complete web address starting with http:// or https://.",
    )


class UnsupportedScheme(DomainError):
    code, status, message = (
        ErrorCode.UNSUPPORTED_SCHEME,
        422,
        "Only http and https addresses can be checked.",
    )


class UrlHasCredentials(DomainError):
    code, status, message = (
        ErrorCode.URL_HAS_CREDENTIALS,
        422,
        "Remove the username or password from the address before checking it.",
    )


class TargetNotAllowed(DomainError):
    code, status, message = (
        ErrorCode.TARGET_NOT_ALLOWED,
        422,
        "This address points to a private or reserved network and cannot be checked.",
    )


class DnsResolutionFailed(DomainError):
    code, status, message = (
        ErrorCode.DNS_RESOLUTION_FAILED,
        422,
        "We could not resolve this domain. Check the spelling and try again.",
    )


class UnsupportedPort(DomainError):
    code, status, message = (
        ErrorCode.UNSUPPORTED_PORT,
        422,
        "Only ports 80, 443, 8080 and 8443 can be checked.",
    )
