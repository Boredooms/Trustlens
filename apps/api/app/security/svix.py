"""Svix webhook signature verification (Clerk webhooks), no third-party dependency.

Signed content is ``{svix-id}.{svix-timestamp}.{raw body}``; the key is the base64 part of the
``whsec_...`` secret; ``svix-signature`` holds space-separated ``v1,<base64 HMAC-SHA256>`` entries
(several during secret rotation). Timestamps outside a 5-minute window are rejected (replay).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import time

TOLERANCE_S = 300


class InvalidSignature(Exception):
    pass


def _key(secret: str) -> bytes:
    raw = secret.removeprefix("whsec_")
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidSignature("malformed secret") from exc


def sign(secret: str, msg_id: str, timestamp: int, body: bytes) -> str:
    """The ``v1,<sig>`` value Svix would send (used by tests and checks)."""
    signed = f"{msg_id}.{timestamp}.".encode() + body
    digest = hmac.new(_key(secret), signed, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


def verify(
    secret: str,
    *,
    msg_id: str | None,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    now: float | None = None,
) -> None:
    """Raise :class:`InvalidSignature` unless one ``v1`` signature matches within tolerance."""
    if not msg_id or not timestamp or not signature:
        raise InvalidSignature("missing headers")
    try:
        ts = int(timestamp)
    except ValueError as exc:
        raise InvalidSignature("bad timestamp") from exc
    current = time.time() if now is None else now
    if abs(current - ts) > TOLERANCE_S:
        raise InvalidSignature("timestamp outside tolerance")
    expected = sign(secret, msg_id, ts, body).split(",", 1)[1]
    for part in signature.split():
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):
            return
    raise InvalidSignature("no matching signature")
