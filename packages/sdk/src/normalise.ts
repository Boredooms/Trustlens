import { ProtocolError } from "./errors.js";
import { DECISIONS, MATCHES, RISK_CLASSES, RISK_LEVELS } from "./types.js";
import type { Assessment, Decision, Investigation, Match, PaymentResult, RiskClass, RiskLevel, Scan } from "./types.js";

/** Unknown or missing decision values map to `UNKNOWN` (API_CONTRACTS.md §2). Never throws. */
export function normaliseDecision(value: unknown): Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value)
    ? (value as Decision)
    : "UNKNOWN";
}

export function normaliseRiskLevel(value: unknown): RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value)
    ? (value as RiskLevel)
    : "UNKNOWN";
}

/** Unknown risk classes map to `inconclusive`, never to `low`. */
export function normaliseRiskClass(value: unknown): RiskClass {
  return typeof value === "string" && (RISK_CLASSES as readonly string[]).includes(value)
    ? (value as RiskClass)
    : "inconclusive";
}

/** Unknown match values map to `unverifiable` ("we could not tell"), never to `exact`. */
export function normaliseMatch(value: unknown): Match {
  return typeof value === "string" && (MATCHES as readonly string[]).includes(value)
    ? (value as Match)
    : "unverifiable";
}

function asObject(raw: unknown, what: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProtocolError({ code: "BAD_RESPONSE", message: `Unexpected ${what} response shape` });
  }
  return raw as Record<string, unknown>;
}

export function normaliseAssessment(raw: unknown): Assessment {
  const obj = asObject(raw, "assessment");
  const out: Record<string, unknown> = {
    ...obj,
    decision: normaliseDecision(obj.decision),
    risk_level: normaliseRiskLevel(obj.risk_level),
  };
  if ("risk_class" in obj) out.risk_class = normaliseRiskClass(obj.risk_class);
  if (obj.action && typeof obj.action === "object") {
    const action = obj.action as Record<string, unknown>;
    out.action = { ...action, match: normaliseMatch(action.match) };
  }
  return out as unknown as Assessment;
}

export function normaliseScan(raw: unknown): Scan {
  const obj = asObject(raw, "scan");
  const out: Record<string, unknown> = { ...obj };
  // Decision fields only exist once a scan has finished; do not invent them for queued scans.
  if ("decision" in obj) out.decision = normaliseDecision(obj.decision);
  if ("risk_level" in obj) out.risk_level = normaliseRiskLevel(obj.risk_level);
  return out as unknown as Scan;
}

export function normaliseInvestigation(raw: unknown): Investigation {
  const obj = asObject(raw, "investigation");
  const out: Record<string, unknown> = { ...obj };
  if (obj.decision_context && typeof obj.decision_context === "object") {
    const ctx = obj.decision_context as Record<string, unknown>;
    out.decision_context = {
      ...ctx,
      decision: normaliseDecision(ctx.decision),
      risk_level: normaliseRiskLevel(ctx.risk_level),
    };
  }
  return out as unknown as Investigation;
}

export function normalisePayment(raw: unknown): PaymentResult {
  const obj = asObject(raw, "verify-payment");
  return { ...obj, match: normaliseMatch(obj.match) } as unknown as PaymentResult;
}
