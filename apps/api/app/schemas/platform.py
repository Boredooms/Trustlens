"""Wire models for the platform endpoints: inspect-redirect, appeals, certificate detail and
monitors, usage (API_ENDPOINTS.md §6, §11, §13, §15). snake_case only (ADR-007)."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.schemas.common import PageInfo, RequestModel, WireModel
from app.schemas.resources import CertificateOut, MonitorOut, Ulid, Url

Domain = Annotated[str, Field(min_length=3, max_length=253)]
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,253}\.[A-Za-z]{2,63}$")


# ── inspect-redirect (§6) ───────────────────────────────────────────────────────
class InspectRedirectRequest(RequestModel):
    url: Url
    max_hops: Annotated[int, Field(ge=1, le=10)] = 10


class RedirectHop(WireModel):
    url: str
    status: int
    location: str | None
    elapsed_ms: int


class BlockedHop(WireModel):
    url: str
    reason: str


class InspectRedirectResponse(WireModel):
    final_url: str
    cross_domain: bool
    loop_detected: bool
    hops: list[RedirectHop]
    blocked_hop: BlockedHop | None
    simulated: bool = False


# ── Appeals (§11) ───────────────────────────────────────────────────────────────
class AppealCreate(RequestModel):
    domain: Domain
    email: Annotated[str, Field(min_length=6, max_length=254)]
    message: Annotated[str, Field(min_length=10, max_length=2000)]
    challenge_method: Literal["dns_txt", "http_file"] = "dns_txt"

    @field_validator("domain")
    @classmethod
    def _domain(cls, value: str) -> str:
        return value.strip().lower().rstrip(".")

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        if not _EMAIL.match(value):
            raise ValueError("invalid_email")
        return value.lower()


class AppealChallenge(WireModel):
    method: Literal["dns_txt", "http_file"]
    # dns_txt: TXT record name/value. http_file: the URL to serve and the exact file body.
    record_name: str
    record_type: Literal["TXT", "FILE"]
    record_value: str
    expires_at: str
    instructions: str


class AppealCreated(WireModel):
    appeal_id: str
    status: str
    challenge: AppealChallenge


class AppealVerifyResult(WireModel):
    appeal_id: str
    status: str
    verified: bool
    attempts: int
    message: str


class AppealReviewRequest(RequestModel):
    action: Literal["approve", "reject"]
    reason: Annotated[str, Field(min_length=10, max_length=1000)]


class AppealOut(WireModel):
    id: str
    domain: str
    email: str
    message: str
    challenge_method: str
    status: str
    attempts: int
    challenge_expires_at: str
    challenge_verified_at: str | None
    current_reputation: int | None
    open_reports: int
    review: dict[str, str | int | None] | None
    created_at: str


class AppealList(WireModel):
    data: list[AppealOut]
    page: PageInfo


# ── Certificates (§13) ──────────────────────────────────────────────────────────
class CertificateDetail(CertificateOut):
    is_self_signed: bool
    chain_length: int | None
    first_seen_at: str
    last_seen_at: str
    monitors: list[MonitorOut]


class MonitorCreate(RequestModel):
    organisation_id: Ulid
    domain: Domain

    @field_validator("domain")
    @classmethod
    def _domain(cls, value: str) -> str:
        return value.strip().lower().rstrip(".")


# ── Usage (§15) ─────────────────────────────────────────────────────────────────
class UsageRow(WireModel):
    day: str | None
    endpoint_group: str | None
    count: int


class UsageQuota(WireModel):
    limit: int
    used: int
    reset_at: str


class UsageOut(WireModel):
    data: list[UsageRow]
    period: dict[str, str]
    quota: UsageQuota


class DemoCounts(WireModel):
    scans: int
    reports: int
    campaigns: int
    investigations: int
    incidents: int


class DemoOrganisation(WireModel):
    id: str
    name: str


class DemoStatus(WireModel):
    demo_mode: bool
    organisation: DemoOrganisation | None
    counts: DemoCounts
    last_seeded_at: str | None
