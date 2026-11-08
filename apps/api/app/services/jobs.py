"""Scheduled maintenance jobs (BACKEND_OVERVIEW.md §9.3, DATABASE_DESIGN.md §11).

Every job is idempotent and safe to retry: QStash delivers at least once, and an operator can run
any job by hand. Jobs return a small JSON summary that the internal route echoes and logs.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import case, delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.errors import DomainError
from app.logging import get_logger
from app.models.tables import (
    AuditLog,
    Certificate,
    CertificateMonitor,
    Entity,
    IdempotencyKey,
    PairingCode,
    Scan,
    UsageCounter,
)
from app.services import audit, guard
from app.services.collectors import collect_tls
from app.services.demo_fixtures import is_demo_host
from app.services.observations import TlsObs
from app.utils import new_ulid, utcnow

log = get_logger("jobs")

Factory = async_sessionmaker[AsyncSession]

STALE_SCAN_AFTER = timedelta(minutes=5)
DECAY_EVERY = timedelta(days=7)
DECAY_STEP = 2  # THREAT_INTELLIGENCE_ENGINE.md §4.1: +2/week toward 0
HALVE_AFTER = timedelta(days=90)  # untouched for 90 days: drift 50% of the way back to 0
EXPIRY_BUCKETS = (7, 14, 30)
SWEEP_CONCURRENCY = 4


# ── reconcile-scans ─────────────────────────────────────────────────────────────
async def reconcile_scans(factory: Factory, settings: Settings) -> dict[str, Any]:
    """Sweep scans stuck in queued/running for more than 5 minutes to ``failed``."""
    now = utcnow()
    async with factory() as db:
        result = await db.execute(
            update(Scan)
            .where(Scan.status.in_(("queued", "running")), Scan.created_at < now - STALE_SCAN_AFTER)
            .values(status="failed", failure_code="STALE_RECONCILED", completed_at=now)
        )
        await db.commit()
    return {"failed_stale_scans": int(result.rowcount or 0)}


# ── keepalive ───────────────────────────────────────────────────────────────────
async def keepalive(factory: Factory, settings: Settings) -> dict[str, Any]:
    """``SELECT 1`` so a free Supabase project is never paused for inactivity (ADR-011)."""
    async with factory() as db:
        value = (await db.execute(text("SELECT 1"))).scalar_one()
    return {"database": "ok" if value == 1 else "unexpected"}


# ── reputation-decay ────────────────────────────────────────────────────────────
async def reputation_decay(factory: Factory, settings: Settings) -> dict[str, Any]:
    """Move non-zero reputation toward 0 (THREAT_INTELLIGENCE_ENGINE.md §4.1).

    - Weekly step of 2 points, tracked per entity in ``attributes.last_decay_at`` so a daily
      schedule (or a retry) applies it at most once per 7 days.
    - Entities untouched (``last_seen_at``) for 90 days drift half-way to 0, once per 90 days.
    - Analyst manual blocks (``attributes.manual_block``) never decay.
    """
    now = utcnow()
    stamp = now.isoformat()
    last_decay = func.coalesce(
        Entity.attributes["last_decay_at"].astext.cast(Entity.created_at.type),
        Entity.updated_at,
    )
    not_manual = Entity.attributes["manual_block"].astext.is_(None)
    async with factory() as db:
        halved = await db.execute(
            update(Entity)
            .where(
                Entity.reputation_score != 0,
                not_manual,
                Entity.last_seen_at < now - HALVE_AFTER,
                or_(
                    Entity.attributes["last_halved_at"].astext.is_(None),
                    Entity.attributes["last_halved_at"].astext.cast(Entity.created_at.type)
                    < now - HALVE_AFTER,
                ),
            )
            .values(
                # integer division truncates toward 0 in Postgres: -45/2 = -22, 45/2 = 22
                reputation_score=Entity.reputation_score // 2,
                attributes=Entity.attributes.op("||")(
                    func.jsonb_build_object("last_halved_at", stamp, "last_decay_at", stamp)
                ),
            )
            .execution_options(synchronize_session=False)
        )
        stepped = await db.execute(
            update(Entity)
            .where(Entity.reputation_score != 0, not_manual, last_decay < now - DECAY_EVERY)
            .values(
                reputation_score=case(
                    (
                        Entity.reputation_score < 0,
                        func.least(0, Entity.reputation_score + DECAY_STEP),
                    ),
                    else_=func.greatest(0, Entity.reputation_score - DECAY_STEP),
                ),
                attributes=Entity.attributes.op("||")(
                    func.jsonb_build_object("last_decay_at", stamp)
                ),
            )
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    return {
        "halved": int(halved.rowcount or 0),
        "stepped": int(stepped.rowcount or 0),
    }


# ── retention ───────────────────────────────────────────────────────────────────
async def retention(factory: Factory, settings: Settings) -> dict[str, Any]:
    """Purge rows past their retention (DATABASE_DESIGN.md §11).

    Covered: pairing codes (24 h), idempotency keys (expired), usage counters (90 days) and audit
    logs (1 year). ``audit_logs`` is append-only by trigger; this transaction opts in explicitly
    with ``SET LOCAL app.audit_retention = 'on'`` and nothing else ever does.
    """
    now = utcnow()
    async with factory() as db:
        pairing = await db.execute(
            delete(PairingCode).where(PairingCode.created_at < now - timedelta(hours=24))
        )
        idem = await db.execute(delete(IdempotencyKey).where(IdempotencyKey.expires_at < now))
        usage = await db.execute(
            delete(UsageCounter).where(UsageCounter.day < (now - timedelta(days=90)).date())
        )
        await db.execute(text("SET LOCAL app.audit_retention = 'on'"))
        audit = await db.execute(
            delete(AuditLog).where(AuditLog.created_at < now - timedelta(days=365))
        )
        await db.commit()
    return {
        "pairing_codes": int(pairing.rowcount or 0),
        "idempotency_keys": int(idem.rowcount or 0),
        "usage_counters": int(usage.rowcount or 0),
        "audit_logs": int(audit.rowcount or 0),
    }


# ── cert-sweep ──────────────────────────────────────────────────────────────────
def _parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


async def upsert_certificate(db: AsyncSession, tls: TlsObs, now: datetime) -> Certificate:
    """Insert or refresh a certificate row keyed by its SHA-256 fingerprint."""
    assert tls.fingerprint_sha256 is not None  # noqa: S101 — guarded by the caller
    cert = (
        await db.execute(
            select(Certificate).where(Certificate.fingerprint_sha256 == tls.fingerprint_sha256)
        )
    ).scalar_one_or_none()
    if cert is None:
        cert = Certificate(
            id=new_ulid(), fingerprint_sha256=tls.fingerprint_sha256, first_seen_at=now
        )
        db.add(cert)
    cert.subject_cn = tls.subject_cn
    cert.issuer_cn = tls.issuer_cn or "unknown"
    cert.root_issuer_cn = tls.root_issuer_cn
    cert.sans = list(tls.sans)
    not_after = _parse(tls.not_after)
    if not_after is None and tls.days_to_expiry is not None:  # recorded fixtures carry days only
        not_after = now + timedelta(days=tls.days_to_expiry)
    cert.not_after = not_after or now
    cert.not_before = _parse(tls.not_before) or min(now, cert.not_after)
    cert.key_type = tls.key_type or "other"
    cert.key_bits = tls.key_bits
    cert.signature_algorithm = tls.signature_algorithm or "unknown"
    cert.is_self_signed = bool(tls.subject_cn and tls.subject_cn == tls.issuer_cn)
    cert.chain_length = tls.chain_length
    cert.last_seen_at = now
    return cert


TlsProbe = Callable[[guard.Target, Settings], Awaitable[TlsObs]]


async def _probe(domain: str, settings: Settings, probe: TlsProbe) -> TlsObs | None:
    try:
        target = await guard.check_target(
            f"https://{domain}/", dns_timeout=settings.dns_timeout_seconds
        )
    except DomainError:
        return None
    tls = await probe(target, settings)
    if tls.status != "collected" or not tls.presented or not tls.fingerprint_sha256:
        return None
    return tls


async def cert_sweep(
    factory: Factory, settings: Settings, *, probe: TlsProbe = collect_tls
) -> dict[str, Any]:
    """Re-check every enabled monitor's certificate (BACKEND_OVERVIEW.md §9.3, TL-020).

    Each live probe goes through the SSRF guard. Seeded/simulated certificates and demo hosts are
    never probed or overwritten: the demo's recorded state is not something a cron may change.
    """
    now = utcnow()
    async with factory() as db:
        rows = (
            await db.execute(
                select(CertificateMonitor, Certificate)
                .outerjoin(Certificate, Certificate.id == CertificateMonitor.current_certificate_id)
                .where(CertificateMonitor.enabled.is_(True))
            )
        ).all()
    live: list[str] = []
    skipped = 0
    for monitor, current in rows:
        demo = settings.demo_mode and is_demo_host(
            monitor.domain, guard.registrable_domain(monitor.domain)
        )
        if demo or (current is not None and current.simulated):
            skipped += 1
            continue
        live.append(monitor.id)

    gate = asyncio.Semaphore(SWEEP_CONCURRENCY)
    monitor_domain = {m.id: m.domain for m, _ in rows}

    async def one(monitor_id: str) -> tuple[str, TlsObs | None]:
        async with gate:
            return monitor_id, await _probe(monitor_domain[monitor_id], settings, probe)

    results = await asyncio.gather(*(one(mid) for mid in live))
    checked = changed = unreachable = 0
    async with factory() as db:
        for monitor_id, tls in results:
            monitor = await db.get(CertificateMonitor, monitor_id)
            if monitor is None:
                continue
            monitor.last_checked_at = now
            if tls is None:
                unreachable += 1
                continue
            checked += 1
            cert = await upsert_certificate(db, tls, now)
            await db.flush()
            if monitor.current_certificate_id and monitor.current_certificate_id != cert.id:
                changed += 1
                log.info(
                    "certificate.changed",
                    extra={"monitor_id": monitor.id, "domain": monitor.domain},
                )
                audit.record(
                    db,
                    action="certificate.changed",
                    actor_kind="system",
                    target_type="certificate_monitor",
                    target_id=monitor.id,
                    organisation_id=monitor.organisation_id,
                    before={"certificate_id": monitor.current_certificate_id},
                    after={"certificate_id": cert.id},
                )
            monitor.current_certificate_id = cert.id
        await db.commit()
        expiring = (
            await db.execute(
                select(Certificate.not_after)
                .join(
                    CertificateMonitor,
                    CertificateMonitor.current_certificate_id == Certificate.id,
                )
                .where(CertificateMonitor.enabled.is_(True))
            )
        ).scalars()
        days = [(n - now).days for n in expiring]
    buckets = {f"within_{b}_days": sum(1 for d in days if d <= b) for b in EXPIRY_BUCKETS}
    return {
        "monitors": len(rows),
        "checked": checked,
        "changed": changed,
        "unreachable": unreachable,
        "skipped_simulated": skipped,
        "expiring": buckets,
        "expired": sum(1 for d in days if d < 0),
    }


JOBS: dict[str, Callable[[Factory, Settings], Awaitable[dict[str, Any]]]] = {
    "cert-sweep": cert_sweep,
    "reputation-decay": reputation_decay,
    "reconcile-scans": reconcile_scans,
    "keepalive": keepalive,
    "retention": retention,
}

__all__ = ["JOBS", "upsert_certificate"]
