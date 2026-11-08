"""Redact secrets before anything is stored as evidence (DATABASE_DESIGN.md §12).

Belt and braces: collectors never read form values, but evidence payloads may still carry URLs with
tokens in query strings or text that looks like a card number. Those are scrubbed here.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SENSITIVE_KEYS = re.compile(
    r"(pass(word)?|pwd|otp|pin|cvv|cvc|card|token|secret|session|cookie|auth|api[_-]?key)", re.I
)
_BEARER = re.compile(r"(?i)bearer\s+[a-z0-9._\-]+")
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_KV = re.compile(r"(?i)\b(password|passwd|pwd|otp|token|secret)=([^&\s]+)")


def _redact_url(value: str) -> str:
    try:
        parts = urlsplit(value)
    except ValueError:
        return value
    if not parts.scheme or not parts.query:
        return value
    query = [
        (k, "[redacted]" if _SENSITIVE_KEYS.search(k) else v) for k, v in parse_qsl(parts.query)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def redact_text(value: str) -> str:
    value = _BEARER.sub("Bearer [redacted]", value)
    value = _KV.sub(lambda m: f"{m.group(1)}=[redacted]", value)
    value = _CARD.sub("[redacted-number]", value)
    if value.startswith(("http://", "https://")):
        value = _redact_url(value)
    return value


def redact(payload: Any) -> Any:
    if isinstance(payload, dict):
        return {
            k: "[redacted]" if _SENSITIVE_KEYS.search(str(k)) and isinstance(v, str) else redact(v)
            for k, v in payload.items()
        }
    if isinstance(payload, list):
        return [redact(v) for v in payload]
    if isinstance(payload, str):
        return redact_text(payload)
    return payload
