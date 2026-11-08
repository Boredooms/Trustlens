"""Account deletion and anonymisation (PRODUCT_REQUIREMENTS NFR-032, USER_JOURNEYS J11).

The ``users`` row is never physically deleted: audit rows, reviews and confirmed intelligence keep a
foreign key to it. Instead it is anonymised and deactivated, and everything personal or
credential-like the user owns is revoked or deleted.

Kept (anonymised): scans referenced by a confirmed threat report (they are confirmed intelligence),
and investigations on those scans. Deleted: every other scan with its findings, evidence and
investigations. Reports the user filed lose their reporter and get ``anonymised_at``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.logging import get_logger
from app.models.tables import (
    ApiKey,
    Evidence,
    Investigation,
    Organisation,
    OrganisationInvite,
    OrganisationMember,
    PairingCode,
    RefreshToken,
    Scan,
    ScanFinding,
    ThreatReport,
    UsageCounter,
    User,
)
from app.security.auth import Principal
from app.services import audit
from app.utils import utcnow

log = get_logger("accounts")

CLERK_API = "https://api.clerk.com/v1"
DELETED_NAME = "Deleted user"


@dataclass(frozen=True)
class SoleAdminOrg:
    organisation_id: str
    name: str


async def sole_admin_orgs(db: AsyncSession, user_id: str) -> list[SoleAdminOrg]:
    """Organisations where this user is the only ``org_admin`` (J11 gate)."""
    admin_counts = (
        select(
            OrganisationMember.organisation_id,
            func.count().label("admins"),
        )
        .where(OrganisationMember.role == "org_admin")
        .group_by(OrganisationMember.organisation_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(Organisation.id, Organisation.name)
            .join(OrganisationMember, OrganisationMember.organisation_id == Organisation.id)
            .join(admin_counts, admin_counts.c.organisation_id == Organisation.id)
            .where(
                OrganisationMember.user_id == user_id,
                OrganisationMember.role == "org_admin",
                admin_counts.c.admins == 1,
            )
            .order_by(Organisation.name)
        )
    ).all()
    return [SoleAdminOrg(str(i), str(n)) for i, n in rows]


async def anonymise_user(
    db: AsyncSession,
    user: User,
    *,
    source: str,
    principal: Principal | None = None,
    request: Request | None = None,
) -> dict[str, Any]:
    """Revoke, delete and anonymise everything the user owns. Stages changes; caller commits.

    ``source`` is ``"self"`` (DELETE /auth/me) or ``"clerk_webhook"``. Returns a summary that is
    also stored (counts only) on the ``user.delete`` audit row.
    """
    now = utcnow()
    uid = user.id
    orphaned = await sole_admin_orgs(db, uid)

    key_ids = [
        str(k) for k in (await db.execute(select(ApiKey.id).where(ApiKey.user_id == uid))).scalars()
    ]
    revoked_keys = (
        await db.execute(
            update(ApiKey)
            .where(ApiKey.user_id == uid, ApiKey.revoked_at.is_(None))
            .values(revoked_at=now)
        )
    ).rowcount
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == uid, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await db.execute(delete(PairingCode).where(PairingCode.user_id == uid))
    memberships = (
        await db.execute(delete(OrganisationMember).where(OrganisationMember.user_id == uid))
    ).rowcount
    await db.execute(
        delete(OrganisationInvite).where(
            func.lower(OrganisationInvite.email) == user.email.lower(),
            OrganisationInvite.accepted_at.is_(None),
        )
    )
    await db.execute(delete(UsageCounter).where(UsageCounter.actor_id.in_([uid, *key_ids])))

    reports = (
        await db.execute(
            update(ThreatReport)
            .where(ThreatReport.reporter_user_id == uid)
            .values(reporter_user_id=None, anonymised_at=now)
        )
    ).rowcount

    # Scans that back a confirmed report are confirmed intelligence: keep them, drop the owner.
    kept = select(ThreatReport.scan_id).where(
        ThreatReport.status == "confirmed", ThreatReport.scan_id.is_not(None)
    )
    doomed = [
        str(s)
        for s in (
            await db.execute(select(Scan.id).where(Scan.user_id == uid, Scan.id.not_in(kept)))
        ).scalars()
    ]
    if doomed:
        await db.execute(delete(Investigation).where(Investigation.scan_id.in_(doomed)))
        await db.execute(delete(ScanFinding).where(ScanFinding.scan_id.in_(doomed)))
        await db.execute(delete(Evidence).where(Evidence.scan_id.in_(doomed)))
        await db.execute(
            update(ThreatReport).where(ThreatReport.scan_id.in_(doomed)).values(scan_id=None)
        )
        await db.execute(delete(Scan).where(Scan.id.in_(doomed)))
    anonymised_scans = (
        await db.execute(update(Scan).where(Scan.user_id == uid).values(user_id=None))
    ).rowcount
    await db.execute(update(Investigation).where(Investigation.user_id == uid).values(user_id=None))

    summary = {
        "source": source,
        "api_keys_revoked": revoked_keys,
        "memberships_removed": memberships,
        "reports_anonymised": reports,
        "scans_deleted": len(doomed),
        "scans_anonymised": anonymised_scans,
        "orphaned_organisations": [o.organisation_id for o in orphaned],
    }
    clerk_user_id = user.clerk_user_id
    user.email = f"deleted-{uid}@users.invalid"
    user.display_name = DELETED_NAME
    user.role = "user"
    user.is_active = False
    # Frees the identity: a Clerk webhook arriving later is a no-op, and a re-signup is a new user.
    user.clerk_user_id = f"deleted_{uid}"
    audit.record(
        db,
        action="user.delete",
        principal=principal,
        actor_kind=None if principal is not None else "system",
        target_type="user",
        target_id=uid,
        after=summary,
        request=request,
    )
    if orphaned:
        log.warning(
            "account.delete_orphaned_orgs",
            extra={"user_id": uid, "organisations": summary["orphaned_organisations"]},
        )
    log.info("account.deleted", extra={"user_id": uid, "source": source})
    summary["clerk_user_id"] = clerk_user_id
    return summary


async def delete_clerk_user(settings: Settings, clerk_user_id: str) -> bool:
    """Best effort, after commit. Dev users and missing keys are skipped; failures only log."""
    if clerk_user_id.startswith(("dev_", "deleted_")) or settings.clerk_secret_key is None:
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.delete(
                f"{CLERK_API}/users/{clerk_user_id}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key.get_secret_value()}"},
            )
        if resp.status_code in (200, 404):
            return True
        log.warning("account.clerk_delete_failed", extra={"status": resp.status_code})
    except httpx.HTTPError as exc:
        log.warning("account.clerk_delete_failed", extra={"exc_type": type(exc).__name__})
    return False
