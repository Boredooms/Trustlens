"""Readiness probing (MONITORING_HEALTHCHECKS.md §1.2).

``/ready`` really queries the database — no hard-coded "connected". A slow-but-successful query
is reported with its latency; an error or a timeout is ``down`` and makes the service unready. An
absent LLM key is ``degraded`` and never makes the service unready (investigations fall back to
templates).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.logging import get_logger
from app.schemas.health import DatabaseCheck, LlmCheck, ReadyChecks, ScannerCheck

DB_CHECK_TIMEOUT_S = 2.0

log = get_logger("health")


@dataclass
class RuntimeState:
    """Process-local, non-authoritative runtime facts used by readiness."""

    started_at: float = field(default_factory=time.monotonic)
    shutting_down: bool = False
    scanner_breaker_open: bool = False
    llm_last_call_failed: bool = False
    scan_tasks: set[asyncio.Task[None]] = field(default_factory=set)
    background_tasks: set[asyncio.Task[None]] = field(default_factory=set)  # not scans

    @property
    def uptime_s(self) -> int:
        return int(time.monotonic() - self.started_at)


async def check_database(engine: AsyncEngine) -> DatabaseCheck:
    started = time.perf_counter()
    try:
        async with asyncio.timeout(DB_CHECK_TIMEOUT_S):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except TimeoutError:
        log.warning("ready.database_timeout")
        return DatabaseCheck(status="down", detail="timeout")
    except Exception as exc:  # noqa: BLE001 — any driver error means "cannot persist"
        log.warning("ready.database_error", extra={"exc_type": type(exc).__name__})
        return DatabaseCheck(status="down", detail="unreachable")
    latency_ms = round((time.perf_counter() - started) * 1000)
    return DatabaseCheck(status="ok", latency_ms=latency_ms)


def check_scanner(state: RuntimeState, settings: Settings) -> ScannerCheck:
    depth = sum(1 for task in state.scan_tasks if not task.done())
    saturated = depth >= settings.scan_concurrency * 4
    breaker = "open" if state.scanner_breaker_open else "closed"
    status = "degraded" if saturated or state.scanner_breaker_open else "ok"
    return ScannerCheck(status=status, queue_depth=depth, breaker=breaker)


def check_llm(state: RuntimeState, settings: Settings) -> LlmCheck:
    if not settings.llm_configured:
        return LlmCheck(status="degraded", detail="no_api_key")
    if state.llm_last_call_failed:
        return LlmCheck(status="degraded", detail="last_call_failed")
    return LlmCheck(status="ok")


async def readiness(engine: AsyncEngine, state: RuntimeState, settings: Settings) -> ReadyChecks:
    if state.shutting_down:
        database = DatabaseCheck(status="down", detail="shutting_down")
    else:
        database = await check_database(engine)
    return ReadyChecks(
        database=database,
        scanner=check_scanner(state, settings),
        llm=check_llm(state, settings),
    )
