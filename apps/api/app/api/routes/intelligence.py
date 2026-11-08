"""Graph, entities, campaigns (API_ENDPOINTS.md §12)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_human
from app.errors import DomainError
from app.intelligence.graph import neighbourhood
from app.models.tables import Campaign, Entity, Relationship
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.resources import CampaignList, CampaignOut, EntityDetail, EntityList, GraphOut
from app.security.auth import Principal
from app.services.serialise import node, ts
from app.utils import is_ulid

router = APIRouter(prefix="/api/v1", tags=["intelligence"], responses=ERROR_RESPONSES)


class EntityNotFound(DomainError):
    code, status, message = ErrorCode.ENTITY_NOT_FOUND, 404, "We could not find that entity."


class GraphDepthExceeded(DomainError):
    code, status, message = ErrorCode.GRAPH_DEPTH_EXCEEDED, 422, "Graph depth is limited to 3."


class GraphQueryTimeout(DomainError):
    code, status, message = (
        ErrorCode.GRAPH_QUERY_TIMEOUT,
        422,
        "The graph query took too long. Reduce depth or filters.",
    )


@router.get(
    "/intelligence/graph/{entity_id}", response_model=GraphOut, summary="Neighbourhood graph"
)
async def graph(
    entity_id: str,
    request: Request,
    response: Response,
    depth: int = Query(2, ge=1),
    min_confidence: float = Query(0.5, ge=0, le=1),
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    settings = request.app.state.settings
    if depth > settings.graph_max_depth:
        raise GraphDepthExceeded()
    root = await db.get(Entity, entity_id) if is_ulid(entity_id) else None
    if root is None:
        raise EntityNotFound()
    try:
        entities, edges, truncated = await neighbourhood(
            db,
            root.id,
            depth=depth,
            min_confidence=min_confidence,
            cap=min(limit, settings.graph_max_nodes),
            timeout_ms=settings.graph_statement_timeout_ms,
        )
    except DBAPIError as exc:
        if "statement timeout" in str(exc.orig).lower():
            raise GraphQueryTimeout() from None
        raise
    response.headers["Cache-Control"] = "private, max-age=120"
    return {
        "root": root.id,
        "nodes": [node(e) for e in entities],
        "edges": [
            {
                "id": r.id,
                "source": r.source_entity_id,
                "target": r.target_entity_id,
                "type": r.type,
                "confidence": float(r.confidence),
                "evidence_refs": list(r.evidence_ids),
                "observed_count": r.observed_count,
            }
            for r in edges
        ],
        "truncated": truncated,
        "counts": {"nodes": len(entities), "edges": len(edges)},
    }


@router.get("/intelligence/entities", response_model=EntityList, summary="Search entities")
async def entities(
    q: str | None = Query(None, min_length=2, max_length=200),
    type: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    stmt = select(Entity).order_by(Entity.id.desc()).limit(limit + 1)
    if q:
        stmt = stmt.where(Entity.key.ilike(f"%{q}%"))
    if type:
        stmt = stmt.where(Entity.type == type)
    if cursor and is_ulid(cursor):
        stmt = stmt.where(Entity.id < cursor)
    rows = list((await db.execute(stmt)).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "data": [node(e) for e in rows],
        "page": {"limit": limit, "next_cursor": rows[-1].id if more else None},
    }


@router.get(
    "/intelligence/entities/{entity_id}", response_model=EntityDetail, summary="Entity detail"
)
async def entity(
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    e = await db.get(Entity, entity_id) if is_ulid(entity_id) else None
    if e is None:
        raise EntityNotFound()
    counts: dict[str, int] = dict(
        (
            await db.execute(
                select(Relationship.type, func.count())
                .where(
                    (Relationship.source_entity_id == e.id)
                    | (Relationship.target_entity_id == e.id)
                )
                .group_by(Relationship.type)
            )
        )
        .tuples()
        .all()
    )
    return {
        **node(e),
        "first_seen_at": ts(e.first_seen_at),
        "last_seen_at": ts(e.last_seen_at),
        "edge_counts": counts,
    }


def _campaign(c: Campaign) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "confidence": float(c.confidence),
        "member_count": c.member_count,
        "simulated": c.simulated,
        "first_seen_at": ts(c.first_seen_at),
        "last_seen_at": ts(c.last_seen_at),
    }


@router.get("/campaigns", response_model=CampaignList, summary="Campaigns")
async def list_campaigns(
    response: Response,
    min_confidence: float = Query(0, ge=0, le=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    rows = (
        await db.execute(
            select(Campaign)
            .where(Campaign.confidence >= min_confidence)
            .order_by(Campaign.confidence.desc())
            .limit(limit)
        )
    ).scalars()
    response.headers["Cache-Control"] = "private, max-age=120"
    return {"data": [_campaign(c) for c in rows], "page": {"limit": limit, "next_cursor": None}}


@router.get("/campaigns/{campaign_id}", response_model=CampaignOut, summary="Campaign detail")
async def get_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_human),
) -> Any:
    c = await db.get(Campaign, campaign_id) if is_ulid(campaign_id) else None
    if c is None:
        raise EntityNotFound()
    ent = (
        await db.execute(select(Entity).where(Entity.key == f"campaign:{c.id}"))
    ).scalar_one_or_none()
    members: list[Entity] = []
    if ent is not None:
        members = list(
            (
                await db.execute(
                    select(Entity)
                    .join(Relationship, Relationship.source_entity_id == Entity.id)
                    .where(
                        Relationship.target_entity_id == ent.id,
                        Relationship.type == "MEMBER_OF_CAMPAIGN",
                    )
                )
            ).scalars()
        )
    indicators = (ent.attributes.get("indicators") if ent else None) or []
    return {
        **_campaign(c),
        "summary": c.summary,
        "entity_id": ent.id if ent else None,
        "members": [node(m) for m in sorted(members, key=lambda m: m.label)],
        "shared_indicators": indicators,
        "confidence_basis": "Confidence is the weaker of the two strongest shared indicators "
        "(THREAT_GRAPH.md §6.3); indicator strength = feature reliability × share of members.",
    }
