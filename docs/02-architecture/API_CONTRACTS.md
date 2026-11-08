# API_CONTRACTS

> **Status:** DECIDED · **Group:** 02-architecture · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** envelopes, enums, error codes, versioning, pagination, idempotency, rate limits, auth headers. Per-endpoint schemas live in `../03-backend/API_ENDPOINTS.md`.
> **Related:** [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) · [`../03-backend/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. Scope

Everything a client needs to speak to TrustLens correctly. If a field, code or header is not
defined here or in `API_ENDPOINTS.md`, it does not exist. Clients must not depend on undocumented
behaviour.

Three clients consume this contract: the React dashboard, the Chrome extension, and the TypeScript
SDK. Types are generated from the OpenAPI document; the contract is therefore executable.

---

## 2. Base URL and versioning

| Environment | Base URL |
| --- | --- |
| Local | `http://localhost:8000` |
| Deployed | `https://<api-host>` |

- All resource endpoints: `/api/v1/...`
- Health: `/health`, `/ready` (unversioned) and `/api/v1/health` (versioned mirror).
- Version changes only for breaking changes. Breaking means: removing a field, changing a type,
  renaming, changing an enum member, changing a default that alters semantics, or changing a status
  code for the same condition.
- Additive changes (new optional field, new enum member in a *response*, new endpoint) may ship in a
  minor release. Clients **must** tolerate unknown response fields and unknown enum members by
  mapping them to a safe local default (`UNKNOWN`), never by crashing.
- Deprecations: `Deprecation` and `Sunset` response headers, documented for at least one minor
  release.

---

## 3. Transport rules

| Rule | Value |
| --- | --- |
| Content type | `application/json; charset=utf-8` |
| Encoding | UTF-8 only |
| Timestamps | ISO-8601 UTC with `Z`, e.g. `2026-11-07T09:14:22Z` |
| Dates | `YYYY-MM-DD` |
| Durations | integer milliseconds, field suffixed `_ms` |
| IDs | ULID, 26 chars, `^[0-9A-HJKMNP-TV-Z]{26}$` |
| Field naming | `snake_case` (ADR-007) |
| Booleans | never nullable; absence means "not applicable" |
| Nulls | allowed only where documented; `null` means "checked, no value", never "not checked" |
| Numbers | risk score integer; confidences float `0.0–1.0` with 2 decimals |
| Max body | 256 kB (JSON), except evidence upload endpoints |
| Compression | gzip/br accepted |

---

## 4. Authentication headers

| Client | Header | Notes |
| --- | --- | --- |
| Web dashboard | `Authorization: Bearer <clerk_session_jwt>` | Session issued and refreshed by Clerk; the API sets no auth cookie |
| SDK / server | `Authorization: Bearer tl_live_<key>` | Key never in a browser bundle |
| Extension | `Authorization: Bearer tl_ext_<device_token>` | Stored in `chrome.storage.local` |
| Anonymous | none | Only `POST /scans` (limited), `GET /health`, public profile, appeal |

Additional headers:

| Header | Direction | Purpose |
| --- | --- | --- |
| `X-Request-Id` | response (always) | Correlation; echoed from request if supplied and well-formed |
| `Idempotency-Key` | request (mutations) | 8–128 chars; same key + same body within 24 h returns the original response |
| `X-Client` | request | `web/1.2.0`, `ext/0.4.1`, `sdk/1.0.0` — used in logs, never for authorisation |
| `Retry-After` | response (429/503) | Seconds |
| `X-RateLimit-Limit` / `-Remaining` / `-Reset` | response | Quota visibility |

CSRF: cookie-authenticated mutations require `Origin` to match an allowlisted origin. There is no
CSRF token endpoint; we rely on SameSite=Lax + Origin check + JSON-only bodies.

---

## 5. Response envelopes

### 5.1 Single resource

Resources are returned **directly** (no wrapper). This keeps generated types usable.

```json
{
  "id": "01JCM4Z9K8Q2R7T3V5W6X7Y8Z9",
  "status": "completed",
  "decision": "BLOCK",
  "created_at": "2026-11-07T09:14:22Z"
}
```

### 5.2 Collections

```json
{
  "data": [ { "id": "..." } ],
  "page": { "limit": 20, "next_cursor": "eyJpZCI6..." , "total_estimate": 132 }
}
```

`next_cursor` is `null` on the last page. `total_estimate` may be omitted on large sets.

### 5.3 Errors

```json
{
  "error": {
    "code": "TARGET_NOT_ALLOWED",
    "message": "The target resolves to a private address and cannot be scanned.",
    "request_id": "req_01JCM4ZA...",
    "details": [
      { "field": "url", "issue": "resolves_to_private_range", "observed": "10.0.0.5" }
    ]
  }
}
```

- `message` is human-readable, safe to display, and never contains internals.
- `details` is optional and only for validation-style errors.
- `request_id` always equals the `X-Request-Id` header.

### 5.4 Decision object (embedded in several resources)

```json
{
  "decision": "BLOCK",
  "risk_level": "CRITICAL",
  "risk_score": 87,
  "coverage": {
    "percent": 85,
    "collected": ["reputation", "identity", "payment_destination", "infrastructure"],
    "unavailable": ["credential_destination"],
    "skipped": []
  },
  "reasons": [
    "The page claims to be Northstar University but the domain is not one of its verified domains.",
    "The payment address is not registered by the organisation."
  ]
}
```

### 5.5 Enumerations

`decision`

| Value | Meaning | Client behaviour |
| --- | --- | --- |
| `BLOCK` | Decisive evidence of harm or an authorised-action mismatch | Refuse by default; override only with explicit confirmation |
| `WARN` | Suspicious indicators, insufficient for a block | Confirm before the sensitive action |
| `ALLOW` | No known threat **within executed checks** | Proceed; display coverage. Never label "safe" |
| `REVIEW` | Signals conflict, or coverage too low to decide | Proceed with caution; offer deeper scan/report |
| `UNKNOWN` | Checks could not run (target unreachable, blocked, budget) | Treat as unverified; show "not checked" |

`risk_level`: `CRITICAL` (75–100), `HIGH` (50–74), `MEDIUM` (25–49), `LOW` (0–24), `UNKNOWN`
(no score because coverage < 25% or scan failed). Bands and overrides: `RISK_ENGINE.md` §8.

`scan.status`: `queued` → `running` → `completed` | `partial` | `failed`.

`intent`: `browse` | `login` | `payment` | `download` | `data_submission`.

`signal_group`: `reputation` | `identity` | `credential_destination` | `payment_destination` |
`infrastructure`.

`severity`: `critical` | `high` | `medium` | `low` | `info`.

`coverage_state`: `collected` | `unavailable` | `skipped`.

`report.status`: `pending` | `reviewing` | `confirmed` | `dismissed`.

`investigation.status`: `queued` | `running` | `completed` | `partial` | `failed`.

`recipient_type`: `upi_vpa` | `iban` | `bank_account` | `wallet_address` | `payment_link`.

`match`: `exact` | `none` | `unverifiable`.

`verification.status`: `pending` | `verifying` | `verified` | `failed` | `expired` | `revoked`.

`entity.type`: `domain` | `url` | `ip` | `asn` | `nameserver` | `certificate` |
`certificate_authority` | `organisation` | `payment_recipient` | `campaign` | `threat_report`.

`edge.type`: see `../07-ai-intelligence/THREAT_GRAPH.md` §4 (19 types, canonical there).

---

## 6. HTTP status codes

| Code | When |
| --- | --- |
| `200` | Successful read or idempotent replay |
| `201` | Resource created |
| `202` | Accepted for async processing (scan created) |
| `204` | Successful delete with no body |
| `400` | Malformed JSON, missing required header |
| `401` | Missing/invalid credentials |
| `403` | Authenticated but not permitted (role/tenant/CSRF/demo-mode) |
| `404` | Not found **or** not visible to this tenant |
| `409` | State conflict (duplicate report, already reviewed, domain claimed) |
| `413` | Body too large |
| `422` | Validation failure or policy rejection (SSRF, invalid recipient) |
| `429` | Rate limited |
| `500` | Unhandled server error |
| `503` | Not ready (DB down, shutting down) |

`401` always includes `WWW-Authenticate: Bearer`. `403` never leaks whether a resource exists.

---

## 7. Error code registry

Stable strings. Adding a code is additive; never reuse a code for a different meaning.

### 7.1 General / auth

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 422 | Field-level failure; see `details` |
| `MALFORMED_JSON` | 400 | Unparseable body |
| `UNAUTHENTICATED` | 401 | No/invalid credentials |
| `INVALID_TOKEN` | 401 | Bad/expired JWT |
| `REVERIFICATION_REQUIRED` | 403 | Sensitive action (account deletion) needs a first-factor verification in the last 10 min; body also carries Clerk's `clerk_error` reverification hint |
| `INVALID_API_KEY` | 401 | Unknown, revoked, or malformed key |
| `INVALID_PAIRING_CODE` | 401 | Pairing code unknown or already used (named in API_ENDPOINTS §3; added to the registry) |
| `PAIRING_CODE_EXPIRED` | 410 | Pairing code older than 10 minutes |
| `INSUFFICIENT_SCOPE` | 403 | Key lacks the required scope |
| `FORBIDDEN` | 403 | Role/membership check failed |
| `CSRF_ORIGIN_MISMATCH` | 403 | Cross-origin cookie mutation |
| `DEMO_MODE_REQUIRED` | 403 | Operator-only simulated endpoint used outside demo |
| `NOT_FOUND` | 404 | Resource missing or not visible |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not supported on the resource (added: §6 had no code) |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 256 kB (added: §6 listed 413 without a code) |
| `CONFLICT` | 409 | Generic state conflict |
| `RATE_LIMITED` | 429 | Quota exhausted |
| `NOT_READY` | 503 | Dependency unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

### 7.2 Scanning and assessment

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_URL` | 422 | Not a parseable absolute http(s) URL |
| `UNSUPPORTED_SCHEME` | 422 | Not `http`/`https` (e.g. `javascript:`, `file:`) |
| `URL_HAS_CREDENTIALS` | 422 | `user:pass@host` rejected |
| `TARGET_NOT_ALLOWED` | 422 | SSRF policy rejection (private/loopback/metadata/internal name) |
| `DNS_RESOLUTION_FAILED` | 422 | Cannot resolve after retries (distinct from NXDOMAIN finding) |
| `UNSUPPORTED_PORT` | 422 | Port outside 80/443/8080/8443 allowlist |
| `SCAN_NOT_FOUND` | 404 | Unknown scan id |
| `SCAN_ALREADY_RUNNING` | 409 | Duplicate submission without idempotency key |
| `DEEP_SCAN_DISABLED` | 422 | `deep=true` while the flag is off |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different body |
| `NOT_IMPLEMENTED` | 501 | Documented but unimplemented capability |

### 7.3 Organisations and verification

| Code | Status | Meaning |
| --- | --- | --- |
| `ORGANISATION_NOT_FOUND` | 404 | — |
| `DOMAIN_ALREADY_CLAIMED` | 409 | Verified by another organisation |
| `DOMAIN_NOT_VERIFIED` | 409 | Attempt to use an unverified domain authoritatively |
| `VERIFICATION_TOKEN_MISMATCH` | 422 | Challenge present but wrong |
| `VERIFICATION_NOT_FOUND` | 422 | No TXT/file found |
| `VERIFICATION_FETCH_FAILED` | 502 | Challenge fetch failed (network/status) |
| `VERIFICATION_EXPIRED` | 410 | Challenge older than 7 days |
| `RECIPIENT_ALREADY_EXISTS` | 409 | Duplicate recipient in the org |
| `INVALID_RECIPIENT` | 422 | Syntax/checksum failure; `details.issue` names the rule |
| `LAST_ADMIN_REMOVAL` | 409 | Would leave the org with no admin |
| `NO_VERIFIED_DOMAIN` | 409 | Publishing (`status: active`) without a valid verified domain |
| `INVITE_NOT_FOUND` | 404 | Unknown, revoked, replaced or already-accepted invite token |
| `INVITE_EXPIRED` | 410 | Invite older than 7 days |
| `INVITE_EMAIL_MISMATCH` | 403 | Signed-in user's email differs from the invited email |

### 7.4 Reports, intelligence, investigations

| Code | Status | Meaning |
| --- | --- | --- |
| `REPORT_DUPLICATE` | 409 | Same reporter + URL within 24 h |
| `REPORT_ALREADY_REVIEWED` | 409 | Analyst race |
| `REVIEW_REASON_REQUIRED` | 422 | Confirm/dismiss without a reason |
| `INSUFFICIENT_COVERAGE_FOR_REVIEW` | 422 | Coverage < 50% blocks confirmation |
| `GRAPH_DEPTH_EXCEEDED` | 422 | `depth > 3` |
| `GRAPH_QUERY_TIMEOUT` | 422 | Graph query exceeded its 3 s budget (named in §11; added to the registry) |
| `ENTITY_NOT_FOUND` | 404 | — |
| `INVESTIGATION_LIMIT_REACHED` | 429 | Daily cap |
| `AI_UNAVAILABLE` | 503 | Provider unreachable **and** template path disabled (should not occur) |
| `INCIDENT_NOT_SIMULATED` | 403 | Attempt to create a non-simulated incident |

### 7.5 Appeals (added with the appeal workflow)

| Code | Status | Meaning |
| --- | --- | --- |
| `APPEAL_NOT_VERIFIED` | 409 | Approve attempted before the owner passed the domain challenge |
| `APPEAL_ALREADY_REVIEWED` | 409 | Appeal already approved or rejected |
| `APPEAL_ATTEMPTS_EXHAUSTED` | 409 | 20 challenge checks used; submit a new appeal |

Challenge failures reuse §7.3: `VERIFICATION_TOKEN_MISMATCH`, `VERIFICATION_NOT_FOUND`, `VERIFICATION_FETCH_FAILED`, `VERIFICATION_EXPIRED`.

---

## 8. Pagination, filtering, sorting, search

- `?limit=` default 20, max 100.
- `?cursor=` opaque; clients must not construct or parse it. Invalid cursor → `422 VALIDATION_FAILED`.
- Filtering uses explicit, documented query params per endpoint (`decision`, `status`,
  `organisation_id`, `from`, `to`, `q`).
- Sorting: `?sort=-created_at` (prefix `-` = descending). Only allowlisted fields per endpoint.
- Search (`q`) runs `ILIKE`/`pg_trgm` on URL, domain and organisation name. Max 200 chars.

---

## 9. Idempotency

Applies to: `POST /scans`, `POST /assess`, `POST /reports`, `POST /investigations`,
`POST /organisations`, `POST /organisations/{id}/domains`, `POST /organisations/{id}/recipients`.

Rules:

1. `Idempotency-Key` is optional but **required** for extension and SDK retries.
2. Same key + same body hash within 24 h → replay the stored response (`200`), with header
   `Idempotent-Replay: true`.
3. Same key + different body → `409 IDEMPOTENCY_KEY_REUSED`.
4. Storage: `idempotency_keys` table, keyed by (actor_id, key), with body hash and response body.
5. Exception: `POST /organisations/{id}/domains` is naturally idempotent per domain (a retry
   issues a fresh challenge and invalidates the previous one) and its response is **not** stored,
   because it contains the one-time challenge token, which is otherwise kept only as a hash.

---

## 10. Rate limits

Token bucket per identity; `Retry-After` in seconds. Counters live in **Upstash Redis** so two API
workers enforce one limit. If Redis is unavailable, limits degrade to per-worker counters
(approximate, never stricter than documented) and the response includes
`X-RateLimit-Degraded: true` — clients must treat that as advisory, not as permission to burst.

| Scope | Anonymous (per IP) | Authenticated (per user) | API key | Extension device |
| --- | --- | --- | --- | --- |
| `POST /scans` | 5 / hour | 60 / hour | 600 / hour | 300 / hour |
| `POST /assess` | 20 / hour | 300 / hour | 3000 / hour | 1200 / hour |
| `POST /reports` | — | 30 / hour | 100 / hour | 30 / hour |
| Auth login | 10 / 15 min / IP + 5 / 15 min / account | — | — | — |
| `POST /investigations` | — | 20 / day | 50 / day | — |
| Verification attempts | — | 5 / hour / domain | — | — |
| Read endpoints | 60 / min | 600 / min | 6000 / min | 1200 / min |
| `POST /auth/extension/pair` | — | 10 / hour | — | — |
| Clerk signup/signin | Managed by Clerk (bot protection + per-IP) | — | — | — |

Limits are per endpoint group, not global. Exceeding returns `429 RATE_LIMITED` with
`X-RateLimit-Remaining: 0`.

Implementation notes (2026-11-08): counters are a fixed window aligned to the epoch (one Upstash REST
pipeline per hit: `INCR` + `EXPIRE NX`), an approximation of the token bucket that is never stricter
than the table. `X-RateLimit-Degraded: true` is sent only when the per-process fallback answered.
`POST /verify-identity`, `POST /verify-payment` and `POST /inspect-redirect` use the `POST /assess`
budgets as separate counters; `POST /appeals` is 5/hour and `POST /appeals/{id}/verify` 20/hour per
IP (the "verification attempts" row, applied to the anonymous appeal path).

---

## 11. Timeouts and budgets (server-side)

| Operation | Budget | On exceed |
| --- | --- | --- |
| DNS query | 2 s, 1 retry | `UNAVAILABLE` |
| RDAP fetch | 4 s | `UNAVAILABLE` |
| TLS handshake | 5 s | finding `TLS_HANDSHAKE_FAILED` or `UNAVAILABLE` for non-HTTPS |
| Single HTTP request (redirect hop) | 5 s | hop recorded as failed |
| Page fetch | 10 s, 2 MB cap | `PAGE_FETCH_BLOCKED`/truncated |
| Playwright render | 15 s, 25 MB | coverage `PAGE_RENDER = UNAVAILABLE` |
| Whole scan | 60 s | `status = partial` |
| LLM call | 45 s, 1 retry on 429 | template fallback |
| Graph query | 3 s | `504`-equivalent: `422 GRAPH_QUERY_TIMEOUT` |

Clients should use 15 s read timeouts for reads and 30 s for mutations; polling intervals 1 s
(scan) and 1 s (investigation) with a 90 s client-side give-up that shows the retained partial state.

---

## 12. Caching directives

| Resource | Directive |
| --- | --- |
| `GET /organisations/{id}/public-profile` | `public, max-age=300, stale-while-revalidate=600` |
| `GET /scans/{id}` (terminal) | `private, max-age=60` |
| `GET /scans/{id}` (running) | `no-store` |
| Auth, reports, investigations, usage | `no-store` |
| Graph, campaigns | `private, max-age=120` |

The extension additionally caches verdicts for 10 minutes per URL. It **must** treat a cached
`ALLOW` older than 10 minutes as `UNKNOWN` until re-checked.

---

## 13. Validation rules (shared)

| Field | Rule |
| --- | --- |
| `url` | absolute, http/https, ≤ 2048 chars, no credentials, host ≤ 253 chars, port in {80,443,8080,8443} |
| `email` | RFC 5322 subset, ≤ 254 chars, normalised lowercase |
| `password` | 10–128 chars, not in a common-password list, not equal to email |
| `organisation.name` | 2–120 chars |
| `domain` | punycode-normalised, at least one dot, no wildcard, no scheme |
| `upi_vpa` | `^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z\-]{1,31}$` (hyphen allowed in the handle: the canonical demo payee is `fees@northstar-demo`) |
| `iban` | 15–34 alphanumeric, mod-97 == 1 |
| `justification` | 10–500 chars, plain text, control chars stripped |
| `reason` (review) | 10–500 chars |
| `idempotency_key` | 8–128 chars, `[A-Za-z0-9._:-]+` |

Unknown fields in request bodies → `422 VALIDATION_FAILED` (`extra="forbid"`). This is deliberate:
a typo must fail loudly, not silently do nothing.

---

## 14. Contract testing

- `apps/api` generates `openapi.json` in CI; a diff fails the build unless committed.
- `packages/shared-types` regenerates from that file; a stale file fails the build.
- Every endpoint in `API_ENDPOINTS.md` has a test asserting status codes for: unauthenticated,
  unauthorised, invalid body, not found, and the happy path.
- `decision`, `risk_level`, `intent`, `signal_group`, `severity`, `coverage_state` enums are asserted
  against a single shared fixture file so a rename breaks exactly one place.

---

## 15. Open questions

| ID | Question | Current answer |
| --- | --- | --- |
| CQ-1 | Should `total_estimate` be exact? | No; approximate, may be omitted |
| CQ-2 | Public checker: separate endpoint or `POST /scans` anonymous? | Same endpoint, lower limits |
| CQ-3 | Do we expose `webhook` subscriptions now? | No (FUTURE) |
| CQ-4 | Is `snake_case` acceptable to SDK users? | Yes (ADR-007); documented prominently |
