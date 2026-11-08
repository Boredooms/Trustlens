"""Small shared helpers: ULIDs and UTC time (ADR-009, API_CONTRACTS.md §3)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from ulid import ULID

ULID_PATTERN = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def new_ulid() -> str:
    return str(ULID())


def is_ulid(value: str) -> bool:
    return bool(ULID_PATTERN.match(value))


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso_z(moment: datetime) -> str:
    """ISO-8601 UTC with a trailing ``Z`` and second precision, e.g. 2026-11-07T09:14:22Z."""
    return moment.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
