"""Relational threat graph: idempotent upserts and depth-capped traversal (THREAT_GRAPH.md §4–§9).

Edges: ``new = max(old, base)`` confidence, ``observed_count += 1`` on re-observation, never lowered
except by decay. ``SHARES_*`` edges are symmetric and stored once with canonical (id) ordering.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Entity, Relationship
from app.utils import new_ulid, utcnow

BASE_CONFIDENCE: dict[str, Decimal] = {
    "RESOLVES_TO": Decimal("1.0"),
    "MANAGED_BY": Decimal("1.0"),
    "MAIL_ROUTED_BY": Decimal("0.9"),
    "PRESENTS": Decimal("1.0"),
    "ISSUED_BY": Decimal("1.0"),
    "CHAINS_TO_ROOT": Decimal("1.0"),
    "HOSTS": Decimal("0.9"),
    "REDIRECTS_TO": Decimal("1.0"),
    "SUBMITS_TO": Decimal("0.85"),
    "REQUESTS_PAYMENT_TO": Decimal("0.9"),
    "REPORTED_AS": Decimal("1.0"),
    "SHARES_NAMESERVER_WITH": Decimal("0.35"),
    "SHARES_CA_WITH": Decimal("0.20"),
    "SHARES_HOSTING_WITH": Decimal("0.15"),
    "SHARES_PAYEE_WITH": Decimal("0.30"),
    "SHARES_DOM_FINGERPRINT": Decimal("0.25"),
}
SYMMETRIC = {t for t in BASE_CONFIDENCE if t.startswith("SHARES_")}
EDGE_TYPES = frozenset(BASE_CONFIDENCE) | {"IMPERSONATES", "MEMBER_OF_CAMPAIGN"}


@dataclass(frozen=True)
class EntityRow:
    type: str
    key: str
    label: str
    attributes: dict[str, Any] = field(default_factory=dict)
    simulated: bool = False


@dataclass(frozen=True)
class EdgeRow:
    source_id: str
    target_id: str
    type: str
    confidence: Decimal | None = None
    evidence_ids: Sequence[str] = ()


async def upsert_entities(
    db: AsyncSession, rows: Sequence[EntityRow], *, seen_at: datetime | None = None
) -> dict[str, str]:
    """Upsert many entities in ONE statement; returns ``key -> id``.

    One statement instead of one per node matters on a remote pooler, where every statement costs
    several network round trips. Rows sharing a key are merged first: Postgres refuses an
    ``ON CONFLICT DO UPDATE`` that touches the same row twice in one statement.
    """
    merged: dict[tuple[str, str], EntityRow] = {}
    for row in rows:
        prev = merged.get((row.type, row.key))
        if prev is not None:
            row = EntityRow(
                row.type, row.key, prev.label, {**prev.attributes, **row.attributes}, prev.simulated
            )
        merged[(row.type, row.key)] = row
    if not merged:
        return {}
    now = seen_at or utcnow()
    excluded = insert(Entity).excluded
    stmt = (
        insert(Entity)
        .values(
            [
                {
                    "id": new_ulid(),
                    "type": r.type,
                    "key": r.key,
                    "label": r.label,
                    "attributes": r.attributes,
                    "simulated": r.simulated,
                    "first_seen_at": now,
                    "last_seen_at": now,
                }
                for r in merged.values()
            ]
        )
        .on_conflict_do_update(
            index_elements=["type", "key"],
            set_={
                "last_seen_at": now,
                "attributes": Entity.attributes.op("||")(excluded.attributes),
                "updated_at": func.now(),
            },
        )
        .returning(Entity.key, Entity.id)
    )
    return {str(k): str(i) for k, i in (await db.execute(stmt)).all()}


async def upsert_entity(
    db: AsyncSession,
    type_: str,
    key: str,
    label: str,
    attributes: dict[str, Any] | None = None,
    *,
    simulated: bool = False,
    seen_at: datetime | None = None,
) -> str:
    ids = await upsert_entities(
        db, [EntityRow(type_, key, label, attributes or {}, simulated)], seen_at=seen_at
    )
    return ids[key]


async def upsert_edges(db: AsyncSession, edges: Sequence[EdgeRow]) -> None:
    """Upsert many edges in ONE statement (same merge rule as :func:`upsert_entities`)."""
    merged: dict[tuple[str, str, str], tuple[Decimal, list[str]]] = {}
    for e in edges:
        if e.type not in EDGE_TYPES:
            raise ValueError(f"unknown edge type {e.type!r} (THREAT_GRAPH.md §4)")
        source, target = e.source_id, e.target_id
        if source == target:
            continue
        if e.type in SYMMETRIC and source > target:
            source, target = target, source
        conf = e.confidence if e.confidence is not None else BASE_CONFIDENCE[e.type]
        prev = merged.get((source, target, e.type))
        if prev is not None:
            conf = max(conf, prev[0])
            evidence = prev[1] + [i for i in e.evidence_ids if i not in prev[1]]
        else:
            evidence = list(e.evidence_ids)
        merged[(source, target, e.type)] = (conf, evidence)
    if not merged:
        return
    now = utcnow()
    excluded = insert(Relationship).excluded
    stmt = (
        insert(Relationship)
        .values(
            [
                {
                    "id": new_ulid(),
                    "source_entity_id": source,
                    "target_entity_id": target,
                    "type": type_,
                    "confidence": conf,
                    "evidence_ids": evidence,
                    "first_seen_at": now,
                    "last_seen_at": now,
                }
                for (source, target, type_), (conf, evidence) in merged.items()
            ]
        )
        .on_conflict_do_update(
            constraint="rel_unique",
            set_={
                "confidence": func.greatest(Relationship.confidence, excluded.confidence),
                "observed_count": Relationship.observed_count + 1,
                "last_seen_at": now,
                "evidence_ids": Relationship.evidence_ids + excluded.evidence_ids,
                "updated_at": func.now(),
            },
        )
    )
    await db.execute(stmt)


async def upsert_edge(
    db: AsyncSession,
    source_id: str,
    target_id: str,
    type_: str,
    *,
    confidence: Decimal | None = None,
    evidence_ids: Sequence[str] = (),
) -> None:
    await upsert_edges(db, [EdgeRow(source_id, target_id, type_, confidence, evidence_ids)])


async def entity_by_key(db: AsyncSession, type_: str, key: str) -> Entity | None:
    return (
        await db.execute(select(Entity).where(Entity.type == type_, Entity.key == key))
    ).scalar_one_or_none()


_WALK = text(
    """
    WITH RECURSIVE walk(id, depth) AS (
      SELECT CAST(:root AS CHAR(26)), 0
      UNION
      SELECT CASE WHEN r.source_entity_id = w.id
                  THEN r.target_entity_id ELSE r.source_entity_id END,
             w.depth + 1
      FROM walk w
      JOIN relationships r ON (r.source_entity_id = w.id OR r.target_entity_id = w.id)
      WHERE w.depth < :depth AND r.confidence >= :min_conf
    )
    SELECT id, MIN(depth) AS depth FROM walk GROUP BY id ORDER BY MIN(depth) LIMIT :cap
    """
)


async def neighbourhood(
    db: AsyncSession, root_id: str, *, depth: int, min_confidence: float, cap: int, timeout_ms: int
) -> tuple[list[Entity], list[Relationship], bool]:
    """Depth-capped walk in both directions (symmetric edges are stored once)."""
    await db.execute(text(f"SET LOCAL statement_timeout = {int(timeout_ms)}"))
    rows = (
        await db.execute(
            _WALK, {"root": root_id, "depth": depth, "min_conf": min_confidence, "cap": cap + 1}
        )
    ).all()
    truncated = len(rows) > cap
    ids = [r.id for r in rows[:cap]]
    entities = list((await db.execute(select(Entity).where(Entity.id.in_(ids)))).scalars())
    edges = list(
        (
            await db.execute(
                select(Relationship).where(
                    Relationship.source_entity_id.in_(ids),
                    Relationship.target_entity_id.in_(ids),
                    Relationship.confidence >= min_confidence,
                )
            )
        ).scalars()
    )
    return entities, edges, truncated
