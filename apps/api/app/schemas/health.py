"""Health and readiness shapes (MONITORING_HEALTHCHECKS.md §1)."""

from __future__ import annotations

from typing import Literal

from app.schemas.common import ErrorBody, WireModel

CheckStatus = Literal["ok", "degraded", "down"]


class HealthResponse(WireModel):
    status: Literal["ok"]
    service: Literal["trustlens-api"]
    version: str
    uptime_s: int
    timestamp: str


class DatabaseCheck(WireModel):
    status: CheckStatus
    latency_ms: int | None = None
    detail: str | None = None


class ScannerCheck(WireModel):
    status: CheckStatus
    queue_depth: int
    breaker: Literal["closed", "open"]


class LlmCheck(WireModel):
    status: CheckStatus
    detail: str | None = None


class ReadyChecks(WireModel):
    database: DatabaseCheck
    scanner: ScannerCheck
    llm: LlmCheck


class ReadyResponse(WireModel):
    status: Literal["ready", "not_ready"]
    checks: ReadyChecks
    version: str
    error: ErrorBody | None = None
