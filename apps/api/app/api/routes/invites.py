"""Accept an organisation invite (API_ENDPOINTS.md §10).

``POST /api/v1/invites/{token}/accept``: the signed-in user whose email matches the invite becomes a
member with the invited role. The token is 256 random bits, stored only as a SHA-256 hash, single
use, and expires after 7 days. An unknown or already-used token is indistinguishable (404).
"""

from __future__ import annotations

import hashlib
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_human
from app.errors import DomainError
from app.models.tables import Organisation, OrganisationInvite, OrganisationMember
from app.schemas.common import ERROR_RESPONSES
from app.schemas.enums import ErrorCode
from app.schemas.governance import InviteAccepted
from app.security.auth import Principal
from app.services import audit
from app.utils import new_ulid, utcnow

router = APIRouter(prefix="/api/v1/invites", tags=["organisations"], responses=ERROR_RESPONSES)


class InviteNotFound(DomainError):
    code, status, message = (
        ErrorCode.INVITE_NOT_FOUND,
        404,
        "This invite link is not valid or has already been used.",
    )


class InviteExpired(DomainError):
    code, status, message = (
        ErrorCode.INVITE_EXPIRED,
        410,
        "This invite has expired. Ask an administrator to send a new one.",
    )


class InviteEmailMismatch(DomainError):
    code, status, message = (
        ErrorCode.INVITE_EMAIL_MISMATCH,
        403,
        "This invite was sent to a different email address. Sign in with that address to accept.",
    )


@router.post(
    "/{token}/accept",
    response_model=InviteAccepted,
    summary="Accept an organisation invite (signed-in user's email must match)",
)
async def accept_invite(
    token: str,
    request: Request,
    principal: Principal = Depends(require_human),
    db: AsyncSession = Depends(get_db),
) -> Any:
    if not 20 <= len(token) <= 128:
        raise InviteNotFound()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invite = (
        await db.execute(
            select(OrganisationInvite)
            .where(OrganisationInvite.token_hash == token_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if invite is None or invite.accepted_at is not None:
        raise InviteNotFound()
    if invite.expires_at <= utcnow():
        raise InviteExpired()
    if invite.email.lower() != principal.user.email.lower():
        raise InviteEmailMismatch()
    org = await db.get(Organisation, invite.organisation_id)
    if org is None:
        raise InviteNotFound()
    existing = (
        await db.execute(
            select(OrganisationMember).where(
                OrganisationMember.organisation_id == org.id,
                OrganisationMember.user_id == principal.user.id,
            )
        )
    ).scalar_one_or_none()
    role = existing.role if existing is not None else invite.role
    if existing is None:
        db.add(
            OrganisationMember(
                id=new_ulid(), organisation_id=org.id, user_id=principal.user.id, role=role
            )
        )
    invite.accepted_at = utcnow()
    audit.record(
        db,
        action="org.member.join",
        principal=principal,
        target_type="organisation_member",
        target_id=principal.user.id,
        organisation_id=org.id,
        after={"role": role, "invite_id": invite.id, "already_member": existing is not None},
        request=request,
    )
    org_id, org_name = org.id, org.name
    await db.commit()
    return {"organisation_id": org_id, "organisation_name": org_name, "role": role}
