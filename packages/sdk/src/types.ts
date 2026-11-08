/**
 * Public types for @trustlens/sdk.
 *
 * Field names are snake_case exactly as the API returns them (ADR-007). There is no camelCase
 * translation layer. Shapes mirror docs/06-sdk/SDK_SPECIFICATION.md §4 and
 * docs/03-backend/API_ENDPOINTS.md. `packages/shared-types` is not generated yet, so these are
 * hand-maintained against the spec; switch to re-exports once the OpenAPI types exist.
 */

export const DECISIONS = ["BLOCK", "WARN", "ALLOW", "REVIEW", "UNKNOWN"] as const;
export const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export const INTENTS = ["browse", "login", "payment", "download", "data_submission"] as const;
export const MATCHES = ["exact", "none", "unverifiable"] as const;

/**
 * The server's decision. `ALLOW` means "no known threat within executed checks" — it is not a
 * claim that a site is harmless. Unknown future values are mapped to `UNKNOWN` by the SDK.
 */
export type Decision = (typeof DECISIONS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type Intent = (typeof INTENTS)[number];
export type Match = (typeof MATCHES)[number];
export type SignalGroup =
  | "reputation"
  | "identity"
  | "credential_destination"
  | "payment_destination"
  | "infrastructure";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RecipientType = "upi_vpa" | "iban" | "bank_account" | "wallet_address" | "payment_link";
export type ScanStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type InvestigationStatus = ScanStatus;
export type ReportStatus = "pending" | "reviewing" | "confirmed" | "dismissed";

export interface Finding {
  id: string;
  code: string;
  signal_group: SignalGroup;
  severity: Severity;
  confidence: number;
  title: string;
  detail: string | null;
  observed: Record<string, unknown> | null;
  expected: Record<string, unknown> | null;
  evidence_refs: string[];
  rule_id: string | null;
}

export interface Coverage {
  percent: number;
  collected: SignalGroup[];
  unavailable: SignalGroup[];
  skipped: SignalGroup[];
}

export interface ActionContext {
  intent: Intent;
  claimed_organisation: { id: string; name: string } | null;
  observed_destination: string | null;
  expected_destinations: string[];
  payee: string | null;
  match: Match;
}

/** Response of `POST /api/v1/assess`. `decision` is authoritative; the SDK never interprets it. */
export interface Assessment {
  assessment_id: string;
  decision: Decision;
  risk_level: RiskLevel;
  risk_score: number | null;
  coverage: Coverage;
  reasons: string[];
  identity_verified: boolean;
  action?: ActionContext;
  findings: Finding[];
  scan_id?: string;
  cached: boolean;
  decided_at: string;
}

export interface AssessInput {
  url: string;
  intent?: Intent;
  organisation_id?: string;
  form_action?: string;
  payee?: string;
  destination_host?: string;
  /** Sent as the `Idempotency-Key` header, never in the body. Generated per call if absent. */
  idempotencyKey?: string;
}

export interface ScanInput {
  url: string;
  intent?: Intent;
  organisation_id?: string;
  deep?: boolean;
  idempotencyKey?: string;
  /** Poll `GET /scans/{id}` until a terminal status (or `pollTimeoutMs`). Default `false`. */
  wait?: boolean;
  /** Client-side give-up for polling; the last retained state is returned. Default 90 000. */
  pollTimeoutMs?: number;
}

/** `202` body of `POST /scans`. */
export interface ScanCreated {
  id: string;
  status: ScanStatus;
  url: string;
  intent: Intent;
  created_at: string;
  poll_after_ms: number;
}

/** Full scan (`GET /scans/{id}`). Decision fields are absent while the scan is queued/running. */
export interface Scan {
  id: string;
  status: ScanStatus;
  url: string;
  normalised_url?: string;
  registrable_domain?: string;
  intent: Intent;
  decision?: Decision;
  risk_level?: RiskLevel;
  risk_score?: number | null;
  coverage?: Coverage;
  reasons?: string[];
  overrides?: string[];
  engine_version?: string;
  result?: Record<string, unknown>;
  findings?: Finding[];
  evidence?: { id: string; source: string; observed_at: string; summary: string }[];
  cached_groups?: SignalGroup[];
  duration_ms?: number;
  created_at: string;
  completed_at?: string | null;
  poll_after_ms?: number;
}

export interface VerifyIdentityInput {
  domain: string;
  organisation_id?: string;
}

export interface IdentityResult {
  domain: string;
  claimed_organisation: { id: string; name: string } | null;
  identity_verified: boolean;
  reason_code:
    | "DOMAIN_VERIFIED"
    | "DOMAIN_NOT_REGISTERED_BY_BRAND"
    | "NO_PROFILE"
    | "CLAIM_AMBIGUOUS"
    | (string & {});
  verified_domains: string[];
  login_hosts_mode: string;
  confidence: number;
  checked_at: string;
}

export interface VerifyPaymentInput {
  organisation_id: string;
  recipient_type: RecipientType;
  value: string;
  observed_on_url?: string;
}

export interface PaymentResult {
  match: Match;
  recipient_status: "verified" | "pending_attestation" | "revoked" | "unknown";
  normalised_value: string;
  organisation_has_verified_recipients: boolean;
  expected_recipients: { type: string; handle: string }[];
  related_reports: { report_id: string; confirmed_at: string }[];
  finding_codes: string[];
  confidence: number;
}

export interface RedirectInput {
  url: string;
  /** 1–10 */
  max_hops?: number;
}

export interface RedirectResult {
  final_url: string;
  cross_domain: boolean;
  loop_detected: boolean;
  hops: { url: string; status: number; location: string | null; elapsed_ms: number }[];
  blocked_hop: { url: string; reason: string } | null;
}

export interface ReportInput {
  url: string;
  justification?: string;
  intent?: Intent;
  observed_payee?: string;
  scan_id?: string;
  idempotencyKey?: string;
}

export interface ReportResult {
  id: string;
  status: ReportStatus;
  created_at: string;
  linked_scan_id: string | null;
}

export interface Investigation {
  id: string;
  scan_id?: string;
  status: InvestigationStatus;
  poll_after_ms?: number;
  decision_context?: { decision: Decision; risk_level: RiskLevel; risk_score: number | null };
  steps?: { name: string; status: string; duration_ms: number | null }[];
  narrative?: { sections: { heading: string; claims: { text: string; refs: string[] }[] }[] };
  references?: { id: string; kind: string; finding_id?: string; evidence_id?: string }[];
  dropped_claims?: unknown[];
  ai?: {
    generated: boolean;
    model: string | null;
    prompt_version: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    latency_ms: number | null;
  };
  created_at?: string;
  completed_at?: string | null;
}

/** Error envelope (API_CONTRACTS.md §5.3). */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: unknown;
  };
}
