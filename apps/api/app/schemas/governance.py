"""Organisation governance wire shapes (API_ENDPOINTS.md §7–§10, §16).

snake_case only (ADR-007). Request models forbid unknown fields (API_CONTRACTS.md §13).
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import PageInfo, RequestModel, WireModel
from app.schemas.resources import RecipientOut

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
# DATABASE_DESIGN.md §4.1. ``fintech`` profiles need operator review before publishing (§8).
SECTORS = ("education", "fintech", "ecommerce", "government", "other")

OrgStatus = Literal["draft", "active", "suspended"]
LoginHostsMode = Literal["domain_wildcard", "explicit_only"]
DomainKind = Literal["official", "login", "application", "payment"]
OrgRole = Literal["org_admin", "org_member"]
VerificationMethod = Literal["dns_txt", "http_file"]


def _email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise ValueError("invalid_email")
    return value


def _country(value: str | None) -> str | None:
    return value.upper() if value else value


def _sector(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip().lower()
    if value not in SECTORS:
        raise ValueError(f"sector must be one of: {', '.join(SECTORS)}")
    return value


# ── Organisations ───────────────────────────────────────────────────────────────
class OrganisationCreate(RequestModel):
    name: Annotated[str, Field(min_length=2, max_length=120)]
    legal_name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    country: Annotated[str, Field(pattern=r"^[A-Za-z]{2}$")] | None = None
    sector: str | None = None
    support_email: str | None = None

    _country = field_validator("country")(_country)
    _sector = field_validator("sector")(_sector)
    _support_email = field_validator("support_email")(_email)


class OrganisationUpdate(RequestModel):
    """PATCH: only fields present are changed. ``status`` is the publish/suspend action."""

    name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    legal_name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    country: Annotated[str, Field(pattern=r"^[A-Za-z]{2}$")] | None = None
    sector: str | None = None
    support_email: str | None = None
    brand_tokens: Annotated[list[str], Field(max_length=20)] | None = None
    logo_phash: Annotated[str, Field(pattern=r"^[0-9a-fA-F]{16}$")] | None = None
    login_hosts_mode: LoginHostsMode | None = None
    status: OrgStatus | None = None

    _country = field_validator("country")(_country)
    _sector = field_validator("sector")(_sector)
    _support_email = field_validator("support_email")(_email)

    @field_validator("brand_tokens")
    @classmethod
    def _tokens(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        out: list[str] = []
        for token in v:
            t = token.strip().lower()
            if not 2 <= len(t) <= 40:
                raise ValueError("each brand token must be 2-40 characters")
            if t not in out:
                out.append(t)
        return out

    @field_validator("logo_phash")
    @classmethod
    def _phash(cls, v: str | None) -> str | None:
        return v.lower() if v else v


class DomainOut(WireModel):
    id: str
    domain: str
    kind: str
    status: str
    verified_at: str | None
    expires_at: str | None
    verification_method: str | None


class DomainList(WireModel):
    data: list[DomainOut]


class OrganisationDetail(WireModel):
    id: str
    name: str
    legal_name: str | None
    country: str | None
    sector: str | None
    support_email: str | None
    status: str
    brand_tokens: list[str]
    logo_phash: str | None
    login_hosts_mode: str
    simulated: bool
    role: str | None = Field(description="The caller's organisation role; null for staff access.")
    domains: list[DomainOut]
    recipients: list[RecipientOut]
    created_at: str
    updated_at: str


# ── Domains ─────────────────────────────────────────────────────────────────────
class DomainCreate(RequestModel):
    domain: Annotated[str, Field(min_length=3, max_length=253)]
    kind: DomainKind = "official"


class Challenge(WireModel):
    method: str
    expires_at: str
    record_name: str | None = None
    record_type: str | None = None
    record_value: str | None = None
    url: str | None = None
    file_content: str | None = None


class DomainChallengeOut(DomainOut):
    challenges: list[Challenge]


class DomainVerifyRequest(RequestModel):
    method: VerificationMethod


class DomainVerifyOut(WireModel):
    id: str
    domain: str
    status: Literal["verified"]
    verification_method: str
    verified_at: str
    expires_at: str
    evidence_id: str


# ── Members and invites ─────────────────────────────────────────────────────────
class MemberOut(WireModel):
    user_id: str
    email: str
    display_name: str
    role: str
    created_at: str


class InviteOut(WireModel):
    id: str
    email: str
    role: str
    expires_at: str
    created_at: str
    invited_by: str | None


class MemberList(WireModel):
    data: list[MemberOut]
    invites: list[InviteOut] = Field(
        description="Open (unaccepted, unexpired) invites; org admins and operators only."
    )


class MemberInvite(RequestModel):
    email: str
    role: OrgRole = "org_member"

    @field_validator("email")
    @classmethod
    def _invite_email(cls, v: str) -> str:
        return _email(v) or v


class InviteCreated(WireModel):
    invite_id: str
    email: str
    role: str
    expires_at: str
    delivery: Literal["email", "logged", "not_configured", "failed"]
    accept_url: str | None = Field(
        default=None,
        description="Returned only when the email was not delivered, so an admin can share it.",
    )


class MemberRoleUpdate(RequestModel):
    role: OrgRole


class InviteAccepted(WireModel):
    organisation_id: str
    organisation_name: str
    role: str


# ── Audit logs ──────────────────────────────────────────────────────────────────
class AuditLogOut(WireModel):
    id: str
    actor_user_id: str | None
    actor_email: str | None
    actor_kind: str
    action: str
    target_type: str | None
    target_id: str | None
    organisation_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    request_id: str | None
    created_at: str


class AuditLogList(WireModel):
    data: list[AuditLogOut]
    page: PageInfo
