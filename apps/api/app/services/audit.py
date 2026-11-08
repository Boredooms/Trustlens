"""Audit trail writer (ORGANISATION_TRUST_PROFILES.md §7, AUTHENTICATION_AUTHORIZATION.md §10).

``record`` adds an ``audit_logs`` row to the caller's session **without committing**: the row is
written in the same transaction as the state change it describes, so a change without its audit row
(or an audit row without its change) cannot happen. ``before``/``after`` are redacted here, once,
so callers cannot forget. The table is append-only: the application never updates or deletes it.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.logging import request_id_var
from app.models.tables import AuditLog
from app.security.auth import Principal
from app.security.redaction import redact
from app.utils import new_ulid

ACTOR_KINDS = ("user", "api_key", "extension", "system")


def hash_ip(request: Request | None) -> str | None:
    """Keyed hash of the client IP (never the raw IP). ``None`` without ``IP_HASH_SALT``."""
    if request is None or request.client is None:
        return None
    salt = getattr(request.app.state.settings, "ip_hash_salt", None)
    if salt is None or not salt.get_secret_value():
        return None
    key = salt.get_secret_value().encode()
    return hmac.new(key, request.client.host.encode(), hashlib.sha256).hexdigest()


def record(
    db: AsyncSession,
    *,
    action: str,
    principal: Principal | None = None,
    actor_kind: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    organisation_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditLog:
    """Stage one audit row in ``db`` (no commit). Returns the row.

    ``actor_kind`` defaults to the principal's kind, or ``"system"`` when there is no principal
    (jobs, seeds). ``before``/``after`` are redacted before storage.
    """
    kind = actor_kind or (principal.kind if principal is not None else "system")
    if kind not in ACTOR_KINDS:
        raise ValueError(f"unknown actor_kind {kind!r}")
    row = AuditLog(
        id=new_ulid(),
        actor_user_id=principal.user.id if principal is not None else None,
        actor_kind=kind,
        action=action,
        target_type=target_type,
        target_id=target_id,
        organisation_id=organisation_id,
        before=redact(before) if before is not None else None,
        after=redact(after) if after is not None else None,
        ip_hash=hash_ip(request),
        request_id=request_id_var.get(),
    )
    db.add(row)
    return row
