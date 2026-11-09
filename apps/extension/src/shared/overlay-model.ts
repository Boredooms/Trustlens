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

/**
 * `stage` — "action": a submit/click is held (the original flow). "page": the page guard holds the
 * whole page before it can be used (§5.5); `intent` may then be "browse" (page-load verdict).
 */
export type GuardIntent = ActionIntent | "browse";

export function buildOverlayModel(
  result: CheckResult,
  intent: GuardIntent,
  now: number = Date.now(),
  pageHost: string | null = null,
  stage: "action" | "page" = "action",
): OverlayModel {
  const page = stage === "page" || intent === "browse";
  const notCheckedBody = intent === "browse" ? COPY.page.notChecked : COPY.couldNotVerifyBody[intent];
  if (result.kind === "failure") {
    return {
      mode: "unknown",
      tone: "UNKNOWN",
      label: DECISION_COPY.UNKNOWN.label,
      title: COPY.couldNotVerify,
      body: `${failureText(result.failure.code, result.failure.retryAfter)} ${notCheckedBody}`,
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
    block: page ? COPY.page.stopped[intent] : COPY.stopped[intent as ActionIntent],
    confirm:
      a.decision === "REVIEW"
        ? page
          ? COPY.page.review[intent]
          : COPY.review[intent as ActionIntent]
        : page
          ? COPY.page.suspicious[intent]
          : COPY.suspicious[intent as ActionIntent],
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
    body: mode === "unknown" ? notCheckedBody : null,
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

/**
 * Link pre-check (§5.5): a link to a host the server flagged BLOCK/WARN in the last 10 minutes.
 * The decision is the cached server answer for that host; nothing here re-scores anything.
 */
export function buildLinkModel(decision: "BLOCK" | "WARN", host: string): OverlayModel {
  const block = decision === "BLOCK";
  return {
    mode: block ? "block" : "confirm",
    tone: decision,
    label: DECISION_COPY[decision].label,
    title: COPY.page.linkStopped,
    body: fill(COPY.page.linkBody, { host }),
    mismatch: null,
    reasons: [],
    coverageLine: "",
    decidedLine: null,
    fullReportUrl: null,
    appealUrl: isAppealable(decision) ? appealUrl(host) : null,
    scanId: null,
    observedPayee: null,
    primaryLabel: COPY.goBack,
    secondaryLabel: block ? COPY.proceedAnyway : COPY.continue,
    secondaryConfirmLabel: block ? COPY.proceedConfirm : null,
    toast: null,
  };
}
