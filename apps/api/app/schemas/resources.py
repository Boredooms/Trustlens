"""Request/response models for resources (API_ENDPOINTS.md). snake_case only (ADR-007)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import Coverage, PageInfo, RequestModel, WireModel
from app.schemas.enums import Decision, Intent, RecipientType, RiskLevel

Ulid = Annotated[str, Field(pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")]
Url = Annotated[str, Field(min_length=1, max_length=2048)]
# Derived from Decision in app/risk/classes.py (RISK_ENGINE.md §8.7); never stored.
RiskClass = Literal["confirmed_malicious", "high", "suspicious", "low", "inconclusive"]


# ── Findings / evidence ─────────────────────────────────────────────────────────
class FindingOut(WireModel):
    id: str
    code: str
    signal_group: str
    severity: str
    confidence: float
    title: str
    detail: str | None
    observed: dict[str, Any] | None
    expected: dict[str, Any] | None
    evidence_refs: list[str]
    rule_id: str | None
    simulated: bool = False


class EvidenceOut(WireModel):
    id: str
    source: str
    observed_at: str
    summary: str
    payload: dict[str, Any] | None = None
    simulated: bool = False


# ── Scans ───────────────────────────────────────────────────────────────────────
class ScanCreate(RequestModel):
    url: Url
    intent: Intent = Intent.BROWSE
    organisation_id: Ulid | None = None
    deep: bool = False


class ScanAccepted(WireModel):
    id: str
    status: str
    url: str
    intent: str
    created_at: str
    poll_after_ms: int = 1000


class ScanSummary(WireModel):
    id: str
    url: str
    registrable_domain: str
    intent: str
    status: str
    decision: Decision | None
    risk_level: RiskLevel | None
    risk_score: int | None
    risk_class: RiskClass | None = None
    coverage_percent: int | None
    simulated: bool
    created_at: str
    completed_at: str | None


class ScanList(WireModel):
    data: list[ScanSummary]
    page: PageInfo


class ScanOut(WireModel):
    id: str
    status: str
    url: str
    normalised_url: str
    registrable_domain: str
    intent: str
    organisation_id: str | None
    decision: Decision | None
    risk_level: RiskLevel | None
    risk_score: int | None
    risk_class: RiskClass | None = None
    coverage: Coverage | None
    reasons: list[str]
    overrides: list[str]
    engine_version: str | None
    result: dict[str, Any]
    findings: list[FindingOut]
    evidence: list[EvidenceOut]
    cached_groups: list[str]
    simulated: bool
    failure_code: str | None
    duration_ms: int | None
    created_at: str
    completed_at: str | None


# ── Assess ──────────────────────────────────────────────────────────────────────
class AssessRequest(RequestModel):
    url: Url
    intent: Intent = Intent.BROWSE
    organisation_id: Ulid | None = None
    form_action: Url | None = None
    payee: Annotated[str, Field(max_length=200)] | None = None
    destination_host: Annotated[str, Field(max_length=253)] | None = None


class OrgRef(WireModel):
    id: str
    name: str


class ActionOut(WireModel):
    intent: str
    claimed_organisation: OrgRef | None
    observed_destination: str | None
    expected_destinations: list[str]
    payee: str | None
    expected_payees: list[str]
    match: Literal["exact", "none", "unverifiable"]


class AssessResponse(WireModel):
    assessment_id: str
    decision: Decision
    risk_level: RiskLevel
    risk_score: int
    risk_class: RiskClass | None = None
    coverage: Coverage
    reasons: list[str]
    identity_verified: bool
    action: ActionOut
    findings: list[FindingOut]
    scan_id: str
    cached: bool
    simulated: bool
    decided_at: str


class VerifyIdentityRequest(RequestModel):
    domain: Annotated[str, Field(min_length=3, max_length=253)]
    organisation_id: Ulid | None = None


class VerifyIdentityResponse(WireModel):
    domain: str
    claimed_organisation: OrgRef | None
    identity_verified: bool
    reason_code: Literal[
        "DOMAIN_VERIFIED", "DOMAIN_NOT_REGISTERED_BY_BRAND", "NO_PROFILE", "CLAIM_AMBIGUOUS"
    ]
    verified_domains: list[str]
    confidence: float
    checked_at: str


class VerifyPaymentRequest(RequestModel):
    organisation_id: Ulid
    recipient_type: RecipientType
    value: Annotated[str, Field(min_length=3, max_length=200)]
    observed_on_url: Url | None = None


class ExpectedRecipient(WireModel):
    type: str
    handle: str


class RelatedReport(WireModel):
    report_id: str
    confirmed_at: str | None


class VerifyPaymentResponse(WireModel):
    match: Literal["exact", "none", "unverifiable"]
    recipient_status: str
    normalised_value: str
    organisation_has_verified_recipients: bool
    expected_recipients: list[ExpectedRecipient]
    related_reports: list[RelatedReport]
    finding_codes: list[str]
    confidence: float


# ── Auth ────────────────────────────────────────────────────────────────────────
class MembershipOut(WireModel):
    id: str
    name: str
    role: str


class MeOut(WireModel):
    id: str
    email: str
    display_name: str
    role: str
    organisations: list[MembershipOut]
    created_at: str
    last_login_at: str | None


class PairRequest(RequestModel):
    device_name: Annotated[str, Field(min_length=1, max_length=80)] = "Browser extension"


class PairResponse(WireModel):
    code: str
    expires_at: str
    expires_in: int


class ExchangeRequest(RequestModel):
    code: Annotated[str, Field(min_length=8, max_length=12)]
    device_name: Annotated[str, Field(min_length=1, max_length=80)] = "Browser extension"


class ExchangeResponse(WireModel):
    device_token: str
    device_id: str
    expires_at: str


class DeviceOut(WireModel):
    id: str
    name: str
    last_used_at: str | None
    created_at: str
    expires_at: str | None


class DeviceList(WireModel):
    data: list[DeviceOut]


# ── Organisations ───────────────────────────────────────────────────────────────
class DomainOut(WireModel):
    id: str
    domain: str
    kind: str
    status: str
    verified_at: str | None
    expires_at: str | None


class RecipientOut(WireModel):
    id: str
    type: str
    handle: str
    label: str | None
    status: str
    verified_at: str | None


class OrganisationSummary(WireModel):
    id: str
    name: str
    status: str
    role: str | None
    verified_domains_count: int
    simulated: bool


class OrganisationList(WireModel):
    data: list[OrganisationSummary]


class OrganisationOut(WireModel):
    id: str
    name: str
    legal_name: str | None
    country: str | None
    sector: str | None
    support_email: str | None
    status: str
    brand_tokens: list[str]
    simulated: bool
    domains: list[DomainOut]
    recipients: list[RecipientOut]
    created_at: str


class PublicProfile(WireModel):
    id: str
    name: str
    sector: str | None
    country: str | None
    status: str
    verified_domains: list[str]
    login_hosts: list[str]
    payment_hosts: list[str]
    verified_recipients: list[ExpectedRecipient]
    # §4.3/§6: lets clients explain a login-host mismatch ("domain_wildcard" | "explicit_only").
    login_hosts_mode: str = "domain_wildcard"
    simulated: bool


class DomainList(WireModel):
    data: list[DomainOut]


class RecipientList(WireModel):
    data: list[RecipientOut]


class RecipientCreate(RequestModel):
    recipient_type: RecipientType
    value: Annotated[str, Field(min_length=3, max_length=200)]
    label: Annotated[str, Field(max_length=120)] | None = None


class RecipientVerify(RequestModel):
    action: Literal["verify", "reject"]
    reason: Annotated[str, Field(min_length=10, max_length=500)]
    evidence_ref: Annotated[str, Field(max_length=200)] | None = None


# ── Reports ─────────────────────────────────────────────────────────────────────
class ReportCreate(RequestModel):
    url: Url
    justification: Annotated[str, Field(min_length=10, max_length=500)]
    intent: Intent | None = None
    observed_payee: Annotated[str, Field(max_length=200)] | None = None
    scan_id: Ulid | None = None

    @field_validator("justification")
    @classmethod
    def _strip_control(cls, value: str) -> str:
        return "".join(ch for ch in value if ch.isprintable() or ch in "\n ")


class ReportCreated(WireModel):
    id: str
    status: str
    created_at: str
    linked_scan_id: str | None


class ReportSummary(WireModel):
    id: str
    url: str
    status: str
    reporter_channel: str
    observed_payee: str | None
    linked_scan_id: str | None
    decision: Decision | None
    simulated: bool
    created_at: str


class ReportList(WireModel):
    data: list[ReportSummary]
    page: PageInfo


class ReviewOut(WireModel):
    reviewed_by: str | None
    reviewed_at: str | None
    reason: str | None


class ReportOut(ReportSummary):
    justification: str
    reporter: str
    linked_scan: ScanSummary | None
    review: ReviewOut | None
    reputation_applied: bool = False
    campaign_id: str | None = None


class ReviewRequest(RequestModel):
    action: Literal["confirm", "dismiss"]
    reason: Annotated[str, Field(max_length=500)] | None = None


# ── Intelligence ────────────────────────────────────────────────────────────────
class NodeOut(WireModel):
    id: str
    type: str
    label: str
    attributes: dict[str, Any]
    reputation_score: int
    simulated: bool


class EdgeOut(WireModel):
    id: str
    source: str
    target: str
    type: str
    confidence: float
    evidence_refs: list[str]
    observed_count: int


class GraphCounts(WireModel):
    nodes: int
    edges: int


class GraphOut(WireModel):
    root: str
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    truncated: bool
    counts: GraphCounts


class EntityList(WireModel):
    data: list[NodeOut]
    page: PageInfo


class EntityDetail(NodeOut):
    first_seen_at: str
    last_seen_at: str
    edge_counts: dict[str, int]


class CampaignSummary(WireModel):
    id: str
    name: str
    confidence: float
    member_count: int
    simulated: bool
    first_seen_at: str
    last_seen_at: str


class CampaignList(WireModel):
    data: list[CampaignSummary]
    page: PageInfo


class SharedIndicator(WireModel):
    type: str
    label: str
    value: str
    values: list[str]
    members: int
    confidence: float


class CampaignOut(CampaignSummary):
    summary: str | None
    entity_id: str | None
    members: list[NodeOut]
    shared_indicators: list[SharedIndicator]
    confidence_basis: str


# ── Certificates ────────────────────────────────────────────────────────────────
class CertificateOut(WireModel):
    id: str
    fingerprint_sha256: str
    subject_cn: str | None
    issuer_cn: str
    root_issuer_cn: str | None
    sans: list[str]
    not_before: str
    not_after: str
    days_to_expiry: int
    key_type: str
    key_bits: int | None
    signature_algorithm: str
    monitored_domain: str | None
    simulated: bool


class CertificateList(WireModel):
    data: list[CertificateOut]
    page: PageInfo


class MonitorOut(WireModel):
    id: str
    organisation_id: str
    domain: str
    enabled: bool
    current_certificate_id: str | None
    issuer_cn: str | None
    days_to_expiry: int | None
    last_checked_at: str | None


class MonitorList(WireModel):
    data: list[MonitorOut]


class AffectedDomain(WireModel):
    domain: str
    certificate_id: str
    monitor_id: str | None
    organisation_id: str | None


class IncidentCreate(RequestModel):
    issuer_cn: Annotated[str, Field(min_length=2, max_length=200)]
    title: Annotated[str, Field(min_length=3, max_length=200)]
    severity: Literal["critical", "high", "medium", "low"] = "high"
    description: Annotated[str, Field(min_length=3, max_length=2000)]
    source: Annotated[str, Field(max_length=500)] = "simulation"
    simulated: bool = True


class IncidentOut(WireModel):
    id: str
    issuer_cn: str
    title: str
    severity: str
    description: str
    source: str
    simulated: bool
    published_at: str
    affected_domain_count: int
    affected: list[AffectedDomain]
    affected_truncated: bool


class IncidentList(WireModel):
    data: list[IncidentOut]
    page: PageInfo


# ── Investigations ──────────────────────────────────────────────────────────────
class InvestigationCreate(RequestModel):
    scan_id: Ulid


class InvestigationAccepted(WireModel):
    id: str
    status: str
    poll_after_ms: int = 1000


class Claim(WireModel):
    text: str
    refs: list[str]


class Section(WireModel):
    heading: str
    claims: list[Claim]


class Narrative(WireModel):
    sections: list[Section]


class Reference(WireModel):
    id: str
    kind: Literal["finding", "evidence", "entity"]
    label: str
    finding_id: str | None = None
    evidence_id: str | None = None
    entity_id: str | None = None


class DecisionContext(WireModel):
    decision: Decision | None
    risk_level: RiskLevel | None
    risk_score: int | None


class StepOut(WireModel):
    name: str
    status: str
    duration_ms: int | None = None
    error: str | None = None


class AiMeta(WireModel):
    generated: bool
    model: str | None
    prompt_version: str
    tokens_in: int | None = None
    tokens_out: int | None = None
    latency_ms: int | None = None
    fallback_reason: str | None = None


class InvestigationOut(WireModel):
    id: str
    scan_id: str
    status: str
    decision_context: DecisionContext
    steps: list[StepOut]
    narrative: Narrative | None
    references: list[Reference]
    dropped_claims: list[dict[str, Any]]
    ai: AiMeta
    simulated: bool
    created_at: str
    completed_at: str | None


# ── Developer ───────────────────────────────────────────────────────────────────
class ApiKeyCreate(RequestModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    scopes: list[str] = Field(default_factory=lambda: ["assess:read", "scan:write"])
    kind: Literal["api_key"] = "api_key"


class ApiKeyOut(WireModel):
    id: str
    name: str
    prefix: str
    scopes: list[str]
    kind: str
    last_used_at: str | None
    revoked_at: str | None
    created_at: str


class ApiKeyCreated(ApiKeyOut):
    secret: str


class ApiKeyList(WireModel):
    data: list[ApiKeyOut]


# ── Overview ────────────────────────────────────────────────────────────────────
class RecentScan(WireModel):
    id: str
    url: str
    decision: Decision | None
    risk_level: RiskLevel | None
    simulated: bool
    created_at: str


class HighRiskDomain(WireModel):
    entity_id: str
    domain: str
    reputation_score: int


class CertificateAlert(WireModel):
    monitor_id: str
    domain: str
    days_to_expiry: int


class CampaignBrief(WireModel):
    id: str
    name: str
    confidence: float
    member_count: int
    simulated: bool


class ReportQueue(WireModel):
    pending: int
    reviewing: int


class Quota(WireModel):
    scans_used: int
    scans_limit: int
    resets_at: str


class OverviewOut(WireModel):
    recent_scans: list[RecentScan] | None
    high_risk_domains: list[HighRiskDomain] | None
    certificate_alerts: list[CertificateAlert] | None
    campaigns: list[CampaignBrief] | None
    report_queue: ReportQueue | None
    quota: Quota | None
