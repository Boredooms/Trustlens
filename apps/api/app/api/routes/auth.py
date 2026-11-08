"""Auth (API_ENDPOINTS.md §3).

Sign-up, sign-in and refresh are delegated to Clerk — no such routes here.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, rate_limit, require_human
from app.errors import DomainError, NotFound, ValidationFailed
from app.models.tables import ApiKey, AuditLog, Organisation, OrganisationMember, PairingCode
from app.schemas.common import ERROR_RESPONSES, RequestModel
from app.schemas.enums import ErrorCode
from app.schemas.resources import (
    DeviceList,
    ExchangeRequest,
    ExchangeResponse,
    MeOut,
    PairRequest,
    PairResponse,
)
from app.security.auth import (
    DEVICE_SCOPES,
    Principal,
    new_pairing_code,
    new_secret,
    normalise_pairing_code,
    sha256_hex,
)
from app.services.accounts import anonymise_user, delete_clerk_user, sole_admin_orgs
from app.services.serialise import ts
from app.utils import new_ulid, utcnow

router = APIRouter(prefix="/api/v1/auth", tags=["auth"], responses=ERROR_RESPONSES)

PAIRING_TTL = timedelta(minutes=10)
DEVICE_TTL = timedelta(days=180)


class InvalidPairingCode(DomainError):
    code, status, message = ErrorCode.INVALID_PAIRING_CODE, 401, "That pairing code is not valid."


class PairingCodeExpired(DomainError):
    code, status, message = (
        ErrorCode.PAIRING_CODE_EXPIRED,
        410,
        "That pairing code has expired. Create a new one.",
    )


@router.get("/me", response_model=MeOut, summary="Current principal")
async def me(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> Any:
    rows = (
        await db.execute(
            select(Organisation.id, Organisation.name, OrganisationMember.role)
            .join(OrganisationMember, OrganisationMember.organisation_id == Organisation.id)
            .where(OrganisationMember.user_id == principal.user.id)
        )
    ).all()
    u = principal.user
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "organisations": [{"id": i, "name": n, "role": r} for i, n, r in rows],
        "created_at": ts(u.created_at),
        "last_login_at": ts(u.last_login_at),
    }


REVERIFY_MAX_AGE_MINUTES = 10
# The shape @clerk/shared's isReverificationHint() detects; useReverification() then opens
# Clerk's verification modal and retries the request.
CLERK_REVERIFICATION_HINT: dict[str, Any] = {
    "clerk_error": {
        "type": "forbidden",
        "reason": "reverification-error",
        "metadata": {
            "reverification": {"level": "first_factor", "afterMinutes": REVERIFY_MAX_AGE_MINUTES}
        },
    }
}


class ReverificationRequired(DomainError):
    code, status, message = (
        ErrorCode.REVERIFICATION_REQUIRED,
        403,
        "Confirm it's you to continue: verify your sign-in again, then retry.",
    )


def require_recent_verification(principal: Principal) -> None:
    """Clerk session tokens (v2) carry ``fva = [first_factor_age, second_factor_age]`` in minutes,
    ``-1`` meaning never. Dev sign-in (no Clerk claims) is development-only and skips this."""
    if principal.claims is None:
        return
    fva = principal.claims.get("fva")
    age = fva[0] if isinstance(fva, list) and len(fva) == 2 else None
    fresh = isinstance(age, int) and not isinstance(age, bool)
    if not fresh or not 0 <= age <= REVERIFY_MAX_AGE_MINUTES:  # type: ignore[operator]
        raise ReverificationRequired(extra_body=CLERK_REVERIFICATION_HINT)


class DeleteAccountRequest(RequestModel):
    confirm_email: str


class SoleAdminBlocked(DomainError):
    code, status, message = (
        ErrorCode.LAST_ADMIN_REMOVAL,
        409,
        "You are the only administrator of an organisation. Promote someone else first.",
    )


@router.delete(
    "/me", status_code=204, summary="Delete my account (anonymise and revoke everything)"
)
async def delete_me(
    body: DeleteAccountRequest,
    request: Request,
    background: BackgroundTasks,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """USER_JOURNEYS J11. Requires the typed account email AND, for Clerk sessions, a first-factor
    verification in the last ``REVERIFY_MAX_AGE_MINUTES`` (AUTHENTICATION_AUTHORIZATION.md)."""
    require_recent_verification(principal)
    user = principal.user
    if body.confirm_email.strip().lower() != user.email.lower():
        raise ValidationFailed(details=[{"field": "confirm_email", "issue": "mismatch"}])
    blocked = await sole_admin_orgs(db, user.id)
    if blocked:
        raise SoleAdminBlocked(
            details=[{"organisation_id": o.organisation_id, "name": o.name} for o in blocked]
        )
    summary = await anonymise_user(db, user, source="self", principal=principal, request=request)
    await db.commit()
    background.add_task(
        delete_clerk_user, request.app.state.settings, str(summary["clerk_user_id"])
    )
    return Response(status_code=204)


@router.post("/logout", status_code=204, summary="Audit a sign-out (Clerk revokes the session)")
async def logout(
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind=principal.actor_kind,
            action="auth.logout",
            request_id=request.state.request_id if hasattr(request.state, "request_id") else None,
        )
    )
    await db.commit()
    return Response(status_code=204)


@router.post(
    "/extension/pair", status_code=201, response_model=PairResponse, summary="Create a pairing code"
)
async def pair(
    body: PairRequest,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(rate_limit("pair")),
) -> Any:
    code = new_pairing_code()
    expires = utcnow() + PAIRING_TTL
    db.add(
        PairingCode(
            id=new_ulid(),
            user_id=principal.user.id,
            code_hash=sha256_hex(code),
            device_name=body.device_name,
            expires_at=expires,
        )
    )
    await db.commit()
    return {"code": code, "expires_at": ts(expires), "expires_in": int(PAIRING_TTL.total_seconds())}


@router.post(
    "/extension/exchange",
    status_code=201,
    response_model=ExchangeResponse,
    summary="Exchange a pairing code for a device token",
)
async def exchange(
    request: Request, body: ExchangeRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    digest = sha256_hex(normalise_pairing_code(body.code))
    row = (
        await db.execute(select(PairingCode).where(PairingCode.code_hash == digest))
    ).scalar_one_or_none()
    now = utcnow()
    if row is None or row.consumed_at is not None:
        raise InvalidPairingCode()
    if row.expires_at < now:
        raise PairingCodeExpired()
    # Single use: consume atomically so two concurrent exchanges cannot both succeed.
    consumed = await db.execute(
        update(PairingCode)
        .where(PairingCode.id == row.id, PairingCode.consumed_at.is_(None))
        .values(consumed_at=now)
    )
    if consumed.rowcount != 1:
        raise InvalidPairingCode()
    secret, prefix = new_secret("tl_ext_")
    device = ApiKey(
        id=new_ulid(),
        user_id=row.user_id,
        kind="extension_device",
        name=body.device_name or row.device_name or "Browser extension",
        prefix=prefix,
        secret_hash=sha256_hex(secret),
        scopes=list(DEVICE_SCOPES),
        expires_at=now + DEVICE_TTL,
    )
    db.add(device)
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=row.user_id,
            actor_kind="extension",
            action="device.pair",
            target_type="api_key",
            target_id=device.id,
        )
    )
    await db.commit()
    return {"device_token": secret, "device_id": device.id, "expires_at": ts(device.expires_at)}


@router.get("/extension/devices", response_model=DeviceList, summary="List paired devices")
async def devices(
    principal: Principal = Depends(require_human), db: AsyncSession = Depends(get_db)
) -> Any:
    rows = (
        await db.execute(
            select(ApiKey)
            .where(
                ApiKey.user_id == principal.user.id,
                ApiKey.kind == "extension_device",
                ApiKey.revoked_at.is_(None),
            )
            .order_by(ApiKey.created_at.desc())
        )
    ).scalars()
    return {
        "data": [
            {
                "id": d.id,
                "name": d.name,
                "last_used_at": ts(d.last_used_at),
                "created_at": ts(d.created_at),
                "expires_at": ts(d.expires_at),
            }
            for d in rows
        ]
    }


@router.delete("/extension/devices/{device_id}", status_code=204, summary="Revoke a device")
async def revoke_device(
    device_id: str,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Response:
    device = await db.get(ApiKey, device_id)
    if device is None or device.user_id != principal.user.id or device.kind != "extension_device":
        raise NotFound()
    device.revoked_at = utcnow()
    db.add(
        AuditLog(
            id=new_ulid(),
            actor_user_id=principal.user.id,
            actor_kind="user",
            action="device.revoke",
            target_type="api_key",
            target_id=device.id,
        )
    )
    await db.commit()
    return Response(status_code=204)
