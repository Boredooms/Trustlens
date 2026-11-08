// Validation on receipt (EXTENSION_API_INTEGRATION.md §4). This never computes a decision: it only
// refuses values the contract does not define, mapping them to UNKNOWN (forward compatibility).
import { DECISIONS, RISK_LEVELS } from "./types";
import type { ActionContext, Assessment, Decision, Finding, Match, RiskLevel } from "./types";

export function normaliseDecision(value: unknown): Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value)
    ? (value as Decision)
    : "UNKNOWN";
}

function normaliseRisk(value: unknown): RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value)
    ? (value as RiskLevel)
    : "UNKNOWN";
}

function normaliseMatch(value: unknown): Match {
  return value === "exact" || value === "none" || value === "unverifiable" ? value : "unverifiable";
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function clampPercent(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** Returns `null` for a malformed response (caller treats it as BAD_RESPONSE → UNKNOWN). */
export function parseAssessment(raw: unknown): Assessment | null {
  const o = obj(raw);
  if (!o) return null;
  const coverage = obj(o.coverage);
  const actionRaw = obj(o.action);
  let action: ActionContext | null = null;
  if (actionRaw) {
    const org = obj(actionRaw.claimed_organisation);
    action = {
      intent: str(actionRaw.intent) ?? "browse",
      claimed_organisation:
        org && typeof org.name === "string" ? { id: str(org.id) ?? "", name: org.name } : null,
      observed_destination: str(actionRaw.observed_destination),
      expected_destinations: strArray(actionRaw.expected_destinations),
      payee: str(actionRaw.payee),
      match: normaliseMatch(actionRaw.match),
    };
  }
  const findings: Finding[] = Array.isArray(o.findings)
    ? o.findings.flatMap((f): Finding[] => {
        const fo = obj(f);
        if (!fo || typeof fo.code !== "string") return [];
        return [
          {
            id: str(fo.id) ?? undefined,
            code: fo.code,
            signal_group: str(fo.signal_group) ?? undefined,
            severity: str(fo.severity) ?? undefined,
            title: str(fo.title) ?? fo.code,
            detail: str(fo.detail),
            observed: obj(fo.observed),
            expected: obj(fo.expected),
          },
        ];
      })
    : [];
  return {
    assessment_id: str(o.assessment_id),
    decision: normaliseDecision(o.decision),
    risk_level: normaliseRisk(o.risk_level),
    risk_score: typeof o.risk_score === "number" ? o.risk_score : null,
    coverage: {
      percent: clampPercent(coverage?.percent),
      collected: strArray(coverage?.collected),
      unavailable: strArray(coverage?.unavailable),
      skipped: strArray(coverage?.skipped),
    },
    reasons: strArray(o.reasons),
    identity_verified: o.identity_verified === true,
    action,
    findings,
    scan_id: str(o.scan_id),
    cached: o.cached === true,
    decided_at: str(o.decided_at),
  };
}

/**
 * Observed vs expected payee, for the overlay. Observed: `action.payee` (else the PAYEE finding's
 * `observed.payee`). Expected: the payee finding's `expected.payees`, else `action.expected_destinations`.
 * Pure extraction of server-supplied values — nothing is inferred locally.
 */
export function payeeComparison(a: Assessment): { observed: string | null; expected: string[] } {
  const payeeFinding =
    a.findings.find((f) => f.code.startsWith("PAYEE") && Array.isArray(f.expected?.payees)) ??
    a.findings.find((f) => Array.isArray(f.expected?.payees));
  const observedFromFinding =
    payeeFinding && typeof payeeFinding.observed?.payee === "string" ? payeeFinding.observed.payee : null;
  const expectedFromFinding = payeeFinding ? strArray(payeeFinding.expected?.payees) : [];
  return {
    observed: a.action?.payee ?? observedFromFinding,
    expected: expectedFromFinding.length > 0 ? expectedFromFinding : (a.action?.expected_destinations ?? []),
  };
}

/** Top reasons for display: capped at 3 (EXTENSION_API_INTEGRATION.md §4). */
export function topReasons(a: Assessment, max = 3): string[] {
  return a.reasons.slice(0, max);
}
