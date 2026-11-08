"""Investigation orchestration as a LangGraph ``StateGraph``.

See ADR-014 and AI_INVESTIGATION_ENGINE.md §2.

Static topology — the model never chooses a tool or a branch. Routing depends only on configuration
(is an LLM key present?) and on deterministic validation. State is checkpointed in Postgres
(``AsyncPostgresSaver``) keyed by the investigation id, so a restart resumes instead of starting
over.
Only ``narrate`` may call a model; nothing in the graph writes to ``scans``.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.narrative import build_pack, llm_narrative, template_narrative, validate
from app.config import Settings
from app.logging import get_logger
from app.models.tables import (
    Campaign,
    Entity,
    Evidence,
    Investigation,
    Relationship,
    Scan,
    ScanFinding,
    ThreatReport,
)
from app.services.scan_orchestrator import finding_to_wire
from app.services.serialise import evidence_wire, scan_full
from app.utils import iso_z, utcnow

log = get_logger("investigation")


class InvestigationState(TypedDict, total=False):
    investigation_id: str
    scan_id: str
    scan: dict[str, Any] | None
    findings: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    related: list[dict[str, Any]]
    reputation: dict[str, Any] | None
    pack: dict[str, Any] | None
    draft: dict[str, Any] | None
    narrative: dict[str, Any] | None
    dropped_claims: list[dict[str, Any]]
    repair_count: int
    validation_error: str | None
    ai: dict[str, Any]
    errors: list[str]


Node = Callable[[InvestigationState], Awaitable[dict[str, Any]]]


def build_graph(
    factory: async_sessionmaker[AsyncSession], settings: Settings
) -> StateGraph[InvestigationState]:
    async def record_step(
        investigation_id: str, name: str, status: str, duration_ms: int, error: str | None
    ) -> None:
        async with factory() as db:
            inv = await db.get(Investigation, investigation_id)
            if inv is None:
                return
            steps = [s for s in inv.steps if s["name"] != name]
            steps.append(
                {
                    "name": name,
                    "status": status,
                    "duration_ms": duration_ms,
                    "error": error,
                    "ended_at": iso_z(utcnow()),
                }
            )
            inv.steps = steps
            inv.status = "running"
            await db.commit()

    def traced(name: str, fn: Node, *, degrade: dict[str, Any] | None = None) -> Node:
        async def run(state: InvestigationState) -> dict[str, Any]:
            started = time.perf_counter()
            try:
                out = await fn(state)
                status, error = "completed", None
            except Exception as exc:  # noqa: BLE001 — degrade per §3, never crash the graph
                if degrade is None:
                    raise
                log.warning(
                    "investigation.step_degraded",
                    extra={"step": name, "exc_type": type(exc).__name__},
                )
                out, status, error = dict(degrade), "degraded", type(exc).__name__
            await record_step(
                state["investigation_id"],
                name,
                status,
                round((time.perf_counter() - started) * 1000),
                error,
            )
            return out

        return run

    async def load_scan(state: InvestigationState) -> dict[str, Any]:
        async with factory() as db:
            scan = await db.get(Scan, state["scan_id"])
            if scan is None:
                raise LookupError("scan not found")
            findings = list(
                (
                    await db.execute(select(ScanFinding).where(ScanFinding.scan_id == scan.id))
                ).scalars()
            )
            evidence = list(
                (
                    await db.execute(
                        select(Evidence).where(Evidence.scan_id == scan.id).order_by(Evidence.id)
                    )
                ).scalars()
            )
            return {
                "scan": scan_full(scan, findings, evidence),
                "findings": [finding_to_wire(f) for f in findings],
                "evidence": [evidence_wire(e, include_payload=False) for e in evidence],
            }

    async def collect_context(state: InvestigationState) -> dict[str, Any]:
        return {"findings": [f for f in state["findings"] if f["code"]]}

    async def correlate_graph(state: InvestigationState) -> dict[str, Any]:
        scan = state["scan"] or {}
        host = scan["normalised_url"].split("/")[2].split(":")[0]
        async with factory() as db:
            root = (
                await db.execute(select(Entity).where(Entity.key == f"domain:{host}"))
            ).scalar_one_or_none()
            if root is None:
                return {"related": []}
            rows = (
                await db.execute(
                    select(Relationship, Entity)
                    .join(
                        Entity,
                        (
                            (Relationship.target_entity_id == Entity.id)
                            & (Relationship.source_entity_id == root.id)
                        )
                        | (
                            (Relationship.source_entity_id == Entity.id)
                            & (Relationship.target_entity_id == root.id)
                        ),
                    )
                    .where(Entity.id != root.id)
                )
            ).all()
            related = [
                {
                    "id": e.id,
                    "type": e.type,
                    "label": e.label,
                    "edge": r.type,
                    "confidence": float(r.confidence),
                }
                for r, e in rows
            ]
            related.sort(key=lambda x: (-x["confidence"], x["label"]))
            return {"related": related}

    async def reputation_history(state: InvestigationState) -> dict[str, Any]:
        scan = state["scan"] or {}
        async with factory() as db:
            reports = list(
                (
                    await db.execute(
                        select(ThreatReport.status).where(
                            ThreatReport.normalised_url == scan["normalised_url"]
                        )
                    )
                ).scalars()
            )
            campaign = None
            for item in state.get("related", []):
                if item["type"] == "campaign":
                    ent = await db.get(Entity, item["id"])
                    c = await db.get(Campaign, ent.key.removeprefix("campaign:")) if ent else None
                    if c:
                        campaign = {
                            "name": c.name,
                            "confidence": float(c.confidence),
                            "member_count": c.member_count,
                        }
            return {
                "reputation": {
                    "reports": len(reports),
                    "confirmed": reports.count("confirmed"),
                    "campaign": campaign,
                }
            }

    async def build_evidence_pack(state: InvestigationState) -> dict[str, Any]:
        pack = build_pack(
            state["scan"] or {},
            state["findings"],
            state.get("evidence", []),
            state.get("related", []),
            state.get("reputation") or {},
        )
        campaign = (pack.get("reputation") or {}).get("campaign")
        if campaign:
            ref = next((r["ref"] for r in pack["related"] if r["type"] == "campaign"), None)
            campaign["ref"] = ref
        return {"pack": pack}

    async def narrate(state: InvestigationState) -> dict[str, Any]:
        hint = state.get("validation_error") if state.get("repair_count", 0) else None
        draft, meta = await llm_narrative(state["pack"] or {}, settings, hint)
        return {"draft": draft, "ai": {"generated": True, "model": settings.llm_model, **meta}}

    async def validate_node(state: InvestigationState) -> dict[str, Any]:
        narrative, dropped, error = validate(state.get("draft"), state["pack"] or {})
        return {
            "narrative": narrative,
            "dropped_claims": state.get("dropped_claims", []) + dropped,
            "validation_error": error,
            "repair_count": state.get("repair_count", 0) + (1 if error else 0),
        }

    async def template_narrate(state: InvestigationState) -> dict[str, Any]:
        reason = (
            "no_api_key"
            if not settings.llm_configured
            else (state.get("validation_error") or "llm_failed")
        )
        narrative, _, _ = validate(template_narrative(state["pack"] or {}), state["pack"] or {})
        return {
            "narrative": narrative or template_narrative(state["pack"] or {}),
            "ai": {"generated": False, "model": None, "fallback_reason": reason},
        }

    def route_by_llm(state: InvestigationState) -> str:
        return "llm" if settings.llm_configured else "template"

    def route_by_validation(state: InvestigationState) -> str:
        if state.get("narrative") and not state.get("validation_error"):
            return "done"
        return "repair" if state.get("repair_count", 0) <= 1 and state.get("draft") else "fallback"

    graph = StateGraph(InvestigationState)
    graph.add_node("load_scan", traced("load_scan", load_scan))
    graph.add_node("collect_context", traced("collect_context", collect_context))
    graph.add_node(
        "correlate_graph", traced("correlate_graph", correlate_graph, degrade={"related": []})
    )
    graph.add_node(
        "reputation_history",
        traced("reputation_history", reputation_history, degrade={"reputation": {}}),
    )
    graph.add_node("build_evidence_pack", traced("build_evidence_pack", build_evidence_pack))
    graph.add_node(
        "narrate",
        traced(
            "narrate",
            narrate,
            degrade={"draft": None, "validation_error": "llm_failed", "repair_count": 2},
        ),
    )
    graph.add_node("validate", traced("validate", validate_node))
    graph.add_node("template_narrate", traced("template_narrate", template_narrate))
    graph.add_edge(START, "load_scan")
    graph.add_edge("load_scan", "collect_context")
    graph.add_edge("collect_context", "correlate_graph")
    graph.add_edge("correlate_graph", "reputation_history")
    graph.add_edge("reputation_history", "build_evidence_pack")
    graph.add_conditional_edges(
        "build_evidence_pack", route_by_llm, {"llm": "narrate", "template": "template_narrate"}
    )
    graph.add_edge("narrate", "validate")
    graph.add_conditional_edges(
        "validate",
        route_by_validation,
        {"done": END, "repair": "narrate", "fallback": "template_narrate"},
    )
    graph.add_edge("template_narrate", END)
    return graph
