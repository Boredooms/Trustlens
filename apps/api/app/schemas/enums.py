"""Wire enumerations.

Owner document: docs/02-architecture/API_CONTRACTS.md §5.5 (values) and §7 (error codes).
These are the only spellings. Values are asserted against tests/fixtures/contract_enums.json so a
rename breaks exactly one place (API_CONTRACTS.md §14).
"""

from __future__ import annotations

from enum import StrEnum


class Decision(StrEnum):
    """The five decisions. ALLOW means "no known threat within executed checks" — never "safe"."""

    BLOCK = "BLOCK"
    WARN = "WARN"
    ALLOW = "ALLOW"
    REVIEW = "REVIEW"
    UNKNOWN = "UNKNOWN"


class RiskLevel(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


class ScanStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"


class Intent(StrEnum):
    BROWSE = "browse"
    LOGIN = "login"
    PAYMENT = "payment"
    DOWNLOAD = "download"
    DATA_SUBMISSION = "data_submission"


class SignalGroup(StrEnum):
    REPUTATION = "reputation"
    IDENTITY = "identity"
    CREDENTIAL_DESTINATION = "credential_destination"
    PAYMENT_DESTINATION = "payment_destination"
    INFRASTRUCTURE = "infrastructure"


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class CoverageState(StrEnum):
    COLLECTED = "collected"
    UNAVAILABLE = "unavailable"
    SKIPPED = "skipped"


class ReportStatus(StrEnum):
    PENDING = "pending"
    REVIEWING = "reviewing"
    CONFIRMED = "confirmed"
    DISMISSED = "dismissed"


class InvestigationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"


class RecipientType(StrEnum):
    UPI_VPA = "upi_vpa"
    IBAN = "iban"
    BANK_ACCOUNT = "bank_account"
    WALLET_ADDRESS = "wallet_address"
    PAYMENT_LINK = "payment_link"


class Match(StrEnum):
    EXACT = "exact"
    NONE = "none"
    UNVERIFIABLE = "unverifiable"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    FAILED = "failed"
    EXPIRED = "expired"
    REVOKED = "revoked"


class EntityType(StrEnum):
    DOMAIN = "domain"
    URL = "url"
    IP = "ip"
    ASN = "asn"
    NAMESERVER = "nameserver"
    CERTIFICATE = "certificate"
    CERTIFICATE_AUTHORITY = "certificate_authority"
    ORGANISATION = "organisation"
    PAYMENT_RECIPIENT = "payment_recipient"
    CAMPAIGN = "campaign"
    THREAT_REPORT = "threat_report"


class ErrorCode(StrEnum):
    """API_CONTRACTS.md §7. Stable strings; never reuse a code for a different meaning."""

    # 7.1 General / auth
    VALIDATION_FAILED = "VALIDATION_FAILED"
    MALFORMED_JSON = "MALFORMED_JSON"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    INVALID_PAIRING_CODE = "INVALID_PAIRING_CODE"
    PAIRING_CODE_EXPIRED = "PAIRING_CODE_EXPIRED"
    INVALID_TOKEN = "INVALID_TOKEN"  # noqa: S105 — an error code, not a credential
    REVERIFICATION_REQUIRED = "REVERIFICATION_REQUIRED"
    INVALID_API_KEY = "INVALID_API_KEY"
    INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE"
    FORBIDDEN = "FORBIDDEN"
    CSRF_ORIGIN_MISMATCH = "CSRF_ORIGIN_MISMATCH"
    DEMO_MODE_REQUIRED = "DEMO_MODE_REQUIRED"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    CONFLICT = "CONFLICT"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    RATE_LIMITED = "RATE_LIMITED"
    NOT_READY = "NOT_READY"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # 7.2 Scanning and assessment
    INVALID_URL = "INVALID_URL"
    UNSUPPORTED_SCHEME = "UNSUPPORTED_SCHEME"
    URL_HAS_CREDENTIALS = "URL_HAS_CREDENTIALS"
    TARGET_NOT_ALLOWED = "TARGET_NOT_ALLOWED"
    DNS_RESOLUTION_FAILED = "DNS_RESOLUTION_FAILED"
    UNSUPPORTED_PORT = "UNSUPPORTED_PORT"
    SCAN_NOT_FOUND = "SCAN_NOT_FOUND"
    SCAN_ALREADY_RUNNING = "SCAN_ALREADY_RUNNING"
    DEEP_SCAN_DISABLED = "DEEP_SCAN_DISABLED"
    IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    # 7.3 Organisations and verification
    ORGANISATION_NOT_FOUND = "ORGANISATION_NOT_FOUND"
    DOMAIN_ALREADY_CLAIMED = "DOMAIN_ALREADY_CLAIMED"
    DOMAIN_NOT_VERIFIED = "DOMAIN_NOT_VERIFIED"
    VERIFICATION_TOKEN_MISMATCH = "VERIFICATION_TOKEN_MISMATCH"  # noqa: S105
    VERIFICATION_NOT_FOUND = "VERIFICATION_NOT_FOUND"
    VERIFICATION_FETCH_FAILED = "VERIFICATION_FETCH_FAILED"
    VERIFICATION_EXPIRED = "VERIFICATION_EXPIRED"
    RECIPIENT_ALREADY_EXISTS = "RECIPIENT_ALREADY_EXISTS"
    INVALID_RECIPIENT = "INVALID_RECIPIENT"
    LAST_ADMIN_REMOVAL = "LAST_ADMIN_REMOVAL"
    NO_VERIFIED_DOMAIN = "NO_VERIFIED_DOMAIN"
    INVITE_NOT_FOUND = "INVITE_NOT_FOUND"
    INVITE_EXPIRED = "INVITE_EXPIRED"
    INVITE_EMAIL_MISMATCH = "INVITE_EMAIL_MISMATCH"
    # 7.4 Reports, intelligence, investigations
    REPORT_DUPLICATE = "REPORT_DUPLICATE"
    REPORT_ALREADY_REVIEWED = "REPORT_ALREADY_REVIEWED"
    REVIEW_REASON_REQUIRED = "REVIEW_REASON_REQUIRED"
    INSUFFICIENT_COVERAGE_FOR_REVIEW = "INSUFFICIENT_COVERAGE_FOR_REVIEW"
    GRAPH_DEPTH_EXCEEDED = "GRAPH_DEPTH_EXCEEDED"
    GRAPH_QUERY_TIMEOUT = "GRAPH_QUERY_TIMEOUT"
    ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND"
    INVESTIGATION_LIMIT_REACHED = "INVESTIGATION_LIMIT_REACHED"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    INCIDENT_NOT_SIMULATED = "INCIDENT_NOT_SIMULATED"
    # 7.5 Appeals (platform)
    APPEAL_NOT_VERIFIED = "APPEAL_NOT_VERIFIED"
    APPEAL_ALREADY_REVIEWED = "APPEAL_ALREADY_REVIEWED"
    APPEAL_ATTEMPTS_EXHAUSTED = "APPEAL_ATTEMPTS_EXHAUSTED"
