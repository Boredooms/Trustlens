"""Run investigations: compile the LangGraph once, checkpoint in Postgres, persist the result."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from typing import Any

from fastapi import FastAPI
from sqlalchemy import select

from app.agents.graph import build_graph
from app.config import Settings
from app.db.engine import to_sync_url
from app.logging import get_logger
from app.models.tables import Investigation, Scan
from app.utils import utcnow

log = get_logger("investigation")

# Bounded so a down DB cannot hang startup; 3 s was too tight for a TLS pooler a region away
# (setup() runs several DDL round trips on first boot).
CHECKPOINTER_CONNECT_TIMEOUT_S = 10.0


async def open_checkpointer(settings: Settings, stack: AsyncExitStack) -> Any:
    """AsyncPostgresSaver on the direct connection (never the pooler).

    Falls back to an in-memory saver if Postgres is unavailable.
    """
    from langgraph.checkpoint.memory import InMemorySaver

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool

        url = to_sync_url(settings.direct_database_url or settings.database_url).replace(
            "postgresql+psycopg", "postgresql"
        )
        pool = AsyncConnectionPool(
            url,
            min_size=1,
            max_size=3,
            open=False,
            # Poolers (Supavisor) drop idle connections; probe before handing one out so a stale
            # connection is replaced instead of failing the investigation with OperationalError.
            check=AsyncConnectionPool.check_connection,
            max_idle=120,
            kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
        )
        # Bounded: an unreachable database must not delay startup (MONITORING_HEALTHCHECKS §6.1).
        try:
            await pool.open(wait=True, timeout=CHECKPOINTER_CONNECT_TIMEOUT_S)
            saver = AsyncPostgresSaver(pool)  # type: ignore[arg-type]
            await asyncio.wait_for(saver.setup(), timeout=CHECKPOINTER_CONNECT_TIMEOUT_S)
        except BaseException:
            await pool.close()
            raise
        stack.push_async_callback(pool.close)
        return saver
    except Exception as exc:  # noqa: BLE001 — degrade visibly, never block startup
        log.warning("investigation.checkpointer_degraded", extra={"exc_type": type(exc).__name__})
        return InMemorySaver()


async def run_investigation(app: FastAPI, investigation_id: str) -> None:
    factory = app.state.session_factory
    compiled = app.state.investigation_graph
    config = {"configurable": {"thread_id": investigation_id}}
    async with factory() as db:
        inv = await db.get(Investigation, investigation_id)
        if inv is None:
            return
        inv.status = "running"
        scan_id = inv.scan_id
        await db.commit()
    try:
        snapshot = await compiled.aget_state(config)
        resume = bool(snapshot and snapshot.next)
        state = await compiled.ainvoke(
            None
            if resume
            else {
                "investigation_id": investigation_id,
                "scan_id": scan_id,
                "dropped_claims": [],
                "repair_count": 0,
            },
            config,
        )
        status = "completed"
    except Exception:  # noqa: BLE001
        log.exception("investigation.failed", extra={"investigation_id": investigation_id})
        state, status = {}, "failed"
    async with factory() as db:
        inv = await db.get(Investigation, investigation_id)
        if inv is None:
            return
        pack = state.get("pack") or {}
        ai = state.get("ai") or {"generated": False, "model": None}
        inv.status = status if state.get("narrative") or status == "failed" else "partial"
        inv.narrative = state.get("narrative")
        inv.references = pack.get("references", [])
        inv.dropped_claims = state.get("dropped_claims", [])
        inv.ai_meta = {**ai, "prompt_version": app.state.settings.prompt_version}
        inv.completed_at = utcnow()
        await db.commit()
    log.info(
        "investigation.completed",
        extra={
            "investigation_id": investigation_id,
            "ai_generated": ai.get("generated"),
            "status": status,
        },
    )


def schedule_investigation(app: FastAPI, investigation_id: str) -> None:
    task = asyncio.create_task(run_investigation(app, investigation_id))
    app.state.runtime.scan_tasks.add(task)
    task.add_done_callback(app.state.runtime.scan_tasks.discard)


async def resume_unfinished(app: FastAPI) -> None:
    """After a restart, resume investigations left queued/running from their checkpoint."""
    try:
        async with app.state.session_factory() as db:
            ids = list(
                (
                    await db.execute(
                        select(Investigation.id).where(
                            Investigation.status.in_(("queued", "running"))
                        )
                    )
                ).scalars()
            )
    except Exception:  # noqa: BLE001 — DB may be asleep at startup; that's fine
        return
    for investigation_id in ids:
        schedule_investigation(app, investigation_id)


async def init(app: FastAPI, stack: AsyncExitStack) -> None:
    saver = await open_checkpointer(app.state.settings, stack)
    app.state.investigation_graph = build_graph(
        app.state.session_factory, app.state.settings
    ).compile(checkpointer=saver)


__all__ = ["init", "schedule_investigation", "resume_unfinished", "Scan"]
