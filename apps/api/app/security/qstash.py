"""Upstash QStash request signatures (BACKEND_OVERVIEW.md §9.3, HOSTED_SERVICES.md).

QStash signs every delivery with a JWT in the ``Upstash-Signature`` header: HS256 with the current
signing key (the next key during rotation), claims ``iss = "Upstash"``, ``sub`` = the destination
URL, ``exp``/``nbf``, and ``body`` = base64url(SHA-256(raw request body)). All of it is checked;
a request that fails any check is rejected before the job runs.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Any
from urllib.parse import urlsplit

from jose import jwt
from jose.exceptions import JWTError

from app.config import Settings
from app.errors import Unauthenticated

ISSUER = "Upstash"
LEEWAY_S = 30


class InvalidSignature(Unauthenticated):
    message = "The request signature is not valid."


def body_hash(body: bytes) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(body).digest()).decode().rstrip("=")


def _claims(token: str, key: str) -> dict[str, Any] | None:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=["HS256"],
            issuer=ISSUER,
            options={"verify_aud": False, "leeway": LEEWAY_S, "require_exp": True},
        )
    except JWTError:
        return None
    return claims


def _same_url(signed: str, received: str) -> bool:
    """Host + path + query must match. The scheme is ignored: behind Render's TLS-terminating proxy
    the app sees ``http`` while QStash signed the public ``https`` URL."""
    a, b = urlsplit(signed), urlsplit(received)
    return (
        a.netloc.lower() == b.netloc.lower()
        and (a.path.rstrip("/") or "/") == (b.path.rstrip("/") or "/")
        and a.query == b.query
    )


def verify(token: str | None, body: bytes, url: str, settings: Settings) -> dict[str, Any]:
    """Return the verified claims or raise ``InvalidSignature``."""
    if not token:
        raise InvalidSignature()
    keys = [
        k.get_secret_value()
        for k in (settings.qstash_current_signing_key, settings.qstash_next_signing_key)
        if k is not None and k.get_secret_value()
    ]
    if not keys:
        raise InvalidSignature("Scheduled jobs are not configured on this deployment.")
    for key in keys:
        claims = _claims(token, key)
        if claims is None:
            continue
        if "nbf" not in claims:
            raise InvalidSignature()
        if not _same_url(str(claims.get("sub", "")), url):
            raise InvalidSignature()
        expected = body_hash(body)
        if not hmac.compare_digest(str(claims.get("body", "")).rstrip("="), expected):
            raise InvalidSignature()
        return claims
    raise InvalidSignature()
