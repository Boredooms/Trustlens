"""Organisations, domains, recipients and members (API_ENDPOINTS.md §7–§10).

Authorisation follows AUTHENTICATION_AUTHORIZATION.md §5:
- reading an organisation needs membership (analysts/operators: any organisation);
- managing it (profile, domains, recipients, members) needs ``org_admin`` — operators always pass;
- cross-tenant access is a 404, never a 403, so existence cannot be probed (§5.4).

Every mutation stages exactly one audit row in the same transaction as the change
(ORGANISATION_TRUST_PROFILES.md §7, acceptance criterion 5). Network checks (domain challenges,
invite email) never run inside an open transaction.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, require_human
from app.config import Settings
from app.errors import Conflict, DomainError, Forbidden, NotFound, RateLimited
from app.models.tables import (
    AuditLog,
    DomainVerification,
    Evidence,
    Organisation,
    OrganisationInvite,
    OrganisationMember,
    User,
    VerifiedDomain,
    VerifiedRecipient,
)
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.governance import (
    DomainChallengeOut,
    DomainCreate,
    DomainList,
    DomainVerifyOut,
    DomainVerifyRequest,
    InviteCreated,
    MemberInvite,
    MemberList,
    MemberOut,
    MemberRoleUpdate,
    OrganisationCreate,
    OrganisationDetail,
    OrganisationUpdate,
)
from app.schemas.resources import (
    OrganisationList,
    PublicProfile,
    RecipientCreate,
    RecipientList,
    RecipientOut,
    RecipientVerify,
)
from app.security.auth import Principal
from app.services import audit, email
from app.services import domain_verification as dv
from app.services.idempotency import idempotent
from app.services.serialise import ts
from app.services.validation import normalise_recipient
from app.utils import is_ulid, iso_z, new_ulid, utcnow

router = APIRouter(
    prefix="/api/v1/organisations", tags=["organisations"], responses=ERROR_RESPONSES
)

INVITE_TTL = timedelta(days=7)
MAX_OPEN_INVITES = 50


class OrganisationNotFound(DomainError):
    code, status, message = (
        ErrorCode.ORGANISATION_NOT_FOUND,
        404,
        "We could not find that organisation.",
    )


class RecipientAlreadyExists(DomainError):
    code, status, message = (
        ErrorCode.RECIPIENT_ALREADY_EXISTS,
        409,
        "That payment address is already registered.",
    )


class NoVerifiedDomain(DomainError):
    code, status, message = (
        ErrorCode.NO_VERIFIED_DOMAIN,
        409,
        "Verify at least one domain before publishing this organisation.",
    )


class LastAdminRemoval(DomainError):
    code, status, message = (
        ErrorCode.LAST_ADMIN_REMOVAL,
        409,
        "An organisation needs at least one administrator. Promote someone else first.",
    )


# ── Access helpers ──────────────────────────────────────────────────────────────
async def _membership(db: AsyncSession, org_id: str, user_id: str) -> str | None:
    return (
        await db.execute(
            select(OrganisationMember.role).where(
                OrganisationMember.organisation_id == org_id, OrganisationMember.user_id == user_id
            )
        )
    ).scalar_one_or_none()


async def _org_access(
    db: AsyncSession,
    org_id: str,
    principal: Principal,
    *,
    admin: bool = False,
    lock: bool = False,
) -> tuple[Organisation, str | None]:
    """Load an organisation the caller may see; enforce ``org_admin`` when ``admin``.

    ``lock`` takes a row lock so concurrent membership changes serialise (last-admin rule).
    """
    org: Organisation | None = None
    if is_ulid(org_id):
        stmt = select(Organisation).where(Organisation.id == org_id)
        if lock:
            stmt = stmt.with_for_update()
        org = (await db.execute(stmt)).scalar_one_or_none()
    if org is None:
        raise OrganisationNotFound()
    role = await _membership(db, org.id, principal.user.id)
    if role is None and not principal.is_analyst:
        raise OrganisationNotFound()  # existence hiding (§5.4)
    if admin and not principal.is_operator and role != "org_admin":
        raise Forbidden("Only an organisation administrator can do that.")
    return org, role


def _domain_valid(d: VerifiedDomain) -> bool:
    return d.status == "verified" and (d.expires_at is None or d.expires_at > utcnow())


async def _has_valid_domain(db: AsyncSession, org_id: str, *, exclude: str | None = None) -> bool:
    rows = (
        await db.execute(
            select(VerifiedDomain).where(
                VerifiedDomain.organisation_id == org_id, VerifiedDomain.status == "verified"
            )
        )
    ).scalars()
    return any(_domain_valid(d) for d in rows if d.id != exclude)


def _domain(d: VerifiedDomain) -> dict[str, Any]:
    return {
        "id": d.id,
        "domain": d.domain,
        "kind": d.kind,
        "status": d.status,
        "verified_at": ts(d.verified_at),
        "expires_at": ts(d.expires_at),
        "verification_method": d.verification_method,
    }


def _recipient(r: VerifiedRecipient) -> dict[str, Any]:
    return {
        "id": r.id,
        "type": r.recipient_type,
        "handle": r.value,
        "label": r.label,
        "status": r.status,
        "verified_at": ts(r.verified_at),
    }


async def _detail(db: AsyncSession, org: Organisation, role: str | None) -> dict[str, Any]:
    await db.refresh(org)  # server-side timestamps after a write
    domains = (
        await db.execute(
            select(VerifiedDomain)
            .where(VerifiedDomain.organisation_id == org.id)
            .order_by(VerifiedDomain.domain)
        )
    ).scalars()
    recipients = (
        await db.execute(
            select(VerifiedRecipient)
            .where(VerifiedRecipient.organisation_id == org.id)
            .order_by(VerifiedRecipient.created_at)
        )
    ).scalars()
    return {
        "id": org.id,
        "name": org.name,
        "legal_name": org.legal_name,
        "country": org.country,
        "sector": org.sector,
        "support_email": org.support_email,
        "status": org.status,
        "brand_tokens": org.brand_tokens,
        "logo_phash": org.logo_phash,
        "login_hosts_mode": org.login_hosts_mode,
        "simulated": org.simulated,
        "role": role,
        "domains": [_domain(d) for d in domains],
        "recipients": [_recipient(r) for r in recipients],
        "created_at": iso_z(org.created_at),
        "updated_at": iso_z(org.updated_at),
    }


# ── Organisations ───────────────────────────────────────────────────────────────
@router.get(
    "", response_model=OrganisationList, summary="Organisations I belong to (analysts: all)"
)
async def list_orgs(
    principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    counts = (
        select(VerifiedDomain.organisation_id, func.count().label("n"))
        .where(VerifiedDomain.status == "verified")
        .where((VerifiedDomain.expires_at.is_(None)) | (VerifiedDomain.expires_at > func.now()))
        .group_by(VerifiedDomain.organisation_id)
        .subquery()
    )
    stmt = (
        select(Organisation, OrganisationMember.role, counts.c.n)
        .outerjoin(
            OrganisationMember,
            (OrganisationMember.organisation_id == Organisation.id)
            & (OrganisationMember.user_id == principal.user.id),
        )
        .outerjoin(counts, counts.c.organisation_id == Organisation.id)
    )
    if not principal.is_analyst:
        stmt = stmt.where(OrganisationMember.user_id == principal.user.id)
    rows = (await db.execute(stmt.order_by(Organisation.name))).all()
    return {
        "data": [
            {
                "id": o.id,
                "name": o.name,
                "status": o.status,
                "role": role,
                "verified_domains_count": n or 0,
                "simulated": o.simulated,
            }
            for o, role, n in rows
        ]
    }


@router.post(
    "",
    status_code=201,
    response_model=OrganisationDetail,
    summary="Create an organisation (draft); the creator becomes its administrator",
)
async def create_org(
    body: OrganisationCreate,
    request: Request,
    response: Response,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    async def run() -> dict[str, Any]:
        taken = (
            await db.execute(
                select(Organisation.id).where(
                    Organisation.created_by == principal.user.id,
                    func.lower(Organisation.name) == body.name.lower(),
                )
            )
        ).scalar_one_or_none()
        if taken:
            raise Conflict("You already created an organisation with that name.")
        org = Organisation(
            id=new_ulid(),
            name=body.name,
            legal_name=body.legal_name,
            country=body.country,
            sector=body.sector,
            support_email=body.support_email,
            status="draft",
            created_by=principal.user.id,
        )
        db.add(org)
        await db.flush()
        db.add(
            OrganisationMember(
                id=new_ulid(), organisation_id=org.id, user_id=principal.user.id, role="org_admin"
            )
        )
        audit.record(
            db,
            action="org.create",
            principal=principal,
            target_type="organisation",
            target_id=org.id,
            organisation_id=org.id,
            after=body.model_dump(mode="json"),
            request=request,
        )
        await db.commit()
        return await _detail(db, org, "org_admin")

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 201, run
    )


@router.get("/{org_id}", response_model=OrganisationDetail, summary="Organisation detail")
async def get_org(
    org_id: str, principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    org, role = await _org_access(db, org_id, principal)
    return await _detail(db, org, role)


@router.patch(
    "/{org_id}",
    response_model=OrganisationDetail,
    summary="Update profile fields; status=active publishes, suspended suspends",
)
async def update_org(
    org_id: str,
    body: OrganisationUpdate,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, role = await _org_access(db, org_id, principal, lock=True)
    is_admin = principal.is_operator or role == "org_admin"
    changes = body.model_dump(exclude_unset=True)
    target_status = changes.pop("status", None)
    if target_status == org.status:
        target_status = None
    changes = {k: v for k, v in changes.items() if getattr(org, k) != v}
    if not changes and target_status is None:
        return await _detail(db, org, role)
    if changes and not is_admin:
        raise Forbidden("Only an organisation administrator can change the profile.")

    action = "org.update"
    if target_status is not None:
        current = org.status
        if target_status == "active":
            if current == "suspended" and not principal.is_operator:
                raise Forbidden("Only an operator can lift a suspension.")
            if not is_admin:
                raise Forbidden("Only an organisation administrator can publish.")
            if not await _has_valid_domain(db, org.id):
                raise NoVerifiedDomain()
            action = "org.publish"
        elif target_status == "suspended":
            if not principal.is_operator:
                raise Forbidden("Only an operator can suspend an organisation.")
            action = "org.suspend"
        else:  # draft
            if current == "suspended" and not principal.is_operator:
                raise Forbidden("Only an operator can change a suspended organisation.")
            if not is_admin:
                raise Forbidden("Only an organisation administrator can unpublish.")
            action = "org.unpublish"
    # ORGANISATION_TRUST_PROFILES.md §8: fintech profiles need operator review before going live.
    resulting_status = target_status or org.status
    resulting_sector = changes.get("sector", org.sector)
    if (
        resulting_status == "active"
        and resulting_sector == "fintech"
        and (target_status == "active" or "sector" in changes)
        and not principal.is_operator
    ):
        raise Forbidden("Financial-sector profiles need operator review before publishing.")

    before = {k: getattr(org, k) for k in changes}
    after = dict(changes)
    if target_status is not None:
        before["status"], after["status"] = org.status, target_status
        org.status = target_status
    for key, value in changes.items():
        setattr(org, key, value)
    audit.record(
        db,
        action=action,
        principal=principal,
        target_type="organisation",
        target_id=org.id,
        organisation_id=org.id,
        before=json.loads(json.dumps(before, default=str)),
        after=json.loads(json.dumps(after, default=str)),
        request=request,
    )
    await db.commit()
    return await _detail(db, org, role)


@router.get(
    "/{org_id}/public-profile", response_model=PublicProfile, summary="Public trust profile"
)
async def public_profile(
    org_id: str, response: Response, db: AsyncSession = Depends(get_db)
) -> Any:
    org = await db.get(Organisation, org_id) if is_ulid(org_id) else None
    if org is None or org.status != "active":
        raise OrganisationNotFound()
    domains = [
        d
        for d in (
            await db.execute(
                select(VerifiedDomain).where(
                    VerifiedDomain.organisation_id == org.id, VerifiedDomain.status == "verified"
                )
            )
        ).scalars()
        if _domain_valid(d)
    ]
    recipients = (
        await db.execute(
            select(VerifiedRecipient).where(
                VerifiedRecipient.organisation_id == org.id, VerifiedRecipient.status == "verified"
            )
        )
    ).scalars()
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    return {
        "id": org.id,
        "name": org.name,
        "sector": org.sector,
        "country": org.country,
        "status": org.status,
        "verified_domains": [d.domain for d in domains],
        "login_hosts": [
            d.domain
            for d in domains
            if d.kind == "login"
            or (d.kind == "official" and org.login_hosts_mode != "explicit_only")
        ],
        "payment_hosts": [d.domain for d in domains if d.kind == "payment"],
        "verified_recipients": [{"type": r.recipient_type, "handle": r.value} for r in recipients],
        "login_hosts_mode": org.login_hosts_mode,
        "simulated": org.simulated,
    }


# ── Domains ─────────────────────────────────────────────────────────────────────
async def _org_domain(db: AsyncSession, org: Organisation, domain_id: str) -> VerifiedDomain:
    row = await db.get(VerifiedDomain, domain_id) if is_ulid(domain_id) else None
    if row is None or row.organisation_id != org.id:
        raise NotFound("We could not find that domain in this organisation.")
    return row


@router.get("/{org_id}/domains", response_model=DomainList, summary="Domains")
async def list_domains(
    org_id: str, principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    org, _ = await _org_access(db, org_id, principal)
    rows = (
        await db.execute(
            select(VerifiedDomain)
            .where(VerifiedDomain.organisation_id == org.id)
            .order_by(VerifiedDomain.domain)
        )
    ).scalars()
    return {"data": [_domain(d) for d in rows]}


@router.post(
    "/{org_id}/domains",
    status_code=201,
    response_model=DomainChallengeOut,
    summary="Claim a domain and get its verification challenges",
    description=(
        "Returns DNS-TXT and HTTPS-file challenges. The raw token appears only in this response. "
        "Calling again for the same domain issues a fresh challenge and invalidates the old one "
        "(this is also how a verified domain is re-verified). Responses are deliberately not "
        "stored for Idempotency-Key replay, because they contain the token."
    ),
)
async def add_domain(
    org_id: str,
    body: DomainCreate,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal, admin=True)
    domain = dv.normalise_domain(body.domain)
    now = utcnow()
    existing = (
        await db.execute(
            select(VerifiedDomain).where(VerifiedDomain.domain == domain).with_for_update()
        )
    ).scalar_one_or_none()
    replaced = False
    if existing is not None and existing.organisation_id != org.id:
        open_challenge = (
            await db.execute(
                select(func.count())
                .select_from(DomainVerification)
                .where(
                    DomainVerification.verified_domain_id == existing.id,
                    DomainVerification.status.in_(("pending", "failed")),
                    DomainVerification.expires_at > now,
                )
            )
        ).scalar_one()
        if _domain_valid(existing) or open_challenge:
            raise dv.DomainAlreadyClaimed()
        # An abandoned or lapsed claim by another organisation does not block the real owner.
        await db.delete(existing)
        await db.flush()
        existing, replaced = None, True

    if existing is None:
        row = VerifiedDomain(
            id=new_ulid(), organisation_id=org.id, domain=domain, kind=body.kind, status="pending"
        )
        db.add(row)
        await db.flush()
        action, before = "domain.add", None
    else:
        row = existing
        action, before = "domain.challenge", {"status": row.status, "kind": row.kind}
        if not _domain_valid(row):
            row.status = "pending"
        row.kind = body.kind

    await db.execute(
        update(DomainVerification)
        .where(
            DomainVerification.verified_domain_id == row.id,
            DomainVerification.status.in_(("pending", "failed")),
        )
        .values(status="expired")
    )
    token = dv.new_token()
    token_hash = dv.hash_token(token)
    expires_at = now + dv.CHALLENGE_TTL
    for method in ("dns_txt", "http_file"):
        db.add(
            DomainVerification(
                id=new_ulid(),
                verified_domain_id=row.id,
                method=method,
                token_hash=token_hash,
                status="pending",
                expires_at=expires_at,
            )
        )
    audit.record(
        db,
        action=action,
        principal=principal,
        target_type="verified_domain",
        target_id=row.id,
        organisation_id=org.id,
        before=before,
        after={
            "domain": domain,
            "kind": body.kind,
            "status": row.status,
            "challenge_expires_at": iso_z(expires_at),
            "replaced_lapsed_claim": replaced,
        },
        request=request,
    )
    await db.commit()
    return {**_domain(row), "challenges": dv.challenges(domain, token, expires_at)}


@router.post(
    "/{org_id}/domains/{domain_id}/verify",
    response_model=DomainVerifyOut,
    summary="Check a domain challenge (dns_txt or http_file)",
)
async def verify_domain(
    org_id: str,
    domain_id: str,
    body: DomainVerifyRequest,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal, admin=True)
    row = await _org_domain(db, org, domain_id)
    if row.status == "revoked":
        raise Conflict("This domain was revoked. Add it again to get a new challenge.")
    now = utcnow()
    window_start = now - timedelta(hours=1)
    recent = list(
        (
            await db.execute(
                select(AuditLog.created_at).where(
                    AuditLog.action == "domain.verify",
                    AuditLog.target_id == row.id,
                    AuditLog.created_at >= window_start,
                )
            )
        ).scalars()
    )
    if len(recent) >= dv.MAX_ATTEMPTS_PER_HOUR:
        retry = int((min(recent) + timedelta(hours=1) - now).total_seconds()) + 1
        raise RateLimited(
            "Too many verification attempts for this domain. Try again later.",
            headers={"Retry-After": str(max(retry, 1)), "X-RateLimit-Remaining": "0"},
        )
    challenge = (
        await db.execute(
            select(DomainVerification)
            .where(
                DomainVerification.verified_domain_id == row.id,
                DomainVerification.method == body.method,
                DomainVerification.status.in_(("pending", "failed")),
            )
            .order_by(DomainVerification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if challenge is None:
        raise dv.VerificationNotFound(
            "There is no open challenge for this method. Request a new challenge.",
            details=[{"field": "method", "issue": "no_open_challenge"}],
        )

    def record_attempt(outcome: str, observed: str | None = None) -> None:
        audit.record(
            db,
            action="domain.verify",
            principal=principal,
            target_type="verified_domain",
            target_id=row.id,
            organisation_id=org.id,
            after={"method": body.method, "outcome": outcome, "observed": observed},
            request=request,
        )

    if challenge.expires_at <= now:
        challenge.status = "expired"
        record_attempt("expired")
        await db.commit()
        raise dv.VerificationExpired()

    challenge.attempts += 1
    domain, token_hash = row.domain, challenge.token_hash
    await db.commit()  # no transaction is held across the network check

    result = await dv.run_check(body.method, domain, token_hash)
    now = utcnow()
    challenge.observed_value = result.observed
    if result.matched:
        challenge.status, challenge.verified_at = "verified", now
        await db.execute(
            update(DomainVerification)
            .where(
                DomainVerification.verified_domain_id == row.id,
                DomainVerification.id != challenge.id,
                DomainVerification.status.in_(("pending", "failed")),
            )
            .values(status="expired")
        )
        valid_until = now + dv.VERIFICATION_VALIDITY
        row.status, row.verified_at, row.expires_at = "verified", now, valid_until
        row.verification_method = body.method
        payload = {
            "domain": domain,
            "method": body.method,
            "checked": (
                f"{dv.RECORD_PREFIX}.{domain}"
                if body.method == "dns_txt"
                else f"https://{domain}{dv.FILE_PATH}"
            ),
            "observed_value_sha256": result.observed_hash,
        }
        evidence = Evidence(
            id=new_ulid(),
            scan_id=None,
            source="dns_challenge" if body.method == "dns_txt" else "http_file",
            observed_at=now,
            summary=f"Control of {domain} proven via {body.method}",
            payload=payload,
            payload_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        )
        db.add(evidence)
        record_attempt("verified")
        await db.commit()
        return {
            "id": row.id,
            "domain": domain,
            "status": "verified",
            "verification_method": body.method,
            "verified_at": iso_z(now),
            "expires_at": iso_z(valid_until),
            "evidence_id": evidence.id,
        }

    if result.outcome == "fetch_failed":
        record_attempt("fetch_failed")
        await db.commit()
        raise dv.VerificationFetchFailed()

    challenge.status = "failed"
    if not _domain_valid(row):
        row.status = "failed"
    record_attempt(result.outcome, result.observed)
    await db.commit()
    if result.outcome == "mismatch":
        raise dv.VerificationTokenMismatch(
            details=[{"field": "method", "issue": "token_mismatch", "observed": result.observed}]
        )
    raise dv.VerificationNotFound(details=[{"field": "method", "issue": "record_not_found"}])


@router.delete(
    "/{org_id}/domains/{domain_id}", status_code=204, summary="Revoke a domain (not authoritative)"
)
async def revoke_domain(
    org_id: str,
    domain_id: str,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    org, _ = await _org_access(db, org_id, principal, admin=True, lock=True)
    row = await _org_domain(db, org, domain_id)
    if row.status != "revoked":
        before = {"status": row.status, "organisation_status": org.status}
        row.status = "revoked"
        await db.execute(
            update(DomainVerification)
            .where(
                DomainVerification.verified_domain_id == row.id,
                DomainVerification.status.in_(("pending", "failed")),
            )
            .values(status="expired")
        )
        # Lifecycle (§3): an active profile with no verified domain left falls back to draft.
        if org.status == "active" and not await _has_valid_domain(db, org.id, exclude=row.id):
            org.status = "draft"
        audit.record(
            db,
            action="domain.revoke",
            principal=principal,
            target_type="verified_domain",
            target_id=row.id,
            organisation_id=org.id,
            before=before,
            after={"status": "revoked", "domain": row.domain, "organisation_status": org.status},
            request=request,
        )
        await db.commit()
    return Response(status_code=204)


# ── Recipients ──────────────────────────────────────────────────────────────────
@router.get("/{org_id}/recipients", response_model=RecipientList, summary="Payment recipients")
async def list_recipients(
    org_id: str, principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    org, _ = await _org_access(db, org_id, principal)
    rows = (
        await db.execute(
            select(VerifiedRecipient)
            .where(VerifiedRecipient.organisation_id == org.id)
            .order_by(VerifiedRecipient.created_at)
        )
    ).scalars()
    return {"data": [_recipient(r) for r in rows]}


@router.post(
    "/{org_id}/recipients",
    status_code=201,
    response_model=RecipientOut,
    summary="Register a recipient (pending attestation)",
)
async def add_recipient(
    org_id: str,
    body: RecipientCreate,
    request: Request,
    response: Response,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal, admin=True)
    value = normalise_recipient(body.recipient_type.value, body.value)

    async def run() -> dict[str, Any]:
        row = (
            await db.execute(
                select(VerifiedRecipient).where(
                    VerifiedRecipient.organisation_id == org.id,
                    VerifiedRecipient.recipient_type == body.recipient_type.value,
                    VerifiedRecipient.normalised_value == value,
                )
            )
        ).scalar_one_or_none()
        before = None
        if row is not None:
            if row.status not in ("revoked", "rejected"):
                raise RecipientAlreadyExists()
            # Re-registering a revoked/rejected address starts attestation again from scratch.
            before = {"status": row.status}
            row.status, row.value, row.label = "pending_attestation", body.value, body.label
            row.verified_by = row.verified_at = row.evidence_ref = None
        else:
            row = VerifiedRecipient(
                id=new_ulid(),
                organisation_id=org.id,
                recipient_type=body.recipient_type.value,
                value=body.value,
                normalised_value=value,
                label=body.label,
                status="pending_attestation",
            )
            db.add(row)
            await db.flush()
        audit.record(
            db,
            action="recipient.add",
            principal=principal,
            target_type="verified_recipient",
            target_id=row.id,
            organisation_id=org.id,
            before=before,
            after={"type": row.recipient_type, "handle": row.value, "status": row.status},
            request=request,
        )
        await db.commit()
        return _recipient(row)

    return await idempotent(
        request, response, db, principal, body.model_dump(mode="json"), 201, run
    )


@router.post(
    "/{org_id}/recipients/{recipient_id}/verify",
    response_model=RecipientOut,
    summary="Attest or reject a recipient (analyst/operator)",
)
async def verify_recipient(
    org_id: str,
    recipient_id: str,
    body: RecipientVerify,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal)
    if not principal.is_analyst:
        raise Forbidden("Only an analyst can attest a payment recipient.")
    row = await db.get(VerifiedRecipient, recipient_id) if is_ulid(recipient_id) else None
    if row is None or row.organisation_id != org.id:
        raise NotFound("We could not find that recipient in this organisation.")
    if row.status != "pending_attestation":
        raise Conflict("This recipient has already been decided. Register it again to re-attest.")
    added_by = (
        await db.execute(
            select(AuditLog.actor_user_id)
            .where(AuditLog.action == "recipient.add", AuditLog.target_id == row.id)
            .order_by(AuditLog.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    before = row.status
    row.status = "verified" if body.action == "verify" else "rejected"
    row.verified_by, row.verified_at = principal.user.id, utcnow()
    row.evidence_ref = body.evidence_ref or row.evidence_ref
    audit.record(
        db,
        action="recipient.verify" if body.action == "verify" else "recipient.reject",
        principal=principal,
        target_type="verified_recipient",
        target_id=row.id,
        organisation_id=org.id,
        before={"status": before},
        after={
            "status": row.status,
            "reason": body.reason,
            "evidence_ref": row.evidence_ref,
            "self_attested": added_by == principal.user.id,
        },
        request=request,
    )
    await db.commit()
    return _recipient(row)


@router.delete(
    "/{org_id}/recipients/{recipient_id}",
    status_code=204,
    summary="Revoke a recipient (org admin, analyst or operator)",
)
async def revoke_recipient(
    org_id: str,
    recipient_id: str,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # ORGANISATION_TRUST_PROFILES.md §8: an analyst can revoke a bogus payee immediately.
    org, role = await _org_access(db, org_id, principal)
    if role != "org_admin" and not principal.is_analyst:
        raise Forbidden("Only an organisation administrator or an analyst can revoke a recipient.")
    row = await db.get(VerifiedRecipient, recipient_id) if is_ulid(recipient_id) else None
    if row is None or row.organisation_id != org.id:
        raise NotFound("We could not find that recipient in this organisation.")
    if row.status != "revoked":
        before = row.status
        row.status = "revoked"
        audit.record(
            db,
            action="recipient.revoke",
            principal=principal,
            target_type="verified_recipient",
            target_id=row.id,
            organisation_id=org.id,
            before={"status": before},
            after={"status": "revoked", "handle": row.value},
            request=request,
        )
        await db.commit()
    return Response(status_code=204)


# ── Members and invites ─────────────────────────────────────────────────────────
def _web_origin(settings: Settings) -> str:
    return (settings.allowed_origins[0] if settings.allowed_origins else "").rstrip("/")


def accept_url(settings: Settings, token: str) -> str:
    return f"{_web_origin(settings)}/invites/{token}"


async def _admin_count(db: AsyncSession, org_id: str) -> int:
    count: int = (
        await db.execute(
            select(func.count())
            .select_from(OrganisationMember)
            .where(
                OrganisationMember.organisation_id == org_id,
                OrganisationMember.role == "org_admin",
            )
        )
    ).scalar_one()
    return count


async def _member_row(
    db: AsyncSession, org_id: str, user_id: str
) -> tuple[OrganisationMember, User]:
    found = (
        await db.execute(
            select(OrganisationMember, User)
            .join(User, User.id == OrganisationMember.user_id)
            .where(
                OrganisationMember.organisation_id == org_id,
                OrganisationMember.user_id == user_id,
            )
        )
    ).first()
    if found is None:
        raise NotFound("That person is not a member of this organisation.")
    return found[0], found[1]


def _member(m: OrganisationMember, u: User) -> dict[str, Any]:
    return {
        "user_id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "role": m.role,
        "created_at": iso_z(m.created_at),
    }


@router.get("/{org_id}/members", response_model=MemberList, summary="Members and open invites")
async def list_members(
    org_id: str, principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    org, role = await _org_access(db, org_id, principal)
    rows = (
        await db.execute(
            select(OrganisationMember, User)
            .join(User, User.id == OrganisationMember.user_id)
            .where(OrganisationMember.organisation_id == org.id)
            .order_by(OrganisationMember.created_at)
        )
    ).all()
    invites: list[dict[str, Any]] = []
    if principal.is_operator or role == "org_admin":
        open_invites = (
            await db.execute(
                select(OrganisationInvite)
                .where(
                    OrganisationInvite.organisation_id == org.id,
                    OrganisationInvite.accepted_at.is_(None),
                    OrganisationInvite.expires_at > func.now(),
                )
                .order_by(OrganisationInvite.created_at)
            )
        ).scalars()
        invites = [
            {
                "id": i.id,
                "email": i.email,
                "role": i.role,
                "expires_at": iso_z(i.expires_at),
                "created_at": iso_z(i.created_at),
                "invited_by": i.invited_by,
            }
            for i in open_invites
        ]
    return {"data": [_member(m, u) for m, u in rows], "invites": invites}


@router.post(
    "/{org_id}/members",
    status_code=201,
    response_model=InviteCreated,
    summary="Invite someone by email (expires in 7 days, single use)",
)
async def invite_member(
    org_id: str,
    body: MemberInvite,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal, admin=True)
    already = (
        await db.execute(
            select(OrganisationMember.id)
            .join(User, User.id == OrganisationMember.user_id)
            .where(OrganisationMember.organisation_id == org.id, User.email == body.email)
        )
    ).first()
    if already:
        raise Conflict("That person is already a member of this organisation.")
    open_count = (
        await db.execute(
            select(func.count())
            .select_from(OrganisationInvite)
            .where(
                OrganisationInvite.organisation_id == org.id,
                OrganisationInvite.accepted_at.is_(None),
                OrganisationInvite.expires_at > func.now(),
                OrganisationInvite.email != body.email,
            )
        )
    ).scalar_one()
    if open_count >= MAX_OPEN_INVITES:
        raise Conflict("This organisation has too many open invites. Revoke some first.")
    # Re-inviting replaces any earlier unaccepted invite for the same address.
    await db.execute(
        delete(OrganisationInvite).where(
            OrganisationInvite.organisation_id == org.id,
            OrganisationInvite.email == body.email,
            OrganisationInvite.accepted_at.is_(None),
        )
    )
    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + INVITE_TTL
    invite = OrganisationInvite(
        id=new_ulid(),
        organisation_id=org.id,
        email=body.email,
        role=body.role,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        invited_by=principal.user.id,
        expires_at=expires_at,
    )
    db.add(invite)
    audit.record(
        db,
        action="org.member.invite",
        principal=principal,
        target_type="organisation_invite",
        target_id=invite.id,
        organisation_id=org.id,
        after={"email": body.email, "role": body.role, "expires_at": iso_z(expires_at)},
        request=request,
    )
    org_name, inviter = org.name, principal.user.display_name
    await db.commit()

    settings: Settings = request.app.state.settings
    link = accept_url(settings, token)
    delivery = await email.send(
        settings,
        email.invite_message(
            to=body.email,
            organisation=org_name,
            inviter=inviter,
            role=body.role,
            accept_url=link,
            expires_at=iso_z(expires_at),
        ),
    )
    return {
        "invite_id": invite.id,
        "email": body.email,
        "role": body.role,
        "expires_at": iso_z(expires_at),
        "delivery": delivery,
        "accept_url": None if delivery == "email" else link,
    }


@router.delete("/{org_id}/invites/{invite_id}", status_code=204, summary="Revoke an open invite")
async def revoke_invite(
    org_id: str,
    invite_id: str,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    org, _ = await _org_access(db, org_id, principal, admin=True)
    invite = await db.get(OrganisationInvite, invite_id) if is_ulid(invite_id) else None
    if invite is None or invite.organisation_id != org.id or invite.accepted_at is not None:
        raise NotFound("We could not find that invite.")
    audit.record(
        db,
        action="org.member.invite.revoke",
        principal=principal,
        target_type="organisation_invite",
        target_id=invite.id,
        organisation_id=org.id,
        before={"email": invite.email, "role": invite.role},
        request=request,
    )
    await db.delete(invite)
    await db.commit()
    return Response(status_code=204)


@router.patch(
    "/{org_id}/members/{user_id}",
    response_model=MemberOut,
    summary="Change a member's role (promote/demote)",
)
async def update_member(
    org_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    org, _ = await _org_access(db, org_id, principal, admin=True, lock=True)
    member, user = await _member_row(db, org.id, user_id)
    if member.role == body.role:
        return _member(member, user)
    if member.role == "org_admin" and await _admin_count(db, org.id) <= 1:
        raise LastAdminRemoval()
    before = member.role
    member.role = body.role
    audit.record(
        db,
        action="org.member.role",
        principal=principal,
        target_type="organisation_member",
        target_id=user.id,
        organisation_id=org.id,
        before={"role": before},
        after={"role": body.role, "email": user.email},
        request=request,
    )
    await db.commit()
    return _member(member, user)


@router.delete(
    "/{org_id}/members/{user_id}",
    status_code=204,
    summary="Remove a member (admins; or leave the organisation yourself)",
)
async def remove_member(
    org_id: str,
    user_id: str,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    leaving = user_id == principal.user.id
    org, _ = await _org_access(db, org_id, principal, admin=not leaving, lock=True)
    member, user = await _member_row(db, org.id, user_id)
    if member.role == "org_admin" and await _admin_count(db, org.id) <= 1:
        raise LastAdminRemoval()
    audit.record(
        db,
        action="org.member.remove",
        principal=principal,
        target_type="organisation_member",
        target_id=user.id,
        organisation_id=org.id,
        before={"role": member.role, "email": user.email},
        after={"self_removal": leaving},
        request=request,
    )
    await db.delete(member)
    await db.commit()
    return Response(status_code=204)


__all__ = ["router", "current_principal", "accept_url"]
