# SDK_SPECIFICATION

> **Status:** DECIDED · **Group:** 06-sdk · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** `trustlens-sdk` public surface, types, errors, retries, versioning.
> **Related:** [`SDK_INTEGRATION_GUIDE.md`](SDK_INTEGRATION_GUIDE.md) · [`../03-backend/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. Package

| Property | Value |
| --- | --- |
| Name | `trustlens-sdk` |
| Language | TypeScript 5, compiled to ESM + CJS + `.d.ts` |
| Runtime | Node ≥ 18, modern browsers, Cloudflare Workers, Deno, Bun |
| Transport | global `fetch` (no axios) |
| Size budget | ≤ 12 kB gzip |
| Build | `tsup`, `sideEffects: false` |
| Types | generated from `apps/api/openapi.json` |

---

## 2. Construction

```ts
import { TrustLens } from "trustlens-sdk";

const tl = new TrustLens({
  apiKey: process.env.TRUSTLENS_API_KEY!,   // tl_live_...
  baseUrl: "https://api.trustlens.example", // optional; defaults to production
  timeoutMs: 10_000,                         // optional
  maxRetries: 1,                             // optional, 0–2
  client: "checkout-service/2.4.1",          // optional, sent as X-Client
});
```

Rules:

- `apiKey` is required and validated for shape (`tl_live_` or `tl_ext_`); a malformed key throws
  `ConfigurationError` at construction.
- In a browser, constructing with a `tl_live_` key throws `ConfigurationError` unless
  `allowBrowserKey: true` **and** the key has only read scopes. This is a guard rail, not a
  security boundary: the README states plainly that live keys belong on a server.
- The client is safe to reuse; it holds no per-request mutable state.

---

## 3. Public methods

| Method | Signature | Endpoint |
| --- | --- | --- |
| `assess` | `(input: AssessInput) => Promise<Assessment>` | `POST /assess` |
| `scan` | `(input: ScanInput) => Promise<Scan>` | `POST /scans` + optional poll |
| `getScan` | `(id: string) => Promise<Scan>` | `GET /scans/{id}` |
| `verifyIdentity` | `(input: VerifyIdentityInput) => Promise<IdentityResult>` | `POST /verify-identity` |
| `verifyPayment` | `(input: VerifyPaymentInput) => Promise<PaymentResult>` | `POST /verify-payment` |
| `inspectRedirect` | `(input: RedirectInput) => Promise<RedirectResult>` | `POST /inspect-redirect` |
| `reportThreat` | `(input: ReportInput) => Promise<ReportResult>` | `POST /reports` |
| `getInvestigation` | `(id: string) => Promise<Investigation>` | `GET /investigations/{id}` |
| `startInvestigation` | `(scanId: string) => Promise<Investigation>` | `POST /investigations` |

Exactly nine methods. Adding one is a minor version; changing a signature is a major.

---

## 4. Types

```ts
export type Decision = "BLOCK" | "WARN" | "ALLOW" | "REVIEW" | "UNKNOWN";
export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type Intent = "browse" | "login" | "payment" | "download" | "data_submission";
export type SignalGroup =
  | "reputation" | "identity" | "credential_destination"
  | "payment_destination" | "infrastructure";

export interface Finding {
  id: string;
  code: string;                 // stable, e.g. "PAYEE_NOT_IN_VERIFIED_PROFILE"
  signal_group: SignalGroup;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: number;           // 0..1
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

export interface ActionContext {
  intent: Intent;
  claimed_organisation: { id: string; name: string } | null;
  observed_destination: string | null;
  expected_destinations: string[];
  payee: string | null;
  match: "exact" | "none" | "unverifiable";
}

export interface AssessInput {
  url: string;
  intent?: Intent;
  organisation_id?: string;
  form_action?: string;
  payee?: string;
  destination_host?: string;
  idempotencyKey?: string;
}

export interface PaymentResult {
  match: "exact" | "none" | "unverifiable";
  recipient_status: "verified" | "pending_attestation" | "revoked" | "unknown";
  normalised_value: string;
  organisation_has_verified_recipients: boolean;
  expected_recipients: { type: string; handle: string }[];
  related_reports: { report_id: string; confirmed_at: string }[];
  finding_codes: string[];
  confidence: number;
}
```

`Scan`, `IdentityResult`, `RedirectResult`, `ReportResult`, `Investigation` mirror the API responses in
`API_ENDPOINTS.md` and are re-exported from `packages/shared-types`.

---

## 5. Behavioural contract

| Concern | Contract |
| --- | --- |
| Timeout | `timeoutMs` (default 10 000), applied per attempt via `AbortController` |
| Retries | `maxRetries` (default 1); retried on network error, `429`, `502`, `503`, `504` only |
| Backoff | `Retry-After` if present, else `300ms × 2^attempt` with ±20% jitter |
| Idempotency | `assess`, `scan`, `reportThreat` accept `idempotencyKey`; if absent the SDK generates one per call |
| Redirects | `fetch` default (`follow`); the *inspection* endpoint handles chains server-side |
| Cookies | `credentials: "omit"` always; API keys only |
| Headers | `Authorization`, `Content-Type`, `X-Client`, `Idempotency-Key`; nothing else |
| Response parsing | Non-2xx → typed error; 2xx with invalid JSON → `ProtocolError` |

The SDK never *interprets* a decision. It returns it. Mapping `ALLOW` to "safe" in consumer code is
the consumer's mistake; the README warns about it and the SDK's JSDoc says "no known threat within
executed checks".

---

## 6. Errors

```ts
export class TrustLensError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly details?: unknown;
}
export class ConfigurationError extends TrustLensError {}
export class AuthenticationError extends TrustLensError {}   // 401
export class PermissionError extends TrustLensError {}       // 403
export class ValidationError extends TrustLensError {}       // 422
export class NotFoundError extends TrustLensError {}         // 404
export class ConflictError extends TrustLensError {}         // 409
export class RateLimitError extends TrustLensError { retryAfter: number | null }
export class ServerError extends TrustLensError {}           // 5xx
export class NetworkError extends TrustLensError {}          // no response
export class TimeoutError extends NetworkError {}
export class ProtocolError extends TrustLensError {}         // unparseable/unexpected shape
```

| Class | Retryable | Typical cause |
| --- | --- | --- |
| `ConfigurationError` | no | bad key/baseUrl |
| `AuthenticationError` | no | revoked or wrong key |
| `PermissionError` | no | missing scope |
| `ValidationError` | no | bad URL, rejected recipient |
| `NotFoundError` | no | unknown id or not visible |
| `ConflictError` | no | duplicate report, idempotency reuse |
| `RateLimitError` | yes | quota |
| `ServerError` | yes | 5xx |
| `NetworkError` / `TimeoutError` | yes | transport |
| `ProtocolError` | no | API/client version mismatch |

Every error carries `requestId` when the server supplied one; error messages instruct the developer to
log it.

---

## 7. Decision-handling helper

Optional, opt-in:

```ts
import { requiresConfirmation, shouldBlock } from "trustlens-sdk";

if (shouldBlock(result)) return refuse();          // decision === "BLOCK"
if (requiresConfirmation(result)) return confirm(); // "WARN"
```

Two tiny pure functions, no policy beyond the enum. They exist so integrators do not write
`if (result.decision === "BLOCK" || result.decision === "HIGH")` (a real bug we have seen: comparing a
decision to a risk level).

---

## 8. Versioning

| Change | Semver |
| --- | --- |
| New method, new optional field | minor |
| New error subclass | minor |
| Changed default timeout/retries | minor + changelog note |
| Renamed/removed field, changed enum member, changed method signature | major |
| New enum member in a response | minor; consumers must handle unknown values |

Compatibility: the SDK declares which API versions it supports (`/v1` only, for now). A major SDK
release may target `/v2` while `/v1` remains served.

---

## 9. Testing

- Type-level tests (`tsd`) that assert the public surface does not drift.
- Runtime tests with a mocked `fetch` covering: success, each error class, retry timing, timeout,
  idempotency header presence, and unknown enum handling.
- A "contract smoke" test in CI runs the SDK against the deployed preview API with a test key and
  asserts `assess` returns a valid `Assessment` for the demo domain (skipped when no key is present).
- Bundle-size check in CI (12 kB gzip budget).

---

## 10. Non-goals

- No caching of verdicts (integrators cache at their own risk and must respect the 10-minute guidance).
- No local scoring, no offline mode, no WASM.
- No React/Vue bindings in the core package (a framework wrapper is FUTURE).
- No automatic PII redaction of the caller's URLs beyond what the API stores.
