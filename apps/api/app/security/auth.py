"""Authentication: Clerk session JWTs (humans), API keys and device tokens (machines) — ADR-012.

Owner document: docs/03-backend/AUTHENTICATION_AUTHORIZATION.md.

- Clerk JWT: verified locally against JWKS (cached 1 h); RS256/ES256 only; ``iss`` must equal
  CLERK_ISSUER and ``azp`` must equal CLERK_AUTHORIZED_PARTY; ``exp``/``nbf`` with 30 s leeway. No
  role/email claims are trusted — ``users.role`` is ours.
- ``tl_live_…`` / ``tl_ext_…``: SHA-256 of the full secret, unique-indexed, revocation checked on
  every request.
- ``dev:<email>:<role>``: development-only stand-in for Clerk when DEV_AUTH_ENABLED=true; startup
  refuses that flag in production (config.py).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import InvalidApiKey, InvalidToken, Unauthenticated
from app.logging import get_logger
from app.models.tables import ApiKey, User
from app.utils import new_ulid, utcnow

log = get_logger("auth")

ALLOWED_ALGORITHMS = ["RS256", "ES256"]
JWKS_TTL_S = 3600
DEV_ROLES = ("user", "analyst", "operator")
PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # unambiguous: no 0/O/1/I/L

USER_SCOPES: None = None  # a human session is not scope-limited (roles apply instead)
DEVICE_SCOPES = ["assess:read", "reports:write"]
API_KEY_SCOPES = {
    "assess:read",
    "scan:write",
    "reports:write",
    "identity:read",
    "payments:read",
    "investigations:read",
    "investigations:write",
}


@dataclass(frozen=True)
class Principal:
    user: User
    kind: str  # "user" | "api_key" | "extension"
    scopes: tuple[str, ...] | None  # None: human session (role-governed)
    key_id: str | None = None
    # Verified Clerk session claims (None for dev sign-in, API keys and devices).
    claims: dict[str, Any] | None = field(default=None, compare=False, hash=False)

    @property
    def actor_kind(self) -> str:
        return self.kind

    def has_scope(self, scope: str) -> bool:
        return self.scopes is None or scope in self.scopes

    @property
    def is_analyst(self) -> bool:
        return self.kind == "user" and self.user.role in ("analyst", "operator")

    @property
    def is_operator(self) -> bool:
        return self.kind == "user" and self.user.role == "operator"


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_secret(prefix: str) -> tuple[str, str]:
    """Return (full_secret, visible_prefix). The secret is shown once and stored only as a hash."""
    ident = secrets.token_hex(4)
    secret = f"{prefix}{ident}_{secrets.token_urlsafe(24)}"
    return secret, f"{prefix}{ident}"


def new_pairing_code() -> str:
    raw = "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalise_pairing_code(code: str) -> str:
    cleaned = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{cleaned[:4]}-{cleaned[4:]}" if len(cleaned) == 8 else cleaned


class JwksCache:
    def __init__(self) -> None:
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0

    async def get(self, url: str, kid: str, *, refresh: bool = False) -> dict[str, Any] | None:
        stale = time.monotonic() - self._fetched_at > JWKS_TTL_S
        if refresh or stale or kid not in self._keys:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                self._keys = {k["kid"]: k for k in resp.json().get("keys", []) if "kid" in k}
                self._fetched_at = time.monotonic()
        return self._keys.get(kid)


JWKS = JwksCache()


async def verify_clerk_jwt(token: str, settings: Settings) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise InvalidToken() from None
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        raise InvalidToken()
    kid = header.get("kid")
    if not kid:
        raise InvalidToken()
    try:
        key = await JWKS.get(settings.clerk_jwks_url, kid)
    except httpx.HTTPError:
        log.warning("auth.jwks_unavailable")
        raise InvalidToken("We could not verify your session right now. Try again.") from None
    if key is None:
        raise InvalidToken()
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            issuer=settings.clerk_issuer,
            options={"verify_aud": False, "leeway": 30},
        )
    except JWTError:
        raise InvalidToken() from None
    if claims.get("azp") != settings.clerk_authorized_party:
        log.warning("auth.azp_mismatch")
        raise InvalidToken()
    if not claims.get("sub"):
        raise InvalidToken()
    return claims


async def _upsert_user(
    db: AsyncSession, external_id: str, email: str, display_name: str, role: str | None = None
) -> User:
    user = (
        await db.execute(select(User).where(User.clerk_user_id == external_id))
    ).scalar_one_or_none()
    now = utcnow()
    if user is None:
        user = User(
            id=new_ulid(),
            clerk_user_id=external_id,
            email=email,
            display_name=display_name[:80] if len(display_name) >= 2 else "TrustLens user",
            role=role or "user",
            email_verified_at=now,
            last_login_at=now,
        )
        db.add(user)
        await db.flush()
    else:
        if user.last_login_at is None or now - user.last_login_at > timedelta(minutes=5):
            user.last_login_at = now
        if role is not None and user.role != role:
            user.role = role
    if not user.is_active:
        raise Unauthenticated()
    return user


async def authenticate(db: AsyncSession, token: str, settings: Settings) -> Principal:
    if token.startswith(("tl_live_", "tl_ext_")):
        return await _authenticate_key(db, token)
    if token.startswith("dev:"):
        if not settings.dev_auth_enabled or settings.is_production:
            raise InvalidToken()
        parts = token.split(":")
        if len(parts) != 3 or parts[2] not in DEV_ROLES or "@" not in parts[1]:
            raise InvalidToken()
        email, role = parts[1].lower(), parts[2]
        user = await _upsert_user(db, f"dev_{email}", email, email.split("@")[0].title(), role)
        return Principal(user=user, kind="user", scopes=USER_SCOPES)
    claims = await verify_clerk_jwt(token, settings)
    sub = str(claims["sub"])
    email = str(claims.get("email") or f"{sub}{CLERK_PLACEHOLDER_DOMAIN}")
    user = await _upsert_user(db, sub, email, str(claims.get("name") or email.split("@")[0]))
    if user.email.endswith(CLERK_PLACEHOLDER_DOMAIN):
        # Clerk's default session token carries no email/name. Fill them once from the Backend
        # API; steady-state requests never reach this branch (no extra round trip).
        profile = await _clerk_profile(sub, settings)
        if profile is not None:
            user.email, user.display_name = profile
    return Principal(user=user, kind="user", scopes=USER_SCOPES, claims=claims)


CLERK_PLACEHOLDER_DOMAIN = "@users.clerk"
CLERK_API = "https://api.clerk.com/v1"


async def _clerk_profile(sub: str, settings: Settings) -> tuple[str, str] | None:
    """Primary email and display name from Clerk's Backend API; ``None`` on any failure."""
    if settings.clerk_secret_key is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{CLERK_API}/users/{sub}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key.get_secret_value()}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        log.warning("auth.clerk_profile_unavailable")
        return None
    primary = data.get("primary_email_address_id")
    email = next(
        (e["email_address"] for e in data.get("email_addresses", []) if e.get("id") == primary),
        None,
    )
    if not email:
        return None
    name = " ".join(p for p in (data.get("first_name"), data.get("last_name")) if p)
    name = name or data.get("username") or email.split("@")[0]
    return email.lower(), name[:80] if len(name) >= 2 else "TrustLens user"


async def _authenticate_key(db: AsyncSession, token: str) -> Principal:
    digest = sha256_hex(token)
    key = (
        await db.execute(select(ApiKey).where(ApiKey.secret_hash == digest))
    ).scalar_one_or_none()
    if key is None or not hmac.compare_digest(key.secret_hash, digest):
        raise InvalidApiKey()
    now = utcnow()
    if key.revoked_at is not None or (key.expires_at is not None and key.expires_at < now):
        raise InvalidApiKey()
    expected_prefix = "tl_ext_" if key.kind == "extension_device" else "tl_live_"
    if not token.startswith(expected_prefix):
        raise InvalidApiKey()
    user = await db.get(User, key.user_id)
    if user is None or not user.is_active:
        raise InvalidApiKey()
    if key.last_used_at is None or now - key.last_used_at > timedelta(minutes=1):
        await db.execute(update(ApiKey).where(ApiKey.id == key.id).values(last_used_at=now))
    kind = "extension" if key.kind == "extension_device" else "api_key"
    return Principal(user=user, kind=kind, scopes=tuple(key.scopes), key_id=key.id)
