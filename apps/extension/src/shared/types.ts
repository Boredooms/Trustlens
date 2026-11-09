// Mirrors the API response shapes (API_ENDPOINTS.md §5–§6, EXTENSION_API_INTEGRATION.md §4).
// snake_case exactly as the API returns it — no camelCase mapping layer (ADR-007).

export const DECISIONS = ["BLOCK", "WARN", "ALLOW", "REVIEW", "UNKNOWN"] as const;
export type Decision = (typeof DECISIONS)[number];

export const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type ActionIntent = "login" | "payment";
export type Intent = "browse" | ActionIntent;
export type Match = "exact" | "none" | "unverifiable";

export interface Finding {
  id?: string;
  code: string;
  signal_group?: string;
  severity?: string;
  confidence?: number;
  title: string;
  detail: string | null;
  observed: Record<string, unknown> | null;
  expected: Record<string, unknown> | null;
}

export interface ActionContext {
  intent: string;
  claimed_organisation: { id: string; name: string } | null;
  observed_destination: string | null;
  expected_destinations: string[];
  payee: string | null;
  match: Match;
}

export interface Assessment {
  assessment_id: string | null;
  decision: Decision;
  risk_level: RiskLevel;
  risk_score: number | null;
  /** Clamped 0–100; `null` when the response did not include it. */
  coverage: { percent: number | null; collected: string[]; unavailable: string[]; skipped: string[] };
  reasons: string[];
  identity_verified: boolean;
  action: ActionContext | null;
  findings: Finding[];
  scan_id: string | null;
  cached: boolean;
  decided_at: string | null;
}

/** Why a check produced no server decision. Rendered as "not checked", never as a pass. */
export type FailureCode =
  | "NOT_PAIRED"
  | "RECONNECT"
  | "MISCONFIGURED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "CANNOT_CHECK_ADDRESS"
  | "CANNOT_CHECK_PAGE"
  | "PAUSED"
  | "STALE"
  /** localhost, private-network and .local/.internal addresses: the server refuses them (SSRF guard). */
  | "LOCAL_PAGE"
  /** The TrustLens dashboard or API itself. */
  | "OWN_SITE";

export interface CheckFailure {
  code: FailureCode;
  retryAfter?: number | null;
  requestId?: string | null;
}

/** Result of any check: either the server's assessment or an explicit failure (→ UNKNOWN). */
export type CheckResult =
  | { kind: "assessment"; assessment: Assessment; checkedAt: number }
  | { kind: "failure"; failure: CheckFailure; checkedAt: number };

export interface Settings {
  enabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true };
