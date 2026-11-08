// Canonical product strings — UI_UX_SPECIFICATIONS.md §19 and DESIGN_SYSTEM.md §8.
// The extension mirrors this module (design-system-guardrails §6). Do not inline verdict copy elsewhere.
// ALLOW is "No known threat" — never safe / secure / trusted / verified (BR-002); enforced by a test.

import type { Decision, RiskLevel, Severity } from "@/lib/api/enums";

export interface DecisionCopy {
  label: string;
  /** One-line plain meaning shown next to the badge. */
  meaning: string;
}

export const DECISION_COPY: Record<Decision, DecisionCopy> = {
  BLOCK: {
    label: "Blocked",
    meaning: "Decisive evidence of harm, or the action goes somewhere the organisation has not authorised.",
  },
  WARN: {
    label: "Suspicious",
    meaning: "Suspicious indicators, not enough to block. Confirm before the sensitive action.",
  },
  ALLOW: {
    label: "No known threat",
    meaning: "No known threat in the checks that ran. This is not a guarantee.",
  },
  REVIEW: {
    label: "Needs review",
    meaning: "Signals conflict, or too few checks ran to decide. Proceed with caution.",
  },
  UNKNOWN: {
    label: "Not verified",
    meaning: "The checks could not run, so nothing was decided. Treat this as unchecked.",
  },
};

export function allowSublabel(coveragePercent: number): string {
  return `Based on ${Math.round(coveragePercent)}% coverage. This is not a guarantee.`;
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "No score",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const INTENT_LABEL: Record<string, string> = {
  browse: "Browse",
  login: "Login",
  payment: "Payment",
  download: "Download",
  data_submission: "Data submission",
};

/** Organisation membership roles (AUTHENTICATION_AUTHORIZATION.md §5.2). */
export const ORG_ROLE_LABEL: Record<string, string> = {
  org_admin: "Administrator",
  org_member: "Member",
};

export const ORG_ROLES = ["org_member", "org_admin"] as const;

export const SECTORS: ReadonlyArray<readonly [string, string]> = [
  ["education", "Education"],
  ["fintech", "Financial services"],
  ["government", "Government"],
  ["healthcare", "Healthcare"],
  ["retail", "Retail and e-commerce"],
  ["nonprofit", "Non-profit"],
  ["other", "Other"],
];

export const DOMAIN_KIND_LABEL: Record<string, string> = {
  official: "Official site",
  application: "Applications",
  login: "Login",
  payment: "Payment",
};

export const LOGIN_HOSTS_MODE_LABEL: Record<string, string> = {
  domain_wildcard: "Any subdomain of a verified domain",
  explicit_only: "Only hosts listed as login domains",
};

export const APPEAL_STATUS_LABEL: Record<string, string> = {
  pending_challenge: "Waiting for owner proof",
  challenge_verified: "Owner proven — needs review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

export const RECIPIENT_TYPE_LABEL: Record<string, string> = {
  upi_vpa: "UPI ID",
  iban: "IBAN",
  bank_account: "Bank account",
  wallet_address: "Wallet address",
  payment_link: "Payment link",
};

export const SIGNAL_GROUP_LABEL: Record<string, string> = {
  reputation: "Reputation",
  identity: "Identity",
  credential_destination: "Credential destination",
  payment_destination: "Payment destination",
  infrastructure: "Infrastructure",
};

export const SIGNAL_GROUP_EXPLAINER: Record<string, string> = {
  reputation: "Known reports, blocklists and confirmed community findings for this domain.",
  identity: "Whether the domain belongs to the organisation the page claims to be.",
  credential_destination: "Where a login form would actually send your password.",
  payment_destination: "Whether the payee or payment host is registered by the organisation.",
  infrastructure: "DNS, certificate, registration age and hosting shared with known threats.",
};

export const COPY = {
  verdictSr: (label: string, risk: string) => `Decision: ${label.toLowerCase()}. Risk: ${risk.toLowerCase()}.`,
  payeeMismatch: (observed: string, org: string, expected: string) =>
    `This page asks for ${observed}. ${org} has registered ${expected}.`,
  credentialMismatch: (observed: string, org: string) =>
    `This login form sends your password to ${observed}, which is not an approved ${org} login endpoint.`,
  unverifiable: (org: string, thing: string) =>
    `We could not verify this claim. ${org} has no registered ${thing} to compare against.`,
  coldStart: "Waking the analysis engine. This can take up to a minute.",
  simulated: "Simulated for demonstration. Not a real incident.",
  simulatedTitle: "This data is generated for demonstration and is not a real incident",
  lowCoverage:
    "Fewer than half of the checks ran. A result that would have read \"No known threat\" is held for review instead, and below 25% no score is given. A block from a hard rule still stands.",
  rulesDecide: "Decided by rules — the narrative cannot change it",
  aiNarrative: "AI-written narrative",
  templateNarrative: "Deterministic template — no AI used",
  campaignConfidence: "confidence = the weaker of the two strongest shared indicators",
  devSignInTitle: "Development sign-in — not available in production",
} as const;

/** Hard overrides — RISK_ENGINE.md §8.1. Shown as chip tooltips. */
export const OVERRIDE_COPY: Record<string, string> = {
  "O-1": "The domain is on the analyst blocklist.",
  "O-2": "Payment intent: the payee is not one the organisation registered, and it has registered at least one.",
  "O-3": "Payment intent: the payee is linked to a confirmed scam report.",
  "O-4": "Login intent: credentials go to an unapproved destination or over plain HTTP.",
  "O-5": "Login intent: credentials are posted to a third-party domain.",
  "O-6": "The domain has a known malicious reputation.",
  "O-7": "The target could not be reached and nothing else was found.",
};

/** Error code → what it means for the user. Unknown codes fall back to the server message. */
export const ERROR_HINT: Record<string, string> = {
  INVALID_URL: "Enter a full address starting with http:// or https://.",
  UNSUPPORTED_SCHEME: "Only http and https addresses can be scanned.",
  URL_HAS_CREDENTIALS: "Remove the user name and password from the address.",
  TARGET_NOT_ALLOWED: "That address points to a private or internal network, which TrustLens never scans.",
  UNSUPPORTED_PORT: "Only ports 80, 443, 8080 and 8443 can be scanned.",
  RATE_LIMITED: "You have reached the request limit. Wait a few minutes and try again.",
  INVALID_TOKEN: "Your session expired. Sign in again.",
  UNAUTHENTICATED:
    "The API did not accept your sign-in. With the development sign-in, the API must run with DEV_AUTH_ENABLED=true.",
  FORBIDDEN: "Your role does not allow this action.",
  DEMO_MODE_REQUIRED: "Simulated incidents can only be created while the API runs in demo mode.",
  INSUFFICIENT_COVERAGE_FOR_REVIEW: "The linked scan ran fewer than half of its checks, so the report cannot be confirmed.",
  REPORT_ALREADY_REVIEWED: "Another analyst reviewed this report first. Reload to see their decision.",
  REPORT_DUPLICATE: "You already reported this address in the last 24 hours.",
  INVESTIGATION_LIMIT_REACHED: "The daily investigation limit is reached. Try again tomorrow.",
  NOT_READY: "The analysis engine is starting. Retry in a few seconds.",
  NETWORK_ERROR: "Check that the API is running and that VITE_API_BASE_URL points to it.",
  // Organisations and verification (API_CONTRACTS.md §7.3, ORGANISATION_TRUST_PROFILES.md §4.2)
  ORGANISATION_NOT_FOUND: "That organisation does not exist or is not visible to you.",
  NO_VERIFIED_DOMAIN: "Verify at least one domain before publishing. Publishing makes the profile authoritative for identity checks.",
  DOMAIN_ALREADY_CLAIMED:
    "Another organisation has already claimed this domain. If it is yours, contact support to open a dispute.",
  DOMAIN_NOT_VERIFIED: "This domain is not verified yet. Run the verification check first.",
  VERIFICATION_TOKEN_MISMATCH:
    "We found a record, but its value does not match. Copy the value again exactly, including the tl-verify= prefix.",
  VERIFICATION_NOT_FOUND:
    "We could not find the record or file yet. DNS changes can take a few minutes to propagate; try again shortly.",
  VERIFICATION_FETCH_FAILED:
    "We could not reach the domain to check. Make sure it serves HTTPS with a valid certificate, then try again.",
  VERIFICATION_EXPIRED: "This challenge is older than 7 days. Remove the domain and add it again to get a new value.",
  RECIPIENT_ALREADY_EXISTS: "This payment address is already registered for the organisation.",
  INVALID_RECIPIENT: "That payment address is not valid for the chosen type.",
  REVERIFICATION_REQUIRED:
    "Confirm it's you to delete your account: verify your sign-in when asked, then try again.",
  LAST_ADMIN_REMOVAL: "An organisation must keep at least one administrator. Promote another member first.",
  CONFLICT: "This conflicts with something that already exists. Reload and try again.",
  INVITE_NOT_FOUND: "This invitation link is not valid, or it was already used or revoked. Ask an administrator for a new one.",
  INVITE_EXPIRED: "This invitation has expired. Ask an administrator to send a new one.",
  INVITE_EMAIL_MISMATCH:
    "This invitation was sent to a different email address. Sign in with the invited email, or ask for a new invitation.",
  APPEAL_NOT_VERIFIED: "An appeal can be approved only after the site owner has passed the domain challenge.",
  APPEAL_ALREADY_REVIEWED: "Another analyst reviewed this appeal first. Reload to see their decision.",
  APPEAL_ATTEMPTS_EXHAUSTED: "Too many failed checks for this appeal. Submit a new appeal to get a fresh challenge.",
};
