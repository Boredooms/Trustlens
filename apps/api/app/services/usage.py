"""Usage metering (FEATURE_SPECIFICATIONS.md TL-024, DATABASE_DESIGN.md §7.3, §13.2).

Counters are per actor (user, API key or extension device) per UTC day per endpoint group. They are
written only with ``INSERT … ON CONFLICT DO UPDATE`` (no read-modify-write, so concurrent increments
never lose counts) and off the request path: the response is never delayed or failed by metering.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.logging import get_logger
from app.models.tables import UsageCounter
from app.utils import new_ulid

log = get_logger("usage")

# Groups that are metered; the names are the rate-limit groups (deps.LIMITS) plus read groups.
METERED_GROUPS = frozenset(
    {"scans", "assess", "verify", "inspect", "reports", "investigations", "appeals"}
)


async def record_usage(
    factory: async_sessionmaker[AsyncSession], actor_id: str, actor_kind: str, group: str
) -> None:
    """Increment one counter. Never raises (best-effort accounting)."""
    day = datetime.now(UTC).date()
    stmt = insert(UsageCounter).values(
        id=new_ulid(),
        actor_id=actor_id,
        actor_kind=actor_kind,
        day=day,
        endpoint_group=group,
        count=1,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["actor_id", "actor_kind", "day", "endpoint_group"],
        set_={"count": UsageCounter.count + 1},
    )
    try:
        async with factory() as db:
            await db.execute(stmt)
            await db.commit()
    except Exception as exc:  # noqa: BLE001 — metering must never break a request
        log.warning("usage.record_failed", extra={"group": group, "exc_type": type(exc).__name__})
