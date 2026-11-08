"""Investigations (API_ENDPOINTS.md §14). Rules decide; the narrative only explains."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, rate_limit, require_scope
from app.api.routes.scans import load_scan
from app.errors import NotFound
from app.models.tables import Investigation, Scan
from app.schemas.common import ERROR_RESPONSES
from app.schemas.resources import InvestigationAccepted, InvestigationCreate, InvestigationOut
from app.security.auth import Principal
from app.services.investigations import schedule_investigation
from app.services.serialise import ts
from app.utils import is_ulid, new_ulid

router = APIRouter(
    prefix="/api/v1/investigations", tags=["investigations"], responses=ERROR_RESPONSES
)


@router.post(
    "", status_code=202, response_model=InvestigationAccepted, summary="Start an investigation"
)
async def create(
    body: InvestigationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("investigations:write")),
    _: None = Depends(rate_limit("investigations")),
) -> Any:
    scan = await load_scan(db, body.scan_id, principal)
    active = (
        (
            await db.execute(
                select(Investigation).where(
                    Investigation.scan_id == scan.id,
                    Investigation.status.in_(("queued", "running")),
                )
            )
        )
        .scalars()
        .first()
    )
    if active is not None:
        return {"id": active.id, "status": active.status, "poll_after_ms": 1000}
    inv = Investigation(
        id=new_ulid(),
        scan_id=scan.id,
        user_id=principal.user.id,
        organisation_id=scan.organisation_id,
        status="queued",
    )
    db.add(inv)
    await db.commit()
    schedule_investigation(request.app, inv.id)
    return {"id": inv.id, "status": "queued", "poll_after_ms": 1000}


async def _load(
    db: AsyncSession, investigation_id: str, principal: Principal
) -> tuple[Investigation, Scan]:
    inv = await db.get(Investigation, investigation_id) if is_ulid(investigation_id) else None
    if inv is None:
        raise NotFound()
    scan = await load_scan(db, inv.scan_id, principal)
    return inv, scan


def _wire(inv: Investigation, scan: Scan) -> dict[str, Any]:
    ai = inv.ai_meta or {}
    return {
        "id": inv.id,
        "scan_id": inv.scan_id,
        "status": inv.status,
        # Read straight from the scan row: the investigation cannot have changed it.
        "decision_context": {
            "decision": scan.decision,
            "risk_level": scan.risk_level,
            "risk_score": scan.risk_score,
        },
        "steps": inv.steps,
        "narrative": inv.narrative,
        "references": inv.references,
        "dropped_claims": inv.dropped_claims,
        "ai": {
            "generated": bool(ai.get("generated")),
            "model": ai.get("model"),
            "prompt_version": ai.get("prompt_version", "inv-1.0"),
            "tokens_in": ai.get("tokens_in"),
            "tokens_out": ai.get("tokens_out"),
            "latency_ms": ai.get("latency_ms"),
            "fallback_reason": ai.get("fallback_reason"),
        },
        "simulated": scan.simulated,
        "created_at": ts(inv.created_at),
        "completed_at": ts(inv.completed_at),
    }


@router.get(
    "/{investigation_id}",
    response_model=InvestigationOut,
    summary="Investigation status and narrative",
)
async def get(
    investigation_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("investigations:read")),
) -> Any:
    inv, scan = await _load(db, investigation_id, principal)
    return _wire(inv, scan)


@router.get(
    "/{investigation_id}/export", response_class=PlainTextResponse, summary="Export as Markdown"
)
async def export(
    investigation_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("investigations:read")),
) -> PlainTextResponse:
    inv, scan = await _load(db, investigation_id, principal)
    w = _wire(inv, scan)
    refs = {r["id"]: r for r in w["references"]}
    used: list[str] = []
    lines = [
        f"# Investigation {inv.id}",
        "",
        f"**Decision (by rules, not by AI):** {scan.decision} · {scan.risk_level} · "
        f"{scan.risk_score}/100 · "
        f"coverage {(scan.coverage or {}).get('percent')}%",
        f"**URL:** {scan.url}",
        "**Narrative:** "
        + (
            "AI-written (" + str(w["ai"]["model"]) + ")"
            if w["ai"]["generated"]
            else "Generated from findings (template) — no AI used"
        ),
        "",
    ]
    if scan.simulated:
        lines.insert(2, "> **Simulated** — demonstration data, not a real incident.\n")
    for section in (inv.narrative or {}).get("sections", []):
        lines += [f"## {section['heading']}", ""]
        for claim in section["claims"]:
            marks = []
            for ref in claim["refs"]:
                if ref not in used:
                    used.append(ref)
                marks.append(f"[^{ref}]")
            lines.append(f"- {claim['text']} {''.join(marks)}")
        lines.append("")
    lines += [f"[^{r}]: {refs[r]['kind']} — {refs[r]['label']}" for r in used if r in refs]
    filename = f"investigation-{inv.id}{'-simulated' if scan.simulated else ''}.md"
    return PlainTextResponse(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
