// Pure mapping from a server result to what the overlay shows (BROWSER_PROTECTION_LOGIC.md §5.3, §7).
// It enforces the server's decision; it does not compute one.
import { payeeComparison, topReasons } from "./assessment";
import { COPY, DECISION_COPY, failureText, fill, relativeAgo } from "./copy";
import { appealUrl, fullReportUrl, isAppealable } from "./config";
import { hostOf } from "./demo-url";
import type { ActionIntent, CheckResult, Decision } from "./types";

/**
 * block   — action stays stopped; "Proceed anyway" needs a second confirmation click.
 * confirm — confirm before proceeding (WARN, REVIEW).
 * unknown — could not verify; neutral, the user decides.
 * proceed — let the action through with a small non-blocking toast (ALLOW).
 */
export type OverlayMode = "block" | "confirm" | "unknown" | "proceed";

export type Mismatch =
  | { kind: "payee"; observed: string; org: string; expected: string[] }
  | { kind: "credential"; text: string };

export interface OverlayModel {
  mode: OverlayMode;
  tone: Decision;
  label: string;
  title: string;
  body: string | null;
  mismatch: Mismatch | null;
  reasons: string[];
  coverageLine: string;
  decidedLine: string | null;
  fullReportUrl: string | null;
  /** Owner appeal link for BLOCK/WARN; low emphasis, never a way past the warning. */
  appealUrl: string | null;
  scanId: string | null;
  observedPayee: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  secondaryConfirmLabel: string | null;
  toast: string | null;
}

export const MODE_BY_DECISION: Record<Decision, OverlayMode> = {
  BLOCK: "block",
  WARN: "confirm",
  REVIEW: "confirm",
  ALLOW: "proceed",
  UNKNOWN: "unknown",
};

function coverageText(percent: number | null): string {
  return percent === null ? COPY.coverageMissing : fill(COPY.coverageLine, { n: percent });
}

export function buildOverlayModel(
  result: CheckResult,
  intent: ActionIntent,
  now: number = Date.now(),
  pageHost: string | null = null,
): OverlayModel {
  if (result.kind === "failure") {
    return {
      mode: "unknown",
      tone: "UNKNOWN",
      label: DECISION_COPY.UNKNOWN.label,
      title: COPY.couldNotVerify,
      body: `${failureText(result.failure.code, result.failure.retryAfter)} ${COPY.couldNotVerifyBody[intent]}`,
      mismatch: null,
      reasons: [],
      coverageLine: COPY.coverageMissing,
      decidedLine: null,
      fullReportUrl: null,
      appealUrl: null,
      scanId: null,
      observedPayee: null,
      primaryLabel: COPY.goBack,
      secondaryLabel: COPY.continueAnyway,
      secondaryConfirmLabel: null,
      toast: null,
    };
  }

  const a = result.assessment;
  const mode = MODE_BY_DECISION[a.decision];
  const org = a.action?.claimed_organisation?.name ?? COPY.unknownOrg;
  const { observed, expected } = payeeComparison(a);

  let mismatch: Mismatch | null = null;
  if (a.decision === "BLOCK" || a.decision === "WARN") {
    if (intent === "payment" && observed) {
      mismatch = { kind: "payee", observed, org, expected };
    } else if (intent === "login" && a.action?.observed_destination) {
      const dest = hostOf(a.action.observed_destination) ?? a.action.observed_destination;
      mismatch = { kind: "credential", text: fill(COPY.credentialMismatch, { observed: dest, org }) };
    }
  }

  const titles: Record<OverlayMode, string> = {
    block: COPY.stopped[intent],
    confirm: a.decision === "REVIEW" ? COPY.review[intent] : COPY.suspicious[intent],
    unknown: COPY.couldNotVerify,
    proceed: DECISION_COPY.ALLOW.label,
  };
  const ago = relativeAgo(a.decided_at, now);
  const percent = a.coverage.percent;

  return {
    mode,
    tone: a.decision,
    label: DECISION_COPY[a.decision].label,
    title: titles[mode],
    body: mode === "unknown" ? COPY.couldNotVerifyBody[intent] : null,
    mismatch,
    reasons: topReasons(a),
    coverageLine: coverageText(percent),
    decidedLine: ago ? fill(COPY.decidedAgo, { ago }) : null,
    fullReportUrl: a.scan_id ? fullReportUrl(a.scan_id) : null,
    appealUrl: pageHost && isAppealable(a.decision) ? appealUrl(pageHost) : null,
    scanId: a.scan_id,
    observedPayee: observed,
    primaryLabel: COPY.goBack,
    secondaryLabel: mode === "block" ? COPY.proceedAnyway : mode === "confirm" ? COPY.continue : COPY.continueAnyway,
    secondaryConfirmLabel: mode === "block" ? COPY.proceedConfirm : null,
    toast:
      mode !== "proceed" ? null : percent === null ? COPY.allowToastNoCoverage : fill(COPY.allowToast, { n: percent }),
  };
}
