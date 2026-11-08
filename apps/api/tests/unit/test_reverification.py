"""Clerk re-verification gate for account deletion (AUTHENTICATION_AUTHORIZATION.md)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from starlette.requests import Request

from app.api.handlers import envelope
from app.api.routes.auth import (
    CLERK_REVERIFICATION_HINT,
    REVERIFY_MAX_AGE_MINUTES,
    ReverificationRequired,
    require_recent_verification,
)
from app.security.auth import Principal


def principal(claims: dict[str, Any] | None) -> Principal:
    user = SimpleNamespace(id="u1", role="user", email="a@example.com")
    return Principal(user=user, kind="user", scopes=None, claims=claims)  # type: ignore[arg-type]


@pytest.mark.parametrize("fva", [[0, -1], [5, -1], [REVERIFY_MAX_AGE_MINUTES, 3]])
def test_recent_first_factor_passes(fva: list[int]) -> None:
    require_recent_verification(principal({"sub": "user_1", "fva": fva}))


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "user_1", "fva": [REVERIFY_MAX_AGE_MINUTES + 1, -1]},  # stale
        {"sub": "user_1", "fva": [-1, -1]},  # never verified in this session
        {"sub": "user_1"},  # session token without fva (old token version)
        {"sub": "user_1", "fva": "5"},  # malformed
        {"sub": "user_1", "fva": [True, -1]},  # bool is not an age
        {"sub": "user_1", "fva": [3]},  # wrong arity
    ],
)
def test_stale_missing_or_malformed_requires_reverification(claims: dict[str, Any]) -> None:
    with pytest.raises(ReverificationRequired) as exc:
        require_recent_verification(principal(claims))
    assert exc.value.status == 403
    assert exc.value.extra_body == CLERK_REVERIFICATION_HINT


def test_dev_and_machine_principals_skip_the_check() -> None:
    require_recent_verification(principal(None))


def test_envelope_carries_clerk_hint_at_top_level() -> None:
    request = Request({"type": "http", "app": FastAPI(), "headers": [], "method": "DELETE"})
    resp = envelope(request, ReverificationRequired(extra_body=CLERK_REVERIFICATION_HINT))
    import json

    body = json.loads(bytes(resp.body))
    assert resp.status_code == 403
    assert body["error"]["code"] == "REVERIFICATION_REQUIRED"
    # Exactly what @clerk/shared isReverificationHint() checks.
    hint = body["clerk_error"]
    assert hint["type"] == "forbidden"
    assert hint["reason"] == "reverification-error"
    assert hint["metadata"]["reverification"] == {
        "level": "first_factor",
        "afterMinutes": REVERIFY_MAX_AGE_MINUTES,
    }
