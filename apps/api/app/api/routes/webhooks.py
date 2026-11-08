"""Clerk webhooks (AUTHENTICATION_AUTHORIZATION.md: optional user sync via Svix).

The signature is verified over the raw body BEFORE any parsing. Lazy upsert on sign-in stays the
fallback, so a missed webhook only delays the email/name sync.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.errors import DomainError, InvalidToken, NotReady
from app.logging import get_logger
from app.models.tables import User
from app.schemas.enums import ErrorCode
from app.security import svix
from app.services.accounts import anonymise_user
from app.utils import new_ulid, utcnow

router = APIRouter(prefix="/webhooks", include_in_schema=False)
log = get_logger("webhooks")
MAX_BODY = 256 * 1024


class BadPayload(DomainError):
    code, status, message = ErrorCode.MALFORMED_JSON, 400, "The webhook body is not valid JSON."


def _profile(data: dict[str, Any]) -> tuple[str | None, str]:
    primary = data.get("primary_email_address_id")
    email = next(
        (
            e.get("email_address")
            for e in data.get("email_addresses") or []
            if isinstance(e, dict) and e.get("id") == primary
        ),
        None,
    )
    name = " ".join(p for p in (data.get("first_name"), data.get("last_name")) if p)
    name = name or data.get("username") or (email.split("@")[0] if email else "TrustLens user")
    return (email.lower() if email else None), str(name)[:80]


@router.post("/clerk", status_code=204)
async def clerk_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    settings = request.app.state.settings
    secret = settings.clerk_webhook_secret
    if secret is None or not secret.get_secret_value():
        raise NotReady("Clerk webhooks are not configured on this deployment.")
    body = await request.body()
    try:
        svix.verify(
            secret.get_secret_value(),
            msg_id=request.headers.get("svix-id"),
            timestamp=request.headers.get("svix-timestamp"),
            signature=request.headers.get("svix-signature"),
            body=body[: MAX_BODY + 1],
        )
    except svix.InvalidSignature:
        log.warning("webhook.clerk_bad_signature")
        raise InvalidToken("The webhook signature is not valid.") from None
    try:
        event = json.loads(body)
    except ValueError:
        raise BadPayload() from None
    kind = str(event.get("type", ""))
    data = event.get("data") or {}
    sub = str(data.get("id") or "")
    if not sub:
        return Response(status_code=204)
    user = (await db.execute(select(User).where(User.clerk_user_id == sub))).scalar_one_or_none()
    if kind in ("user.created", "user.updated"):
        email, name = _profile(data)
        if user is None:
            if email is None:
                return Response(status_code=204)
            now = utcnow()
            db.add(
                User(
                    id=new_ulid(),
                    clerk_user_id=sub,
                    email=email,
                    display_name=name if len(name) >= 2 else "TrustLens user",
                    role="user",
                    email_verified_at=now,
                )
            )
        elif user.is_active:
            if email:
                user.email = email
            user.display_name = name if len(name) >= 2 else user.display_name
        await db.commit()
    elif kind == "user.deleted":
        if user is not None and user.is_active:
            # Clerk already deleted the identity: no last-admin gate, no Clerk API call. Orphaned
            # organisations are logged and listed on the audit row for an operator to resolve.
            await anonymise_user(db, user, source="clerk_webhook", request=request)
            await db.commit()
    log.info("webhook.clerk", extra={"type": kind})
    return Response(status_code=204)
