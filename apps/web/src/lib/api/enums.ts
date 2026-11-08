// Closed enums from API_CONTRACTS.md §5.5. Unknown wire values map to a safe default — never crash.

export const DECISIONS = ["BLOCK", "WARN", "ALLOW", "REVIEW", "UNKNOWN"] as const;
export type Decision = (typeof DECISIONS)[number];

export const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCAN_STATUSES = ["queued", "running", "completed", "partial", "failed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number] | "unknown";

export const INTENTS = ["browse", "login", "payment", "download", "data_submission"] as const;
export type Intent = (typeof INTENTS)[number];

export const SIGNAL_GROUPS = [
  "reputation",
  "identity",
  "credential_destination",
  "payment_destination",
  "infrastructure",
] as const;
export type SignalGroup = (typeof SIGNAL_GROUPS)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const REPORT_STATUSES = ["pending", "reviewing", "confirmed", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number] | "unknown";

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

export function toDecision(v: unknown): Decision {
  return inList(DECISIONS, v) ? v : "UNKNOWN";
}

export function toRiskLevel(v: unknown): RiskLevel {
  return inList(RISK_LEVELS, v) ? v : "UNKNOWN";
}

export function toScanStatus(v: unknown): ScanStatus {
  return inList(SCAN_STATUSES, v) ? v : "unknown";
}

export function toIntent(v: unknown): Intent {
  return inList(INTENTS, v) ? v : "browse";
}

export function isIntent(v: unknown): v is Intent {
  return inList(INTENTS, v);
}

export function toSeverity(v: unknown): Severity {
  return inList(SEVERITIES, v) ? v : "info";
}

export function toReportStatus(v: unknown): ReportStatus {
  return inList(REPORT_STATUSES, v) ? v : "unknown";
}

export function isSignalGroup(v: unknown): v is SignalGroup {
  return inList(SIGNAL_GROUPS, v);
}

/** Terminal statuses for scans and investigations. Unknown values are treated as terminal to stop polling. */
export function isTerminalStatus(v: unknown): boolean {
  return v === "completed" || v === "partial" || v === "failed" || !inList(SCAN_STATUSES, v);
}
