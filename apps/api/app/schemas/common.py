"""Shared wire shapes: error envelope, pagination, decision object.

Owner document: docs/02-architecture/API_CONTRACTS.md §5.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import Decision, RiskLevel, SignalGroup


class WireModel(BaseModel):
    """Base for response models. snake_case field names are the wire names (ADR-007)."""

    model_config = ConfigDict(populate_by_name=False, use_enum_values=False)


class RequestModel(BaseModel):
    """Base for request bodies: unknown fields are a 422, never a silent no-op (§13)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ErrorDetail(WireModel):
    field: str | None = None
    issue: str
    observed: str | None = None


class ErrorBody(WireModel):
    code: str = Field(description="Stable error code from the registry (API_CONTRACTS.md §7).")
    message: str = Field(description="Human-readable, safe to display, never contains internals.")
    request_id: str = Field(description="Always equals the X-Request-Id response header.")
    details: list[ErrorDetail] | None = None


class ErrorEnvelope(WireModel):
    error: ErrorBody


class PageInfo(WireModel):
    limit: int
    next_cursor: str | None
    total_estimate: int | None = None


class Coverage(WireModel):
    percent: Annotated[int, Field(ge=0, le=100)]
    collected: list[SignalGroup]
    unavailable: list[SignalGroup]
    skipped: list[SignalGroup]


class DecisionObject(WireModel):
    """Embedded in several resources (API_CONTRACTS.md §5.4).

    A verdict is invalid without coverage.
    """

    decision: Decision
    risk_level: RiskLevel
    risk_score: Annotated[int, Field(ge=0, le=100)] | None
    coverage: Coverage
    reasons: list[str]


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    status: {"model": ErrorEnvelope, "description": description}
    for status, description in (
        (400, "Malformed request"),
        (401, "Missing or invalid credentials"),
        (403, "Not permitted"),
        (404, "Not found or not visible"),
        (422, "Validation failure or policy rejection"),
        (429, "Rate limited"),
        (500, "Unexpected server error"),
    )
}
