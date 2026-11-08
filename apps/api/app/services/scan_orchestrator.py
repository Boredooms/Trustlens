"""Scan execution (BACKEND_OVERVIEW.md §9.1, DATA_FLOW.md assessment flow).

Network I/O never happens inside an open transaction: collection runs first, then the context read,
then one short write transaction for verdict + findings + evidence + graph.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.errors import DomainError
from app.intelligence.graph import EdgeRow, EntityRow, upsert_edges, upsert_entities
from app.logging import get_logger
from app.models.tables import Evidence, Scan, ScanFinding
from app.risk.codes import ENGINE_VERSION
from app.risk.engine import Finding, Verdict, compute_coverage, decide
from app.risk.reasons import reasons as render_reasons
from app.risk.rules import Evaluation, TrustContext, evaluate, normalise_payee
from app.schemas.enums import Intent
from app.security.redaction import redact
from app.services import guard
from app.services.collectors import collect
from app.services.context import build_context
from app.services.observations import ClientObservation, Observations
from app.utils import new_ulid, utcnow

log = get_logger("scan")


@dataclass
class ScanOutcome:
    scan: Scan
    verdict: Verdict
    evaluation: Evaluation
    context: TrustContext
    findings: list[ScanFinding]
    evidence: list[Evidence]


def _hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def finding_to_wire(row: ScanFinding) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "signal_group": row.signal_group,
        "severity": row.severity,
        "confidence": float(row.confidence),
        "title": row.title,
        "detail": row.detail,
        "observed": row.observed,
        "expected": row.expected,
        "evidence_refs": list(row.evidence_ids),
        "rule_id": row.rule_id,
        "simulated": row.simulated,
    }


async def execute(
    db_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    http: httpx.AsyncClient,
    scan_id: str,
    *,
    client: ClientObservation | None = None,
) -> ScanOutcome | None:
    started = time.perf_counter()
    async with db_factory() as db:
        scan = await db.get(Scan, scan_id)
        if scan is None:
            return None
        scan.status = "running"
        await db.commit()
        target_url, intent, org_id = scan.normalised_url, Intent(scan.intent), scan.organisation_id
        deep = scan.deep

    status = "completed"
    try:
        target = guard.parse_target(target_url)
        from app.services.demo_fixtures import is_demo_host

        demo = settings.demo_mode and is_demo_host(target.host, target.registrable_domain)
        target = await guard.check_target(
            target_url, dns_timeout=settings.dns_timeout_seconds, is_demo_host=demo
        )
        async with asyncio.timeout(settings.scan_budget_seconds):
            obs = await collect(target, settings, http, deep=deep)
    except TimeoutError:
        status = "partial"
        obs = None
    except Exception as exc:  # noqa: BLE001 — a task always writes a terminal status
        log.exception("scan.collect_failed", extra={"scan_id": scan_id})
        async with db_factory() as db:
            await db.execute(
                update(Scan)
                .where(Scan.id == scan_id)
                .values(status="failed", failure_code=type(exc).__name__, completed_at=utcnow())
            )
            await db.commit()
        return None

    if obs is None:
        target = guard.parse_target(target_url)
        from app.services.observations import DnsObs, PageObs, RedirectObs, RegistrationObs, TlsObs

        obs = Observations(
            host=target.host,
            registrable_domain=target.registrable_domain,
            normalised_url=target.normalised_url,
            scheme=target.scheme,
            dns=DnsObs(status="unavailable"),
            registration=RegistrationObs(status="unavailable"),
            tls=TlsObs(status="unavailable"),
            redirects=RedirectObs(status="unavailable"),
            page=PageObs(status="unavailable"),
        )

    async with db_factory() as db:
        ctx = await build_context(db, obs, settings, organisation_id=org_id, client=client)
        evaluation = evaluate(obs, ctx, intent, client)
        coverage = compute_coverage(evaluation.coverage)
        verdict = decide(
            evaluation.findings, coverage, intent, target_unreachable=evaluation.target_unreachable
        )
        reason_ctx = {
            "org": ctx.claimed_org.name if ctx.claimed_org else None,
            "domain": obs.host,
            "brand": ctx.claimed_org.name if ctx.claimed_org else None,
        }
        reasons = render_reasons(evaluation.findings, reason_ctx)

        scan = await db.get(Scan, scan_id)
        if scan is None:
            raise LookupError(f"scan {scan_id} disappeared during execution")
        evidence_rows, key_to_id = await _persist_evidence(db, scan_id, obs, client)
        finding_rows = _finding_rows(scan_id, evaluation.findings, key_to_id)
        db.add_all(finding_rows)

        scan.status = status
        scan.organisation_id = scan.organisation_id or (
            ctx.claimed_org.id if ctx.claimed_org else None
        )
        scan.registrable_domain = obs.registrable_domain
        scan.decision = verdict.decision.value
        scan.risk_level = verdict.risk_level.value
        scan.risk_score = verdict.risk_score
        scan.coverage = coverage.as_dict()
        scan.reasons = reasons
        scan.overrides = list(verdict.overrides)
        scan.result = {
            **obs.result_blocks(),
            "action": _action_block(evaluation, ctx, intent),
            "engine_version": ENGINE_VERSION,
        }
        scan.engine_version = ENGINE_VERSION
        scan.simulated = obs.simulated
        scan.duration_ms = round((time.perf_counter() - started) * 1000)
        scan.completed_at = utcnow()

        await write_graph(db, obs, scan, ctx, client, key_to_id)
        await db.commit()
        log.info(
            "scan.completed",
            extra={
                "scan_id": scan_id,
                "domain": obs.registrable_domain,
                "decision": scan.decision,
                "risk_score": scan.risk_score,
                "coverage_pct": coverage.percent,
                "duration_ms": scan.duration_ms,
            },
        )
        return ScanOutcome(scan, verdict, evaluation, ctx, finding_rows, evidence_rows)


def _action_block(evaluation: Evaluation, ctx: TrustContext, intent: Intent) -> dict[str, Any]:
    org = ctx.claimed_org
    expected: list[str] = []
    if org is not None:
        if intent == Intent.PAYMENT:
            expected = [d for d, k in org.verified_domains if k == "payment"] or list(
                org.verified_recipients
            )
        else:
            expected = list(org.login_hosts())
    return {
        "intent": intent.value,
        "claimed_organisation": {"id": org.id, "name": org.name} if org else None,
        "observed_destination": evaluation.action.get("observed_destination"),
        "expected_destinations": expected,
        "payee": evaluation.action.get("payee"),
        "expected_payees": list(org.verified_recipients) if org else [],
        "match": evaluation.action.get("match", "unverifiable"),
    }


async def _persist_evidence(
    db: AsyncSession, scan_id: str, obs: Observations, client: ClientObservation | None
) -> tuple[list[Evidence], dict[str, str]]:
    drafts = list(obs.evidence)
    if client and (client.form_action or client.payee):
        from app.services.observations import EvidenceDraft

        drafts.append(
            EvidenceDraft(
                "client",
                "page",
                "Action metadata reported by the client at the moment of the action",
                {
                    "form_action": client.form_action,
                    "payee": client.payee,
                    "destination_host": client.destination_host,
                    "reported_by": "client",
                },
            )
        )
    rows, mapping = [], {}
    now = utcnow()
    for draft in drafts:
        payload = redact(draft.payload)
        row = Evidence(
            id=new_ulid(),
            scan_id=scan_id,
            source=draft.source,
            observed_at=now,
            summary=draft.summary,
            payload=payload,
            payload_hash=_hash(payload),
            simulated=obs.simulated or bool(draft.payload.get("simulated")),
        )
        rows.append(row)
        mapping[draft.key] = row.id
    if "client" in mapping:
        mapping.setdefault("page", mapping["client"])
    db.add_all(rows)
    await db.flush()
    return rows, mapping


def _finding_rows(
    scan_id: str, findings: list[Finding], key_to_id: dict[str, str]
) -> list[ScanFinding]:
    rows = []
    for f in findings:
        rule = f.rule
        rows.append(
            ScanFinding(
                id=new_ulid(),
                scan_id=scan_id,
                code=f.code,
                signal_group=f.group.value,
                severity=f.severity.value,
                confidence=f.confidence.quantize(Decimal("0.01")),
                title=rule.title,
                detail=f.detail,
                observed=dict(f.observed) if f.observed else None,
                expected=dict(f.expected) if f.expected else None,
                evidence_ids=[key_to_id[k] for k in f.evidence_keys if k in key_to_id],
                rule_id=rule.rule_id,
                simulated=f.simulated,
            )
        )
    return rows


async def write_graph(
    db: AsyncSession,
    obs: Observations,
    scan: Scan,
    ctx: TrustContext,
    client: ClientObservation | None,
    key_to_id: dict[str, str],
) -> None:
    sim = obs.simulated

    def ev(key: str) -> list[str]:
        return [key_to_id[key]] if key in key_to_id else []

    ents: list[EntityRow] = []
    links: list[tuple[str, str, str, list[str], Decimal | None]] = []  # by entity key

    def node(
        type_: str, key: str, label: str, attrs: dict[str, Any] | None = None, simulated: bool = sim
    ) -> str:
        ents.append(EntityRow(type_, key, label, attrs or {}, simulated))
        return key

    def link(
        src: str, tgt: str, type_: str, evidence: list[str], confidence: Decimal | None = None
    ) -> None:
        links.append((src, tgt, type_, evidence, confidence))

    domain = node(
        "domain",
        f"domain:{obs.host}",
        obs.host,
        {"age_days": obs.registration.age_days, "registrable_domain": obs.registrable_domain},
    )
    url = node("url", f"url:{obs.normalised_url}", obs.normalised_url, {"intent_seen": scan.intent})
    for address in obs.dns.a:
        ip = node("ip", f"ip:{address}", address)
        link(domain, ip, "RESOLVES_TO", ev("dns"))
        link(ip, url, "HOSTS", ev("dns"))
    for ns in obs.dns.ns:
        link(domain, node("nameserver", f"nameserver:{ns}", ns), "MANAGED_BY", ev("dns"))
    if obs.tls.presented and obs.tls.fingerprint_sha256:
        cert = node(
            "certificate",
            f"certificate:{obs.tls.fingerprint_sha256}",
            f"{obs.tls.subject_cn or obs.host} ({obs.tls.issuer_cn})",
            {"issuer": obs.tls.issuer_cn, "days_to_expiry": obs.tls.days_to_expiry},
        )
        link(domain, cert, "PRESENTS", ev("tls"))
        if obs.tls.issuer_cn:
            ca = node(
                "certificate_authority",
                f"ca:{obs.tls.issuer_cn}",
                obs.tls.issuer_cn,
                simulated=False,
            )
            link(cert, ca, "ISSUED_BY", ev("tls"))
    sinks = {f.action for f in obs.page.forms if f.action}
    if client and client.form_action:
        sinks.add(client.form_action)
    for sink in sorted(sinks):
        try:
            sink_norm = guard.parse_target(sink).normalised_url
        except DomainError:
            # An unparseable or disallowed form action is evidence, not a graph node.
            log.info("graph.sink_skipped", extra={"scan_id": scan.id})
            continue
        link(url, node("url", f"url:{sink_norm}", sink_norm), "SUBMITS_TO", ev("page"))
    payees = {normalise_payee(p["value"]) for p in obs.page.payees}
    if client and client.payee:
        payees.add(normalise_payee(client.payee))
    for payee in sorted(payees):
        recipient = node(
            "payment_recipient",
            f"payee:upi_vpa:{payee}",
            payee,
            {"type": "upi_vpa", "display_handle": payee},
        )
        link(url, recipient, "REQUESTS_PAYMENT_TO", ev("page"))
    if ctx.claimed_org and not ctx.claimed_org.domain_verified(obs.host):
        org = node(
            "organisation",
            f"organisation:{ctx.claimed_org.id}",
            ctx.claimed_org.name,
            {"verified_domains": [d for d, _ in ctx.claimed_org.verified_domains]},
            simulated=ctx.claimed_org.simulated,
        )
        # THREAT_GRAPH.md §5: 0.4 x token + 0.35 x logo + 0.25 x domain similarity, capped at 0.95.
        org_logo, page_logo = ctx.claimed_org.logo_phash, obs.page.logo_phash
        logo = 0.0
        if org_logo and page_logo:
            logo = max(0.0, 1 - bin(int(org_logo, 16) ^ int(page_logo, 16)).count("1") / 16)
        brand_in_host = any(t.lower() in obs.host for t in ctx.claimed_org.brand_tokens)
        raw = 0.4 * 1.0 + 0.35 * logo + 0.25 * (0.8 if brand_in_host else 0.2)
        confidence = Decimal(str(min(0.95, raw))).quantize(Decimal("0.01"))
        link(domain, org, "IMPERSONATES", ev("page"), confidence)
    # Two statements for the whole page graph, not one per node and edge (remote-pooler latency).
    ids = await upsert_entities(db, ents)
    await upsert_edges(db, [EdgeRow(ids[s], ids[t], ty, c, e) for s, t, ty, e, c in links])
    await _shared_edges(db, ids[domain], obs)


async def _shared_edges(db: AsyncSession, domain_id: str, obs: Observations) -> None:
    """SHARES_NAMESERVER_WITH / SHARES_HOSTING_WITH with other sites (THREAT_GRAPH.md §5)."""
    from sqlalchemy.orm import aliased

    from app.models.tables import Entity, Relationship

    other, target = aliased(Entity), aliased(Entity)
    shared: list[EdgeRow] = []
    if obs.dns.ns:
        rows = (
            await db.execute(
                select(other.id, other.key)
                .join(Relationship, Relationship.source_entity_id == other.id)
                .join(target, Relationship.target_entity_id == target.id)
                .where(
                    Relationship.type == "MANAGED_BY",
                    target.key.in_([f"nameserver:{n}" for n in obs.dns.ns]),
                    other.id != domain_id,
                )
            )
        ).all()
        counts: dict[str, int] = {}
        for oid, key in rows:
            if guard.registrable_domain(key.removeprefix("domain:")) != obs.registrable_domain:
                counts[oid] = counts.get(oid, 0) + 1
        for oid, n in counts.items():
            conf = min(Decimal("0.50"), Decimal("0.35") + Decimal("0.05") * (n - 1))
            shared.append(EdgeRow(domain_id, oid, "SHARES_NAMESERVER_WITH", conf))
    if obs.dns.a:
        prefixes = {".".join(a.split(".")[:3]) for a in obs.dns.a}
        for prefix in prefixes:
            rows = (
                await db.execute(
                    select(other.id, other.key)
                    .join(Relationship, Relationship.source_entity_id == other.id)
                    .join(target, Relationship.target_entity_id == target.id)
                    .where(
                        Relationship.type == "RESOLVES_TO",
                        target.key.like(f"ip:{prefix}.%"),
                        other.id != domain_id,
                    )
                )
            ).all()
            for oid, key in {r for r in rows}:
                if guard.registrable_domain(key.removeprefix("domain:")) != obs.registrable_domain:
                    shared.append(EdgeRow(domain_id, oid, "SHARES_HOSTING_WITH"))
    await upsert_edges(db, shared)


def schedule_scan(app: FastAPI, scan_id: str) -> None:
    """In-process task under the scan semaphore (ADR-003)."""

    async def run() -> None:
        async with app.state.scan_semaphore:
            await execute(app.state.session_factory, app.state.settings, app.state.http, scan_id)

    task = asyncio.create_task(run())
    app.state.runtime.scan_tasks.add(task)
    task.add_done_callback(app.state.runtime.scan_tasks.discard)
