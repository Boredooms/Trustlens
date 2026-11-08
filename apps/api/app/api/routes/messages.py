"""Message analysis (MESSAGE_ANALYSIS.md, endpoint #72).

Deterministic extraction and findings (``services/message_analysis``), links assessed through the
normal scan pipeline (guard → collectors → rules), message decision policy (``decide_message``),
then narration. The raw text is never stored or logged.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.message_narrative import narrate
from app.api.deps import get_db, rate_limit, require_scope
from app.api.routes.scans import _validated_target
from app.errors import DomainError
from app.models.tables import (
    MessageAnalysis,
    Organisation,
    Scan,
    ThreatReport,
    VerifiedDomain,
    VerifiedRecipient,
)
from app.risk.classes import caveat, risk_class
from app.risk.codes import ENGINE_VERSION
from app.risk.engine import Finding, compute_coverage, decide_message
from app.risk.reasons import reasons as render_reasons
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import Decision, Intent
from app.schemas.messages import MessageAnalyseRequest, MessageAnalysisOut
from app.security.auth import Principal
from app.services import message_analysis as ma
from app.services.idempotency import idempotent
from app.services.scan_orchestrator import execute
from app.services.serialise import ts
from app.utils import new_ulid, utcnow

router = APIRouter(prefix="/api/v1/messages", tags=["messages"], responses=ERROR_RESPONSES)
MAX_LINKS = 3


async def load_profiles(db: AsyncSession, org_id: str | None) -> list[ma.BrandProfile]:
    stmt = select(Organisation).where(Organisation.status == "active")
    if org_id:
        stmt = stmt.where(Organisation.id == org_id)
    orgs = list((await db.execute(stmt)).scalars())
    profiles: list[ma.BrandProfile] = []
    now = utcnow()
    for org in orgs:
        domains = {
            d.domain
            for d in (
                await db.execute(
                    select(VerifiedDomain).where(
                        VerifiedDomain.organisation_id == org.id,
                        VerifiedDomain.status == "verified",
                    )
                )
            ).scalars()
            if d.expires_at is None or d.expires_at > now  # lapsed verifications vouch for nothing
        }
        if not domains:
            continue
        payees = {
            v.lower()
            for v in (
                await db.execute(
                    select(VerifiedRecipient.normalised_value).where(
                        VerifiedRecipient.organisation_id == org.id,
                        VerifiedRecipient.status == "verified",
                    )
                )
            ).scalars()
        }
        from app.services.guard import registrable_domain

        profiles.append(
            ma.BrandProfile(
                organisation_id=org.id,
                name=org.name,
                tokens=tuple(t for t in org.brand_tokens if len(t) >= 4),
                domains=frozenset(registrable_domain(d) for d in domains),
                payees=frozenset(payees),
                simulated=org.simulated,
            )
        )
    return profiles


async def _assess_link(
    request: Request, principal: Principal, url: str, registrable: str, intent: Intent
) -> ma.LinkResult:
    app = request.app
    try:
        target = await _validated_target(request, url)
    except DomainError as exc:  # SSRF policy / unresolvable: recorded, never a verdict
        return ma.LinkResult(url, registrable, None, None, error=str(exc.code))
    async with app.state.session_factory() as db:
        scan = Scan(
            id=new_ulid(),
            user_id=principal.user.id,
            url=url,
            normalised_url=target.normalised_url,
            registrable_domain=target.registrable_domain,
            intent=intent.value,
        )
        db.add(scan)
        await db.commit()
    async with app.state.scan_semaphore:
        outcome = await execute(
            app.state.session_factory, app.state.settings, app.state.http, scan.id
        )
    if outcome is None:
        return ma.LinkResult(url, registrable, scan.id, None, error="SCAN_FAILED")
    return ma.LinkResult(
        url=url,
        registrable_domain=outcome.scan.registrable_domain,
        scan_id=outcome.scan.id,
        decision=outcome.scan.decision,
        finding_codes=tuple(sorted({f.code for f in outcome.findings})),
        simulated=outcome.scan.simulated,
    )


def _finding_wire(f: Finding) -> dict[str, Any]:
    return {
        "code": f.code,
        "signal_group": f.group.value,
        "severity": f.severity.value,
        "confidence": float(f.confidence),
        "title": f.rule.title,
        "detail": f.detail,
        "rule_id": f.rule.rule_id,
        "observed": dict(f.observed) if f.observed else None,
        "expected": dict(f.expected) if f.expected else None,
        "simulated": f.simulated,
    }


@router.post("/analyse", response_model=MessageAnalysisOut, summary="Analyse a pasted message")
async def analyse_message(
    body: MessageAnalyseRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_scope("assess:read")),
    _: None = Depends(rate_limit("messages")),
) -> Any:
    async def run() -> dict[str, Any]:
        settings = request.app.state.settings
        profiles = await load_profiles(db, body.organisation_id)
        ex = ma.extract(body.text)
        link_intent = (
            Intent.PAYMENT
            if ex.payment or ex.payees
            else Intent.LOGIN
            if ex.credential
            else Intent.BROWSE
        )
        links = list(
            await asyncio.gather(
                *(
                    _assess_link(request, principal, url, dom, link_intent)
                    for url, dom in ex.urls[:MAX_LINKS]
                )
            )
        )
        counts: dict[str, int] = {}
        for p in ex.payees:
            counts[p.value] = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(ThreatReport)
                        .where(
                            func.lower(ThreatReport.observed_payee) == p.value.lower(),
                            ThreatReport.status == "confirmed",
                        )
                    )
                ).scalar_one()
            )
        simulated = any(link.simulated for link in links)
        ev = ma.evaluate(ex, profiles, links, counts, simulated=simulated)
        coverage = compute_coverage(ev.coverage)
        verdict = decide_message(ev.findings, coverage, ev.intent)
        claimed = ev.claimed
        reason_ctx = {"org": claimed.name if claimed else None}
        reasons = render_reasons(ev.findings, reason_ctx)

        text_hash = ma.normalised_hash(body.text)
        link_domains = sorted({link.registrable_domain for link in links})
        same = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(MessageAnalysis)
                    .where(MessageAnalysis.text_sha256 == text_hash)
                )
            ).scalar_one()
        )
        shared = []
        for dom in link_domains:
            n = int(
                (
                    await db.execute(
                        select(func.count())
                        .select_from(MessageAnalysis)
                        .where(MessageAnalysis.link_domains.contains([dom]))
                    )
                ).scalar_one()
            )
            if n:
                shared.append({"domain": dom, "earlier_analyses": n})

        simulated = simulated or bool(claimed and claimed.simulated)
        row = MessageAnalysis(
            id=new_ulid(),
            user_id=principal.user.id,
            api_key_id=principal.key_id,
            channel=body.channel,
            text_sha256=text_hash,
            char_count=len(body.text),
            decision=verdict.decision.value,
            risk_score=verdict.risk_score,
            finding_codes=sorted({f.code for f in ev.findings}),
            link_domains=link_domains,
            link_scan_ids=[link.scan_id for link in links if link.scan_id],
            engine_version=ENGINE_VERSION,
            simulated=simulated,
        )
        db.add(row)
        await db.commit()

        sender_domain = ex.sender.split("@", 1)[1] if ex.sender else None
        out: dict[str, Any] = {
            "id": row.id,
            "decision": verdict.decision.value,
            "risk_level": verdict.risk_level.value,
            "risk_score": verdict.risk_score,
            "risk_class": risk_class(verdict.decision),
            "caveat": caveat(verdict.decision),
            "coverage": coverage.as_dict(),
            "overrides": list(verdict.overrides),
            "reasons": reasons,
            "claimed_organisation": (
                {
                    "id": claimed.organisation_id,
                    "name": claimed.name,
                    "verified_domains": sorted(claimed.domains),
                }
                if claimed
                else None
            ),
            "indicators": {
                "urls": [u for u, _ in ex.urls],
                "emails": [ma.mask(e) for e in ex.emails],
                "sender_domain": sender_domain,
                "phones": ex.phones,
                "payees": [{"type": p.type, "value": p.value} for p in ex.payees],
            },
            "findings": [_finding_wire(f) for f in ev.findings],
            "links": [
                {
                    "url": link.url,
                    "registrable_domain": link.registrable_domain,
                    "scan_id": link.scan_id,
                    "decision": link.decision,
                    "finding_codes": list(link.finding_codes),
                    "error": link.error,
                    "simulated": link.simulated,
                }
                for link in links
            ],
            "correlation": {"same_text_count": same, "shared_link_domains": shared},
            "channel": body.channel,
            "engine_version": ENGINE_VERSION,
            "simulated": simulated,
            "analysed_at": ts(row.created_at or utcnow()),
        }
        out["narrative"] = await narrate(out, settings)
        assert out["decision"] in {d.value for d in Decision}  # noqa: S101 — invariant
        return out

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 200, run
    )
