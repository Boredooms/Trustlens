// User-facing strings. Mirrors the canonical copy deck (UI_UX_SPECIFICATIONS.md §19) and
// apps/web/src/lib/copy.ts. ALLOW is "No known threat" — never a guarantee. CI greps the bundle for
// forbidden verdict words (BROWSER_PROTECTION_LOGIC.md §7); keep them out of this file entirely.
import type { ActionIntent, Decision, FailureCode } from "./types";

export interface DecisionCopy {
  /** Short label, identical to the dashboard VerdictBadge. */
  label: string;
  /** Popup headline (BROWSER_PROTECTION_LOGIC.md §7). `{reason}` / `{coverage}` are filled in. */
  headline: string;
  /** Screen-reader string. */
  srText: string;
  /** Lucide icon name (DESIGN_SYSTEM.md §2.3). */
  icon: "shield-x" | "shield-alert" | "shield-check" | "search" | "shield-question";
  /** Toolbar badge (BROWSER_PROTECTION_LOGIC.md §2). */
  badge: string;
}

export const DECISION_COPY: Record<Decision, DecisionCopy> = {
  BLOCK: {
    label: "Blocked",
    headline: "Blocked: {reason}",
    srText: "TrustLens decision: blocked.",
    icon: "shield-x",
    badge: "!",
  },
  WARN: {
    label: "Suspicious",
    headline: "Suspicious: {reason}",
    srText: "TrustLens decision: suspicious.",
    icon: "shield-alert",
    badge: "!",
  },
  ALLOW: {
    label: "No known threat",
    headline: "No known threat ({coverage}% checked)",
    srText: "TrustLens decision: no known threat in the checks that ran. This is not a guarantee.",
    icon: "shield-check",
    badge: "",
  },
  REVIEW: {
    label: "Needs review",
    headline: "Needs review: not enough evidence",
    srText: "TrustLens decision: needs review. Signals conflict or coverage is too low.",
    icon: "search",
    badge: "?",
  },
  UNKNOWN: {
    label: "Not verified",
    headline: "Not verified: {reason}",
    srText: "TrustLens could not verify this page. It was not checked.",
    icon: "shield-question",
    badge: "?",
  },
};

export const COPY = {
  product: "TrustLens",
  allowSublabel: "Based on {n}% coverage. This is not a guarantee.",
  allowToast: "No known threat in the checks that ran · coverage {n}%",
  allowToastNoCoverage: "No known threat in the checks that ran · coverage not reported",
  coverageLine: "We checked {n}% of signal groups.",
  coverageMissing: "Coverage was not reported for this check.",
  decidedAgo: "Decided {ago}.",
  checking: { payment: "Checking this payment…", login: "Checking this login…" },
  stopped: { payment: "Payment stopped", login: "Login stopped" },
  suspicious: { payment: "Check this payment first", login: "Check this login first" },
  review: { payment: "This payment needs review", login: "This login needs review" },
  couldNotVerify: "Could not verify this page",
  couldNotVerifyBody: {
    payment: "TrustLens could not check this payment. It was not checked — decide for yourself.",
    login: "TrustLens could not check this login. It was not checked — decide for yourself.",
  },
  payeeMismatch: "This page asks you to pay {observed}. {org} has registered {expected}.",
  payeeObservedOnly: "This page asks you to pay {observed}.",
  credentialMismatch:
    "This login form sends your password to {observed}, which is not an approved {org} login endpoint.",
  unknownOrg: "The organisation this page claims to be",
  goBack: "Go back",
  proceedAnyway: "Proceed anyway",
  proceedConfirm: "I understand the risk — proceed",
  continue: "Continue",
  continueAnyway: "Continue without a check",
  details: "Details",
  dismiss: "Dismiss",
  fullReport: "Full report",
  reportPage: "Report this page",
  appealSite: "Is this your site? Appeal this decision",
  reportSite: "Report this site",
  reportSent: "Report sent. You'll see updates in the dashboard.",
  reportQueued: "Could not send the report right now.",
  reportJustificationHint: "Optional: what happened? (10–500 characters)",
  overrideCounted: "Proceeding. This override is counted locally.",
  reasonsHeading: "Why",
  warnNoReason: "open TrustLens for details",
  pausedBanner: "Protection paused",
  pair: {
    heading: "Connect TrustLens",
    body: "In the dashboard open Developers → Browser extension, choose “Generate pairing code”, and enter the 8-character code here.",
    codeLabel: "Pairing code",
    submit: "Connect",
    working: "Working…",
    connected: "Connected",
    reconnect: "Reconnect TrustLens to keep protecting you.",
    invalidCode: "That code is not valid or has expired. Get a new one from the dashboard.",
    failed: "Could not connect right now. Try again in a moment.",
  },
  popup: {
    currentPage: "This page",
    noPage: "This tab cannot be checked.",
    watchPage: "Watch this tab for logins and payments",
    watching: "Watching this tab.",
    options: "Settings",
    version: "Version {v}",
  },
  options: {
    apiStatus: "API status",
    apiUp: "Reachable",
    apiDown: "Unreachable — pages will show “not checked”.",
    pairing: "Pairing",
    unpair: "Disconnect this browser",
    unpaired: "Disconnected. Pages will show “not checked” until you reconnect.",
    clearData: "Clear all local data",
    cleared: "Local data cleared.",
    privacyHeading: "What TrustLens sends",
    privacy: [
      "Sent on a check: the page address, the form's destination address, whether a password field exists, and the payee text the page itself displays.",
      "Never read or sent: anything you type (passwords, one-time codes, card numbers), cookies, page HTML, screenshots, or your browsing history.",
      "The server makes every decision. If it cannot be reached, TrustLens says the page was not checked.",
    ],
  },
} as const;

export const FAILURE_COPY: Record<FailureCode, string> = {
  NOT_PAIRED: "TrustLens is not connected. Connect it in the popup to check pages.",
  RECONNECT: "Reconnect TrustLens to keep protecting you.",
  MISCONFIGURED: "This build needs an updated pairing.",
  RATE_LIMITED: "Too many checks right now — pausing for {n}s.",
  UNAVAILABLE: "TrustLens is unavailable — this page was not checked.",
  TIMEOUT: "TrustLens is unavailable — this page was not checked.",
  BAD_RESPONSE: "TrustLens is unavailable — this page was not checked.",
  CANNOT_CHECK_ADDRESS: "This address can't be checked.",
  CANNOT_CHECK_PAGE: "This page can't be checked.",
  PAUSED: "Protection paused — this page was not checked.",
  STALE: "Re-checking… the last result is more than 10 minutes old.",
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export function failureText(code: FailureCode, retryAfter?: number | null): string {
  return fill(FAILURE_COPY[code], { n: retryAfter ?? 60 });
}

export function intentCopy<T extends Record<ActionIntent, string>>(table: T, intent: ActionIntent): string {
  return table[intent];
}

export function relativeAgo(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
