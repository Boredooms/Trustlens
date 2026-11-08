"""On-chain integrity anchors for threat reports (WEB3_REGISTRY.md §5, endpoints #68–#71).

Anchoring is post-hoc: nothing here is on the verdict path, and every failure of the chain is a
``503 CHAIN_UNAVAILABLE`` for these routes only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, rate_limit
from app.api.routes.reports import ReportNotFound
from app.config import Settings
from app.models.tables import AuditLog, ThreatReport
from app.schemas.common import ERROR_RESPONSES
from app.schemas.web3 import AnchorOut, AnchorVerification, VerifyPayloadRequest
from app.security.auth import Principal
from app.services import anchors
from app.services.chain import ChainClient
from app.utils import is_ulid, new_ulid

router = APIRouter(tags=["web3"], responses=ERROR_RESPONSES)


def _client(request: Request) -> ChainClient:
    factory = getattr(request.app.state, "chain_client_factory", None)
    settings: Settings = request.app.state.settings
    return factory(settings) if factory else ChainClient(settings)


async def _own_report(db: AsyncSession, report_id: str, principal: Principal) -> ThreatReport:
    r = await db.get(ThreatReport, report_id) if is_ulid(report_id) else None
    if r is None or (not principal.is_analyst and r.reporter_user_id != principal.user.id):
        raise ReportNotFound()
    return r


@router.post(
    "/api/v1/reports/{report_id}/anchor",
    response_model=AnchorOut,
    status_code=201,
    summary="Anchor a report's commitment on chain",
)
async def anchor_report(
    report_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Any:
    report = await _own_report(db, report_id, principal)
    settings: Settings = request.app.state.settings
    outcome = await anchors.anchor_report(db, settings, report, principal.user.id, _client(request))
    if outcome.created:
        db.add(
            AuditLog(
                id=new_ulid(),
                actor_user_id=principal.user.id,
                actor_kind=principal.actor_kind,
                action="report.anchor",
                target_type="threat_report",
                target_id=report.id,
                after={
                    "revision": outcome.anchor.revision,
                    "tx_hash": outcome.anchor.tx_hash,
                    "chain_id": outcome.anchor.chain_id,
                },
            )
        )
        await db.commit()
    else:
        response.status_code = 200
    return {**anchors.anchor_view(outcome.anchor, report.id), "created": outcome.created}


@router.get(
    "/api/v1/reports/{report_id}/anchor", response_model=AnchorOut, summary="Anchor of a report"
)
async def get_anchor(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Any:
    report = await _own_report(db, report_id, principal)
    return anchors.anchor_view(await anchors.get_anchor(db, report.id), report.id)


@router.get(
    "/api/v1/public/verify/{report_id}",
    response_model=AnchorVerification,
    summary="Publicly verify an anchored report (no sign-in)",
)
async def public_verify(
    report_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit("public_verify")),
) -> Any:
    if not is_ulid(report_id):
        raise anchors.AnchorNotFound()
    response.headers["Cache-Control"] = "no-store"
    return await anchors.verify_anchor(db, request.app.state.settings, report_id, _client(request))


@router.post(
    "/api/v1/public/verify/{report_id}",
    response_model=AnchorVerification,
    summary="Verify a caller-supplied payload against the anchored commitment (no sign-in)",
)
async def public_verify_payload(
    report_id: str,
    body: VerifyPayloadRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit("public_verify")),
) -> Any:
    if not is_ulid(report_id):
        raise anchors.AnchorNotFound()
    response.headers["Cache-Control"] = "no-store"
    return await anchors.verify_anchor(
        db, request.app.state.settings, report_id, _client(request), supplied=body.payload
    )
