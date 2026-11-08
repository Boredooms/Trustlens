"""All mapped tables (DATABASE_DESIGN.md §3–§7). Column names and constraints follow the spec.

Enumerated text columns carry CHECK constraints so the database refuses values the contract does not
define (§13.2: "a bug should not be able to write a lie").
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, in_check, ulid_pk, updated_at

DECISIONS = ("BLOCK", "WARN", "ALLOW", "REVIEW", "UNKNOWN")
RISK_LEVELS = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")
INTENTS = ("browse", "login", "payment", "download", "data_submission")
SCAN_STATUSES = ("queued", "running", "completed", "partial", "failed")
SIGNAL_GROUPS = (
    "reputation",
    "identity",
    "credential_destination",
    "payment_destination",
    "infrastructure",
)
SEVERITIES = ("critical", "high", "medium", "low", "info")
RECIPIENT_TYPES = ("upi_vpa", "iban", "bank_account", "wallet_address", "payment_link")
ENTITY_TYPES = (
    "domain",
    "url",
    "ip",
    "asn",
    "nameserver",
    "certificate",
    "certificate_authority",
    "organisation",
    "payment_recipient",
    "campaign",
    "threat_report",
)


def fk(target: str, ondelete: str, *, nullable: bool = True) -> Mapped[Any]:
    return mapped_column(CHAR(26), ForeignKey(target, ondelete=ondelete), nullable=nullable)


def ts(nullable: bool = True) -> Mapped[Any]:
    return mapped_column(DateTime(timezone=True), nullable=nullable)


# ── 3. Identity ─────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(in_check("role", ("user", "analyst", "operator")), name="role"),
        Index(None, "email"),
        Index(None, "role"),
    )
    id: Mapped[str] = ulid_pk()
    clerk_user_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    email_verified_at: Mapped[datetime | None] = ts()
    last_login_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class RefreshToken(Base):
    """Legacy, unused with Clerk (DATABASE_DESIGN.md §3.2). Migrated, never read or written."""

    __tablename__ = "refresh_tokens"
    __table_args__ = (Index(None, "user_id", "expires_at"), Index(None, "family_id"))
    id: Mapped[str] = ulid_pk()
    user_id: Mapped[str] = fk("users.id", "CASCADE", nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    family_id: Mapped[str] = mapped_column(CHAR(26), nullable=False)
    user_agent_hash: Mapped[str | None] = mapped_column(CHAR(64))
    expires_at: Mapped[datetime] = ts(False)
    revoked_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class ApiKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        CheckConstraint(in_check("kind", ("api_key", "extension_device")), name="kind"),
        Index(None, "user_id", "kind"),
        Index(None, "prefix"),
    )
    id: Mapped[str] = ulid_pk()
    user_id: Mapped[str] = fk("users.id", "CASCADE", nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    prefix: Mapped[str] = mapped_column(Text, nullable=False)
    secret_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    last_used_at: Mapped[datetime | None] = ts()
    expires_at: Mapped[datetime | None] = ts()
    revoked_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class PairingCode(Base):
    __tablename__ = "pairing_codes"
    id: Mapped[str] = ulid_pk()
    user_id: Mapped[str] = fk("users.id", "CASCADE", nullable=False)
    code_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    device_name: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = ts(False)
    consumed_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


# ── 4. Trust ────────────────────────────────────────────────────────────────────
class Organisation(Base):
    __tablename__ = "organisations"
    __table_args__ = (
        CheckConstraint(in_check("status", ("draft", "active", "suspended")), name="status"),
        CheckConstraint("char_length(name) BETWEEN 2 AND 120", name="name_length"),
        CheckConstraint(
            in_check("login_hosts_mode", ("domain_wildcard", "explicit_only")),
            name="login_hosts_mode",
        ),
        Index(None, "status"),
        Index("ix_organisations_brand_tokens", "brand_tokens", postgresql_using="gin"),
    )
    id: Mapped[str] = ulid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    legal_name: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(CHAR(2))
    sector: Mapped[str | None] = mapped_column(Text)
    support_email: Mapped[str | None] = mapped_column(CITEXT)
    brand_tokens: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    logo_phash: Mapped[str | None] = mapped_column(Text)  # 64-bit hex; BIT(64) in the spec
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    # ORGANISATION_TRUST_PROFILES.md §4.3: which hosts count as approved credential destinations.
    login_hosts_mode: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="domain_wildcard"
    )
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_by: Mapped[str | None] = fk("users.id", "SET NULL")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class OrganisationMember(Base):
    __tablename__ = "organisation_members"
    __table_args__ = (
        UniqueConstraint("organisation_id", "user_id"),
        CheckConstraint(in_check("role", ("org_admin", "org_member")), name="role"),
    )
    id: Mapped[str] = ulid_pk()
    organisation_id: Mapped[str] = fk("organisations.id", "CASCADE", nullable=False)
    user_id: Mapped[str] = fk("users.id", "CASCADE", nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at()


class OrganisationInvite(Base):
    __tablename__ = "organisation_invites"
    __table_args__ = (
        Index(
            "uq_organisation_invites_open",
            "organisation_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL"),
        ),
    )
    id: Mapped[str] = ulid_pk()
    organisation_id: Mapped[str] = fk("organisations.id", "CASCADE", nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    invited_by: Mapped[str | None] = fk("users.id", "SET NULL")
    expires_at: Mapped[datetime] = ts(False)
    accepted_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class VerifiedDomain(Base):
    __tablename__ = "verified_domains"
    __table_args__ = (
        CheckConstraint(
            in_check("kind", ("official", "login", "application", "payment")), name="kind"
        ),
        CheckConstraint(
            in_check("status", ("pending", "verified", "failed", "expired", "revoked")),
            name="status",
        ),
        CheckConstraint("domain = lower(domain)", name="domain_lowercase"),
        CheckConstraint(
            "verification_method IS NULL OR verification_method IN ('dns_txt','http_file')",
            name="verification_method",
        ),
        Index(None, "organisation_id", "status"),
    )
    id: Mapped[str] = ulid_pk()
    organisation_id: Mapped[str] = fk("organisations.id", "CASCADE", nullable=False)
    domain: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default="official")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    # Method of the last successful challenge; NULL for seeded rows (TRUST_PROFILES §4).
    verification_method: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = ts()
    expires_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class DomainVerification(Base):
    __tablename__ = "domain_verifications"
    __table_args__ = (
        CheckConstraint(in_check("method", ("dns_txt", "http_file")), name="method"),
        CheckConstraint(
            in_check("status", ("pending", "verified", "failed", "expired")), name="status"
        ),
    )
    id: Mapped[str] = ulid_pk()
    verified_domain_id: Mapped[str] = fk("verified_domains.id", "CASCADE", nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    observed_value: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[datetime] = ts(False)
    verified_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class VerifiedRecipient(Base):
    __tablename__ = "verified_recipients"
    __table_args__ = (
        UniqueConstraint("organisation_id", "recipient_type", "normalised_value"),
        CheckConstraint(in_check("recipient_type", RECIPIENT_TYPES), name="recipient_type"),
        CheckConstraint(
            in_check("status", ("pending_attestation", "verified", "rejected", "revoked")),
            name="status",
        ),
        Index(None, "normalised_value"),
        Index(None, "organisation_id", "status"),
    )
    id: Mapped[str] = ulid_pk()
    organisation_id: Mapped[str] = fk("organisations.id", "CASCADE", nullable=False)
    recipient_type: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    normalised_value: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending_attestation")
    evidence_ref: Mapped[str | None] = mapped_column(Text)
    verified_by: Mapped[str | None] = fk("users.id", "SET NULL")
    verified_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


# ── 5. Assessment ───────────────────────────────────────────────────────────────
class Scan(Base):
    __tablename__ = "scans"
    __table_args__ = (
        CheckConstraint(in_check("intent", INTENTS), name="intent"),
        CheckConstraint(in_check("status", SCAN_STATUSES), name="status"),
        CheckConstraint(f"decision IS NULL OR {in_check('decision', DECISIONS)}", name="decision"),
        CheckConstraint(
            f"risk_level IS NULL OR {in_check('risk_level', RISK_LEVELS)}", name="risk_level"
        ),
        CheckConstraint("risk_score IS NULL OR risk_score BETWEEN 0 AND 100", name="risk_score"),
        # A scored scan must carry coverage: a verdict without coverage is invalid.
        CheckConstraint("decision IS NULL OR coverage ? 'percent'", name="decision_has_coverage"),
        Index("ix_scans_user_recent", "user_id", text("created_at DESC")),
        Index("ix_scans_org_recent", "organisation_id", text("created_at DESC")),
        Index("ix_scans_domain_recent", "registrable_domain", text("created_at DESC")),
        Index(None, "decision"),
        Index(
            "ix_scans_pending",
            "status",
            postgresql_where=text("status IN ('queued','running')"),
        ),
    )
    id: Mapped[str] = ulid_pk()
    user_id: Mapped[str | None] = fk("users.id", "SET NULL")
    organisation_id: Mapped[str | None] = fk("organisations.id", "SET NULL")
    url: Mapped[str] = mapped_column(Text, nullable=False)
    normalised_url: Mapped[str] = mapped_column(Text, nullable=False)
    registrable_domain: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str] = mapped_column(Text, nullable=False, server_default="browse")
    deep: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    decision: Mapped[str | None] = mapped_column(Text)
    risk_level: Mapped[str | None] = mapped_column(Text)
    risk_score: Mapped[int | None] = mapped_column(SmallInteger)
    coverage: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    reasons: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    overrides: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    result: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    cached_groups: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    engine_version: Mapped[str | None] = mapped_column(Text)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    failure_code: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at()
    completed_at: Mapped[datetime | None] = ts()


class ScanFinding(Base):
    __tablename__ = "scan_findings"
    __table_args__ = (
        CheckConstraint(in_check("signal_group", SIGNAL_GROUPS), name="signal_group"),
        CheckConstraint(in_check("severity", SEVERITIES), name="severity"),
        CheckConstraint("confidence BETWEEN 0 AND 1", name="confidence"),
        Index(None, "scan_id"),
        Index(None, "code"),
        Index(None, "signal_group", "severity"),
    )
    id: Mapped[str] = ulid_pk()
    scan_id: Mapped[str] = fk("scans.id", "CASCADE", nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    signal_group: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    observed: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    expected: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    evidence_ids: Mapped[list[str]] = mapped_column(
        ARRAY(CHAR(26)), nullable=False, server_default="{}"
    )
    rule_id: Mapped[str | None] = mapped_column(Text)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = created_at()


class Evidence(Base):
    """Append-only (DATABASE_DESIGN.md §5.3). Payloads are redacted before insert."""

    __tablename__ = "evidence"
    __table_args__ = (Index(None, "scan_id", "source"), Index(None, "payload_hash"))
    id: Mapped[str] = ulid_pk()
    scan_id: Mapped[str | None] = fk("scans.id", "CASCADE")
    source: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = ts(False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    blob_ref: Mapped[str | None] = mapped_column(Text)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = created_at()


# ── 6. Intelligence ─────────────────────────────────────────────────────────────
class Entity(Base):
    __tablename__ = "entities"
    __table_args__ = (
        UniqueConstraint("type", "key"),
        CheckConstraint(in_check("type", ENTITY_TYPES), name="type"),
        CheckConstraint("reputation_score BETWEEN -100 AND 100", name="reputation"),
        Index("ix_entities_type_recent", "type", text("last_seen_at DESC")),
    )
    id: Mapped[str] = ulid_pk()
    type: Mapped[str] = mapped_column(Text, nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    reputation_score: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    first_seen_at: Mapped[datetime] = ts(False)
    last_seen_at: Mapped[datetime] = ts(False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class Relationship(Base):
    __tablename__ = "relationships"
    __table_args__ = (
        UniqueConstraint("source_entity_id", "target_entity_id", "type", name="rel_unique"),
        CheckConstraint("source_entity_id <> target_entity_id", name="rel_no_self"),
        CheckConstraint("confidence > 0 AND confidence <= 1", name="confidence"),
        Index(None, "source_entity_id", "type"),
        Index(None, "target_entity_id", "type"),
        Index("ix_relationships_type_confidence", "type", text("confidence DESC")),
    )
    id: Mapped[str] = ulid_pk()
    source_entity_id: Mapped[str] = fk("entities.id", "CASCADE", nullable=False)
    target_entity_id: Mapped[str] = fk("entities.id", "CASCADE", nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False)
    evidence_ids: Mapped[list[str]] = mapped_column(
        ARRAY(CHAR(26)), nullable=False, server_default="{}"
    )
    observed_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    first_seen_at: Mapped[datetime] = ts(False)
    last_seen_at: Mapped[datetime] = ts(False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class ThreatReport(Base):
    __tablename__ = "threat_reports"
    __table_args__ = (
        CheckConstraint(
            in_check("reporter_channel", ("web", "extension", "sdk", "analyst")), name="channel"
        ),
        CheckConstraint(
            in_check("status", ("pending", "reviewing", "confirmed", "dismissed")), name="status"
        ),
        CheckConstraint("char_length(justification) BETWEEN 10 AND 500", name="justification"),
        UniqueConstraint("reporter_user_id", "normalised_url", "dedupe_day", name="report_dedupe"),
        Index("ix_threat_reports_queue", "status", text("created_at DESC")),
        Index(None, "normalised_url"),
        Index(None, "entity_id"),
    )
    id: Mapped[str] = ulid_pk()
    reporter_user_id: Mapped[str | None] = fk("users.id", "SET NULL")
    reporter_channel: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    normalised_url: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str | None] = fk("entities.id", "SET NULL")
    scan_id: Mapped[str | None] = fk("scans.id", "SET NULL")
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str | None] = mapped_column(Text)
    observed_payee: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    reviewed_by: Mapped[str | None] = fk("users.id", "SET NULL")
    reviewed_at: Mapped[datetime | None] = ts()
    review_reason: Mapped[str | None] = mapped_column(Text)
    anonymised_at: Mapped[datetime | None] = ts()
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    dedupe_day: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=text("(now() AT TIME ZONE 'utc')::date")
    )
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class Campaign(Base):
    __tablename__ = "campaigns"
    __table_args__ = (CheckConstraint("confidence BETWEEN 0 AND 1", name="confidence"),)
    id: Mapped[str] = ulid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False)
    member_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    summary: Mapped[str | None] = mapped_column(Text)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    first_seen_at: Mapped[datetime] = ts(False)
    last_seen_at: Mapped[datetime] = ts(False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class Certificate(Base):
    __tablename__ = "certificates"
    __table_args__ = (
        Index(None, "issuer_cn"),
        Index(None, "not_after"),
        Index(None, "root_issuer_cn"),
    )
    id: Mapped[str] = ulid_pk()
    fingerprint_sha256: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    subject_cn: Mapped[str | None] = mapped_column(Text)
    issuer_cn: Mapped[str] = mapped_column(Text, nullable=False)
    root_issuer_cn: Mapped[str | None] = mapped_column(Text)
    sans: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    not_before: Mapped[datetime] = ts(False)
    not_after: Mapped[datetime] = ts(False)
    key_type: Mapped[str] = mapped_column(Text, nullable=False)
    key_bits: Mapped[int | None] = mapped_column(Integer)
    signature_algorithm: Mapped[str] = mapped_column(Text, nullable=False)
    is_self_signed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    chain_length: Mapped[int | None] = mapped_column(SmallInteger)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    first_seen_at: Mapped[datetime] = ts(False)
    last_seen_at: Mapped[datetime] = ts(False)
    last_scan_id: Mapped[str | None] = fk("scans.id", "SET NULL")


class CertificateMonitor(Base):
    __tablename__ = "certificate_monitors"
    __table_args__ = (UniqueConstraint("organisation_id", "domain"),)
    id: Mapped[str] = ulid_pk()
    organisation_id: Mapped[str] = fk("organisations.id", "CASCADE", nullable=False)
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    current_certificate_id: Mapped[str | None] = fk("certificates.id", "SET NULL")
    last_checked_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class CertificateIncident(Base):
    __tablename__ = "certificate_incidents"
    __table_args__ = (
        Index(None, "issuer_cn"),
        Index("ix_certificate_incidents_recent", "simulated", text("published_at DESC")),
        # Real advisory ingestion is FUTURE; only simulated incidents can exist today.
        CheckConstraint("simulated OR source <> 'simulation'", name="simulation_flagged"),
    )
    id: Mapped[str] = ulid_pk()
    issuer_cn: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    published_at: Mapped[datetime] = ts(False)
    affected_domain_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_by: Mapped[str | None] = fk("users.id", "SET NULL")
    created_at: Mapped[datetime] = created_at()


class Investigation(Base):
    __tablename__ = "investigations"
    __table_args__ = (
        CheckConstraint(in_check("status", SCAN_STATUSES), name="status"),
        Index(None, "scan_id"),
        Index("ix_investigations_user_recent", "user_id", text("created_at DESC")),
    )
    id: Mapped[str] = ulid_pk()
    scan_id: Mapped[str] = fk("scans.id", "CASCADE", nullable=False)
    user_id: Mapped[str | None] = fk("users.id", "SET NULL")
    organisation_id: Mapped[str | None] = fk("organisations.id", "SET NULL")
    status: Mapped[str] = mapped_column(Text, nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    narrative: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    references: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    dropped_claims: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    ai_meta: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = created_at()
    completed_at: Mapped[datetime | None] = ts()


# ── 7. Operational ──────────────────────────────────────────────────────────────
class AuditLog(Base):
    """Append-only. The application never updates or deletes rows (§13.2)."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            in_check("actor_kind", ("user", "api_key", "extension", "system")), name="actor_kind"
        ),
        Index("ix_audit_logs_recent", text("created_at DESC")),
        Index("ix_audit_logs_actor_recent", "actor_user_id", text("created_at DESC")),
        Index("ix_audit_logs_action_recent", "action", text("created_at DESC")),
    )
    id: Mapped[str] = ulid_pk()
    actor_user_id: Mapped[str | None] = fk("users.id", "SET NULL")
    actor_kind: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str | None] = mapped_column(Text)
    target_id: Mapped[str | None] = mapped_column(Text)
    organisation_id: Mapped[str | None] = mapped_column(CHAR(26))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip_hash: Mapped[str | None] = mapped_column(CHAR(64))
    request_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("actor_id", "key"),)
    id: Mapped[str] = ulid_pk()
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    body_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = ts(False)


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("actor_id", "actor_kind", "day", "endpoint_group"),)
    id: Mapped[str] = ulid_pk()
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    actor_kind: Mapped[str] = mapped_column(Text, nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    endpoint_group: Mapped[str] = mapped_column(Text, nullable=False)
    count: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")


# ── Appeals (API_ENDPOINTS.md §11, USER_JOURNEYS.md J10) ────────────────────────
APPEAL_STATUSES = ("pending_challenge", "challenge_verified", "approved", "rejected", "expired")


class Appeal(Base):
    """A site owner's false-positive appeal. Never changes a verdict until an analyst approves."""

    __tablename__ = "appeals"
    __table_args__ = (
        CheckConstraint(in_check("challenge_method", ("dns_txt", "http_file")), name="method"),
        CheckConstraint(in_check("status", APPEAL_STATUSES), name="status"),
        CheckConstraint("char_length(message) BETWEEN 10 AND 2000", name="message_length"),
        CheckConstraint("domain = lower(domain)", name="domain_lowercase"),
        Index("ix_appeals_queue", "status", text("created_at DESC")),
        Index(None, "domain"),
    )
    id: Mapped[str] = ulid_pk()
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    challenge_method: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending_challenge")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    observed_value: Mapped[str | None] = mapped_column(Text)
    challenge_expires_at: Mapped[datetime] = ts(False)
    challenge_verified_at: Mapped[datetime | None] = ts()
    entity_id: Mapped[str | None] = fk("entities.id", "SET NULL")
    reviewed_by: Mapped[str | None] = fk("users.id", "SET NULL")
    reviewed_at: Mapped[datetime | None] = ts()
    review_reason: Mapped[str | None] = mapped_column(Text)
    reputation_before: Mapped[int | None] = mapped_column(SmallInteger)
    reputation_after: Mapped[int | None] = mapped_column(SmallInteger)
    ip_hash: Mapped[str | None] = mapped_column(CHAR(64))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


# ── Web3 report registry (WEB3_REGISTRY.md §6) ──────────────────────────────────
class ReportAnchor(Base):
    """Off-chain record of a report's on-chain commitment. One row per report (latest revision);
    revision history lives in the contract's events. ``payload`` holds no personal data (§4)."""

    __tablename__ = "report_anchors"
    __table_args__ = (
        UniqueConstraint("report_id"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("commitment ~ '^0x[0-9a-f]{64}$'", name="commitment_hex"),
        CheckConstraint("payload_hash ~ '^0x[0-9a-f]{64}$'", name="payload_hash_hex"),
    )
    id: Mapped[str] = ulid_pk()
    report_id: Mapped[str] = fk("threat_reports.id", "CASCADE", nullable=False)
    chain_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    contract: Mapped[str] = mapped_column(Text, nullable=False)
    report_id_bytes32: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(Text, nullable=False)
    salt_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    commitment: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    tx_hash: Mapped[str] = mapped_column(Text, nullable=False)
    block_number: Mapped[int] = mapped_column(BigInteger, nullable=False)
    anchored_at: Mapped[datetime] = ts(False)
    created_by: Mapped[str | None] = fk("users.id", "SET NULL")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


# ── Message analysis (MESSAGE_ANALYSIS.md §7) ───────────────────────────────────
class MessageAnalysis(Base):
    """One analysed message. Never the raw text: a hash, counts, codes and link domains only."""

    __tablename__ = "message_analyses"
    __table_args__ = (
        CheckConstraint(in_check("channel", ("email", "sms", "dm", "other")), name="channel"),
        CheckConstraint(in_check("decision", DECISIONS), name="decision"),
        CheckConstraint("char_count BETWEEN 1 AND 20000", name="char_count"),
        Index(None, "text_sha256"),
        Index("ix_message_analyses_user_recent", "user_id", text("created_at DESC")),
    )
    id: Mapped[str] = ulid_pk()
    user_id: Mapped[str | None] = fk("users.id", "SET NULL")
    api_key_id: Mapped[str | None] = fk("api_keys.id", "SET NULL")
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    text_sha256: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    risk_score: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    finding_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    link_domains: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    link_scan_ids: Mapped[list[str]] = mapped_column(
        ARRAY(CHAR(26)), nullable=False, server_default="{}"
    )
    engine_version: Mapped[str] = mapped_column(Text, nullable=False)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = created_at()
