"""Operator demo controls (UI_UX_SPECIFICATIONS.md §15 "Demo" tab, DEMO_RUNBOOK.md §10).

``GET /admin/demo`` reports the seeded dataset; ``POST /admin/demo/reset`` runs the same reset +
seed as the CLI, in-process. Resets are serialised with a transaction-scoped Postgres advisory lock
(safe through a transaction pooler: the open transaction pins one backend) so two operators cannot
interleave a reset.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_operator
from app.errors import Conflict, DemoModeRequired
from app.logging import get_logger
from app.models.tables import (
    Campaign,
    CertificateIncident,
    Investigation,
    Organisation,
    Scan,
    ThreatReport,
)
from app.schemas.common import ERROR_RESPONSES
from app.schemas.platform import DemoStatus
from app.security.auth import Principal
from app.services import audit
from app.services.idempotency import idempotent
from app.utils import iso_z

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], responses=ERROR_RESPONSES)
log = get_logger("admin")

# Arbitrary, stable 63-bit key for pg_try_advisory_xact_lock ("TLDEMO").
DEMO_RESET_LOCK_KEY = 0x544C44454D4F


async def demo_status(db: AsyncSession, request: Request) -> dict[str, Any]:
    from app.scripts.seed_demo import ORG_NAME

    settings = request.app.state.settings
    org = (
        await db.execute(
            select(Organisation.id, Organisation.name).where(
                Organisation.name == ORG_NAME, Organisation.simulated.is_(True)
            )
        )
    ).first()

    async def count(model: Any, *where: Any) -> int:
        stmt = select(func.count()).select_from(model).where(*where)
        return int((await db.execute(stmt)).scalar_one())

    last_seeded = (
        await db.execute(select(func.min(Scan.created_at)).where(Scan.simulated.is_(True)))
    ).scalar_one()
    return {
        "demo_mode": bool(settings.demo_mode),
        "organisation": {"id": org.id, "name": org.name} if org else None,
        "counts": {
            "scans": await count(Scan),
            "reports": await count(ThreatReport),
            "campaigns": await count(Campaign),
            "investigations": await count(Investigation),
            "incidents": await count(CertificateIncident),
        },
        "last_seeded_at": iso_z(last_seeded) if last_seeded else None,
    }


@router.get("/demo", response_model=DemoStatus, summary="Demo dataset status (operator)")
async def get_demo(
    request: Request,
    principal: Principal = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> Any:
    return await demo_status(db, request)


@router.post(
    "/demo/reset", response_model=DemoStatus, summary="Reset and re-seed demo data (operator)"
)
async def reset_demo(
    request: Request,
    response: Response,
    principal: Principal = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> Any:
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise DemoModeRequired()
    if settings.is_production and not settings.allow_demo_seed:
        raise DemoModeRequired(
            "Demo resets are disabled in production unless ALLOW_DEMO_SEED is set."
        )

    async def run() -> dict[str, Any]:
        from app.scripts.seed_demo import reset, seed

        factory = request.app.state.session_factory
        async with factory() as lock_db, lock_db.begin():
            got = (
                await lock_db.execute(
                    text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": DEMO_RESET_LOCK_KEY}
                )
            ).scalar_one()
            if not got:
                raise Conflict("A demo reset is already running. Try again in a minute.")
            # The lock is held until this transaction ends, i.e. for the whole reset + seed.
            await reset(factory, settings)
            await seed(factory, settings)
        status = await demo_status(db, request)
        audit.record(
            db,
            action="demo.reset",
            principal=principal,
            target_type="demo",
            after=status["counts"],
            request=request,
        )
        await db.commit()
        log.info("demo.reset", extra={"by": principal.user.id})
        return status

    return await idempotent(request, response, db, principal, {}, 200, run)
