"""Message analysis wire models (docs/03-backend/MESSAGE_ANALYSIS.md §2)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field

from app.schemas.common import Coverage, RequestModel, WireModel
from app.schemas.enums import Decision, RiskLevel
from app.schemas.resources import Ulid

RiskClass = Literal["confirmed_malicious", "high", "suspicious", "low", "inconclusive"]


class MessageAnalyseRequest(RequestModel):
    # Whitespace is kept as sent: the text is analysed, never echoed.
    text: Annotated[str, Field(min_length=1, max_length=20_000)]
    channel: Literal["email", "sms", "dm", "other"] = "other"
    organisation_id: Ulid | None = None


class MessageFinding(WireModel):
    code: str
    signal_group: str
    severity: str
    confidence: float
    title: str
    detail: str
    rule_id: str
    observed: dict[str, Any] | None = None
    expected: dict[str, Any] | None = None
    simulated: bool = False


class MessageLink(WireModel):
    url: str
    registrable_domain: str
    scan_id: str | None
    decision: Decision | None
    finding_codes: list[str]
    error: str | None = None
    simulated: bool = False


class MessageIndicators(WireModel):
    urls: list[str]
    emails: list[str] = Field(description="Masked: first character and domain only")
    sender_domain: str | None
    phones: list[dict[str, Any]] = Field(description="Digit count and country code only")
    payees: list[dict[str, str]]


class ClaimedOrganisation(WireModel):
    id: str
    name: str
    verified_domains: list[str]


class MessageCorrelation(WireModel):
    same_text_count: int = Field(description="Earlier analyses of exactly this text (normalised)")
    shared_link_domains: list[dict[str, Any]] = Field(
        description="Link domains seen in earlier analyses, with counts"
    )


class NarrativeClaim(WireModel):
    text: str
    refs: list[str]


class NarrativeSection(WireModel):
    heading: str
    claims: list[NarrativeClaim]


class MessageNarrative(WireModel):
    source: Literal["template", "llm"]
    sections: list[NarrativeSection]
    fallback_reason: str | None = None


class MessageAnalysisOut(WireModel):
    id: str
    decision: Decision
    risk_level: RiskLevel
    risk_score: int
    risk_class: RiskClass
    caveat: str | None
    coverage: Coverage
    overrides: list[str]
    reasons: list[str]
    claimed_organisation: ClaimedOrganisation | None
    indicators: MessageIndicators
    findings: list[MessageFinding]
    links: list[MessageLink]
    correlation: MessageCorrelation
    narrative: MessageNarrative
    channel: str
    engine_version: str
    simulated: bool
    analysed_at: str
