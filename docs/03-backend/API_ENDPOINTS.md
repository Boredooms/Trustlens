# API_ENDPOINTS

> **Status:** DECIDED · **Group:** 03-backend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** every endpoint's path, auth, request, response, status codes and errors.
> **Conventions:** [`../02-architecture/API_CONTRACTS.md`](../02-architecture/API_CONTRACTS.md) (envelopes, enums, error registry, limits). This document does not redefine them.
> **Related:** [`RISK_ENGINE.md`](RISK_ENGINE.md) · [`ORGANISATION_TRUST_PROFILES.md`](ORGANISATION_TRUST_PROFILES.md)

---

## 1. Index of endpoints (69 active)

#72 (message analysis) is owned by [`MESSAGE_ANALYSIS.md`](MESSAGE_ANALYSIS.md) §2: auth `assess:read`,
rate group `messages` (60/h user, 600/h API key), body `{text ≤ 20000, channel, organisation_id?}`,
response `MessageAnalysis`. Assessment responses and scan read models also carry the derived
`risk_class` (RISK_ENGINE.md §8.7).

Health 3 · Auth 3 (+4 delegated to Clerk) · Devices 2 · Scans 3 · Assess 4 ·
Organisations 5 · Domains 4 · Recipients 4 · Members 4 · Reports 4 · Appeals 1 ·
Intelligence 5 · Certificates 7 · Investigations 3 · Developer 4 · Overview 1 · Audit 1 ·
Invites 2 (#63–#64, added after the original numbering, so they are appended) · Account deletion 1
(#65) · Operator demo controls 2 (#66–#67).

Routes 4–7 are **not implemented by this API**: signup, login, refresh and logout are handled by
Clerk in the browser (ADR-012). They remain listed so the numbering, and every cross-reference
to it, stays stable.

| # | Method | Path |
| --- | --- | --- |
| 1 | GET | `/health` |
| 2 | GET | `/ready` |
| 3 | GET | `/api/v1/health` |
| 4 | — | *(delegated: Clerk signup)* |
| 5 | — | *(delegated: Clerk signin)* |
| 6 | — | *(delegated: Clerk refresh)* |
| 7 | POST | `/api/v1/auth/logout` |
| 8 | GET | `/api/v1/auth/me` |
| 9 | POST | `/api/v1/auth/extension/pair` |
| 10 | POST | `/api/v1/auth/extension/exchange` |
| 11 | GET | `/api/v1/auth/extension/devices` |
| 12 | DELETE | `/api/v1/auth/extension/devices/{deviceId}` |
| 13 | POST | `/api/v1/scans` |
| 14 | GET | `/api/v1/scans` |
| 15 | GET | `/api/v1/scans/{scanId}` |
| 16 | POST | `/api/v1/assess` |
| 17 | POST | `/api/v1/verify-identity` |
| 18 | POST | `/api/v1/verify-payment` |
| 19 | POST | `/api/v1/inspect-redirect` |
| 20 | GET | `/api/v1/organisations` |
| 21 | POST | `/api/v1/organisations` |
| 22 | GET | `/api/v1/organisations/{orgId}` |
| 23 | PATCH | `/api/v1/organisations/{orgId}` |
| 24 | GET | `/api/v1/organisations/{orgId}/public-profile` |
| 25 | GET | `/api/v1/organisations/{orgId}/domains` |
| 26 | POST | `/api/v1/organisations/{orgId}/domains` |
| 27 | POST | `/api/v1/organisations/{orgId}/domains/{domainId}/verify` |
| 28 | DELETE | `/api/v1/organisations/{orgId}/domains/{domainId}` |
| 29 | GET | `/api/v1/organisations/{orgId}/recipients` |
| 30 | POST | `/api/v1/organisations/{orgId}/recipients` |
| 31 | POST | `/api/v1/organisations/{orgId}/recipients/{recipientId}/verify` |
| 32 | DELETE | `/api/v1/organisations/{orgId}/recipients/{recipientId}` |
| 33 | GET | `/api/v1/organisations/{orgId}/members` |
| 34 | POST | `/api/v1/organisations/{orgId}/members` |
| 35 | PATCH | `/api/v1/organisations/{orgId}/members/{userId}` |
| 36 | DELETE | `/api/v1/organisations/{orgId}/members/{userId}` |
| 37 | POST | `/api/v1/reports` |
| 38 | GET | `/api/v1/reports` |
| 39 | GET | `/api/v1/reports/{reportId}` |
| 40 | POST | `/api/v1/reports/{reportId}/review` |
| 41 | POST | `/api/v1/appeals` |
| 42 | GET | `/api/v1/intelligence/graph/{entityId}` |
| 43 | GET | `/api/v1/intelligence/entities` |
| 44 | GET | `/api/v1/intelligence/entities/{entityId}` |
| 45 | GET | `/api/v1/campaigns` |
| 46 | GET | `/api/v1/campaigns/{campaignId}` |
| 47 | GET | `/api/v1/certificates` |
| 48 | GET | `/api/v1/certificates/{certificateId}` |
| 49 | GET | `/api/v1/certificates/monitors` |
| 50 | POST | `/api/v1/certificates/monitors` |
| 51 | DELETE | `/api/v1/certificates/monitors/{monitorId}` |
| 52 | GET | `/api/v1/certificates/incidents` |
| 53 | POST | `/api/v1/certificates/incidents` |
| 54 | POST | `/api/v1/investigations` |
| 55 | GET | `/api/v1/investigations/{investigationId}` |
| 56 | GET | `/api/v1/investigations/{investigationId}/export` |
| 57 | GET | `/api/v1/api-keys` |
| 58 | POST | `/api/v1/api-keys` |
| 59 | DELETE | `/api/v1/api-keys/{keyId}` |
| 60 | GET | `/api/v1/usage` |
| 61 | GET | `/api/v1/overview` |
| 62 | GET | `/api/v1/audit-logs` |
| 63 | DELETE | `/api/v1/organisations/{orgId}/invites/{inviteId}` |
| 64 | POST | `/api/v1/invites/{token}/accept` |
| 65 | DELETE | `/api/v1/auth/me` |
| 66 | GET | `/api/v1/admin/demo` |
| 67 | POST | `/api/v1/admin/demo/reset` |
| 68 | POST | `/api/v1/reports/{reportId}/anchor` |
| 69 | GET | `/api/v1/reports/{reportId}/anchor` |
| 70 | GET | `/api/v1/public/verify/{reportId}` |
| 71 | POST | `/api/v1/public/verify/{reportId}` |
| 72 | POST | `/api/v1/messages/analyse` |

---

## 2. Health

### `GET /health` — liveness

Unauthenticated. No DB access. Always `200` while the process runs.

```json
{ "status": "ok", "service": "trustlens-api", "version": "0.4.1",
  "uptime_s": 8412, "timestamp": "2026-11-07T09:14:22Z" }
```

### `GET /ready` — readiness

```json
{ "status": "ready", "checks": {
    "database": { "status": "ok", "latency_ms": 3 },
    "scanner":  { "status": "ok", "queue_depth": 0, "breaker": "closed" },
    "llm":      { "status": "degraded", "detail": "no_api_key" } } }
```

`200` when `database` is ok (LLM degradation does not block readiness). `503 NOT_READY` otherwise,
with `checks.database.detail`. Execution time budget: 1 s.

### `GET /api/v1/health` — versioned mirror

Same body as `/ready` plus `"api_version": "v1"`, for clients that only know the versioned prefix.

---

## 3. Auth

### Registration, login and refresh — delegated

There are no `/auth/register`, `/auth/login` or `/auth/refresh` routes. The browser renders Clerk's
`<SignIn />` / `<SignUp />` components. Clerk owns password hashing, email verification, password
reset, MFA, session lifetime, bot protection and its own rate limits. The API's only job is to verify
the resulting session JWT (JWKS, `azp`-bound) and upsert the local user row — see
`../03-backend/AUTHENTICATION_AUTHORIZATION.md` §2–§4.

Why keep the numbers 4–7 in the index: downstream documents reference endpoints by index, and
renumbering 58 rows to hide four absent ones would create more drift than it removes.

### `POST /auth/logout`

Auth: Clerk session JWT (or API key). No body.
Clears any server-side cache for the actor and writes an `auth.logout` audit row. It does **not**
revoke the Clerk session — the client calls `signOut()` from `useClerk()` for that. The endpoint is
idempotent and returns `204` either way.

### `GET /auth/me`

Auth: any principal.
`200`:

```json
{ "id": "01J...", "email": "a@example.com", "display_name": "Aisha",
  "role": "user", "organisations": [{"id": "01J...", "name": "Northstar", "role": "org_admin"}],
  "created_at": "...", "last_login_at": "..." }
```

### `POST /auth/extension/pair`

Auth: access token. Body: `{ "device_name": "Chrome on Windows" }`.
`201` → `{ "code": "7K4Q-2M9X", "expires_at": "...", "expires_in": 600 }`.
Errors: `401`, `429`.

### `POST /auth/extension/exchange`

Auth: none (the code is the credential). Body: `{ "code": "7K4Q-2M9X", "device_name": "..." }`.
`201` → `{ "device_token": "tl_ext_...", "device_id": "...", "expires_at": "..." }`.
Errors: `401 INVALID_PAIRING_CODE`, `410 PAIRING_CODE_EXPIRED`, `429`.

### `GET /auth/extension/devices`

Auth: session. `200` → list of `{id, name, last_used_at, created_at, expires_at}`.
Never returns tokens.

### `DELETE /auth/extension/devices/{deviceId}`

Auth: session, owner. `204`. Revokes immediately.

### `DELETE /auth/me` — delete my account (#65, USER_JOURNEYS J11, NFR-032)

Auth: human session only. Body `{"confirm_email": "<account email>"}` (case-insensitive).

- `422 VALIDATION_FAILED` `details: [{field: "confirm_email", issue: "mismatch"}]`.
- `409 LAST_ADMIN_REMOVAL` `details: [{organisation_id, name}]` when the caller is the sole
  `org_admin` of any organisation (transfer first).
- `204`: API keys and extension devices revoked, refresh tokens revoked, pairing codes deleted,
  memberships and pending invites removed, filed reports anonymised (`reporter_user_id` null,
  `anonymised_at` set), scans deleted with findings/evidence/investigations **unless** a confirmed
  report references them (kept, `user_id` null), usage counters deleted, the `users` row anonymised
  and deactivated (kept so audit references survive), audit `user.delete`, and the Clerk user
  deleted via the Backend API after commit (best effort). Signing in again creates a new account.

- `403 REVERIFICATION_REQUIRED` (Clerk sessions only) when the session's first factor was not
  verified in the last 10 minutes (`fva` claim). The body also carries Clerk's reverification hint at
  the top level (`clerk_error`), so `useReverification` opens Clerk's modal and retries
  (`AUTHENTICATION_AUTHORIZATION.md`, "Account deletion re-verification").

### `POST /webhooks/clerk` (not under `/api/v1`, not in OpenAPI)

Svix-signed Clerk events, verified over the raw body before parsing (`svix-id`, `svix-timestamp`
within ±5 min, `v1,` HMAC-SHA256; rotated secrets supported). `user.created`/`user.updated` upsert
email and name; `user.deleted` runs the same anonymisation as `DELETE /auth/me` without the
last-admin gate (orphaned organisations are listed on the audit row). `401 INVALID_TOKEN` on a bad
signature, `503 NOT_READY` when `CLERK_WEBHOOK_SECRET` is unset, `204` otherwise (idempotent).

### `GET /api/v1/admin/demo` and `POST /api/v1/admin/demo/reset` (operator)

UI_UX_SPECIFICATIONS §15 "Demo" tab. Both return
`{demo_mode, organisation: {id, name} | null, counts: {scans, reports, campaigns, investigations,
incidents}, last_seeded_at | null}` (`last_seeded_at` = earliest simulated scan). `403` for
non-operators. Reset runs the same reset + seed as `python -m app.scripts.reset_demo &&
python -m app.scripts.seed_demo`, in-process: `403 DEMO_MODE_REQUIRED` unless `DEMO_MODE`, and in
production also unless `ALLOW_DEMO_SEED`; `409 CONFLICT` while another reset holds the
transaction-scoped advisory lock; `Idempotency-Key` supported; audit `demo.reset`.

---

## 4. Scans

### `POST /scans`

Auth: optional (anonymous allowed with lower limits). Headers: `Idempotency-Key` recommended.
Body:

```json
{
  "url": "https://apply.northstar-admissions.example/register",
  "intent": "payment",
  "organisation_id": "01JCM5AA...",
  "deep": false
}
```

`202`:

```json
{ "id": "01JCM6A...", "status": "queued", "url": "...", "intent": "payment",
  "created_at": "...", "poll_after_ms": 1000 }
```

Errors: `422 INVALID_URL | UNSUPPORTED_SCHEME | URL_HAS_CREDENTIALS | TARGET_NOT_ALLOWED |
UNSUPPORTED_PORT | DEEP_SCAN_DISABLED`, `409 SCAN_ALREADY_RUNNING | IDEMPOTENCY_KEY_REUSED`,
`429 RATE_LIMITED`.

Side effect: entity/edge upserts happen during execution, not at creation.

### `GET /scans`

Auth: required. Query: `limit`, `cursor`, `decision`, `status`, `organisation_id`, `domain`, `q`,
`from`, `to`, `sort` (`-created_at` default).
`200` → `{ data: [ScanSummary], page }`. Scans are visible to the owner, org members, and analysts.

### `GET /scans/{scanId}`

Auth: required (visibility rules above). `200` → full scan:

```json
{
  "id": "01JCM6A...",
  "status": "completed",
  "url": "https://apply.northstar-admissions.example/register",
  "normalised_url": "https://apply.northstar-admissions.example/register",
  "registrable_domain": "northstar-admissions.example",
  "intent": "payment",
  "decision": "BLOCK",
  "risk_level": "CRITICAL",
  "risk_score": 62,
  "coverage": { "percent": 85, "collected": ["reputation","identity","payment_destination","infrastructure"],
                "unavailable": ["credential_destination"], "skipped": [] },
  "reasons": ["The payment address fees@okaxis is not one registered by Northstar University."],
  "overrides": ["O-2"],
  "engine_version": "1.0.0",
  "result": {
    "dns": { "a": ["203.0.113.10"], "ns": ["ns1.badhost.example"], "observed_at": "..." },
    "registration": { "age_days": 4, "registrar": "Example Registrar" },
    "tls": { "presented": true, "verified": true, "issuer": "R3", "days_to_expiry": 89 },
    "redirects": { "hops": [], "cross_domain": false },
    "page": { "title": "Northstar University — Admissions", "password_fields": 1, "dom_source": "static" },
    "brand": { "claims": [{ "organisation_id": "01JCM5AA...", "token_similarity": 0.91 }] },
    "action": { "intent": "payment", "observed_destination": "https://collect.badhost.example/pay",
                "expected_destinations": ["pay.northstar-demo.example"], "payee": "fees@okaxis",
                "match": "none" }
  },
  "findings": [ /* see §5 */ ],
  "evidence": [ { "id": "01J...", "source": "dns", "observed_at": "...", "summary": "4 A records" } ],
  "cached_groups": ["reputation"],
  "duration_ms": 8421,
  "created_at": "...", "completed_at": "..."
}
```

Errors: `404 SCAN_NOT_FOUND`, `403 FORBIDDEN`.

---

## 5. Finding object (shared shape)

```json
{
  "id": "01JCM7B...",
  "code": "PAYEE_NOT_IN_VERIFIED_PROFILE",
  "signal_group": "payment_destination",
  "severity": "critical",
  "confidence": 1.0,
  "title": "Payment address is not registered by the organisation",
  "detail": "The page asks for a transfer to fees@okaxis; the organisation has registered fees@northstar-demo.",
  "observed": { "payee": "fees@okaxis" },
  "expected": { "payees": ["fees@northstar-demo"] },
  "evidence_refs": ["01JCM7A..."],
  "rule_id": "R-PAY-01"
}
```

Codes are listed in `RISK_ENGINE.md` §7. Clients must render `title` and `detail` as-is (escaped) and
may use `code` for their own logic.

---

## 6. Assessment endpoints

### `POST /assess` — the hot path

Auth: any principal. Rate per `API_CONTRACTS.md` §10. Body:

```json
{
  "url": "https://apply.northstar-admissions.example/pay",
  "intent": "payment",
  "organisation_id": "01JCM5AA...",
  "form_action": "https://collect.badhost.example/pay",
  "payee": "fees@okaxis",
  "destination_host": "collect.badhost.example"
}
```

`200` (synchronous; cached domain intel + optional live page probe):

```json
{
  "assessment_id": "01JCM8C...",
  "decision": "BLOCK",
  "risk_level": "CRITICAL",
  "risk_score": 62,
  "coverage": { "percent": 85, "collected": ["reputation","identity","payment_destination","infrastructure"],
                "unavailable": ["credential_destination"], "skipped": [] },
  "reasons": ["The payment address fees@okaxis is not one registered by Northstar University."],
  "identity_verified": false,
  "action": {
    "intent": "payment",
    "claimed_organisation": { "id": "01JCM5AA...", "name": "Northstar University" },
    "observed_destination": "https://collect.badhost.example/pay",
    "expected_destinations": ["pay.northstar-demo.example"],
    "payee": "fees@okaxis",
    "expected_payees": ["fees@northstar-demo"],
    "match": "none"
  },
  "findings": [ /* Finding[] */ ],
  "scan_id": "01JCM6A...",
  "cached": false,
  "decided_at": "2026-11-07T09:14:22Z"
}
```

Reuse (implemented 2026-11-09): a plain **browse** check (`intent: browse`, no `form_action`,
`payee` or `destination_host`) returns the caller's own finished browse scan of the same normalised
URL from the last **10 minutes** with `cached: true` and that `scan_id`, instead of scanning again.
Per caller on purpose (a URL can carry personal tokens). Login/payment checks and any check with a
client observation always run fresh. A stored row without a complete `action` block is not reused.
Measured from a distant client: first visit to a real site 15–30 s, reuse 6–8 s (dominated by
database round trips; co-located with the database it is well under a second).

Notes: `scan_id` is present when a full scan was performed or reused. `decision` is authoritative;
`identity_verified` is a convenience boolean (true only when the domain is verified **and** the
action matches).

Errors: as `POST /scans`, plus `404 ORGANISATION_NOT_FOUND`.

### `POST /verify-identity`

Body: `{ "domain": "apply.northstar-admissions.example", "organisation_id": "01JCM5AA..." }` (org optional).
`200`:

```json
{ "domain": "...", "claimed_organisation": { "id": "...", "name": "Northstar University" },
  "identity_verified": false, "reason_code": "DOMAIN_NOT_REGISTERED_BY_BRAND",
  "verified_domains": ["northstar-demo.example"],
  "login_hosts_mode": "domain_wildcard",
  "confidence": 0.95, "checked_at": "..." }
```

`reason_code` ∈ `DOMAIN_VERIFIED | DOMAIN_NOT_REGISTERED_BY_BRAND | NO_PROFILE | CLAIM_AMBIGUOUS`.

### `POST /verify-payment`

Body:

```json
{ "organisation_id": "01JCM5AA...", "recipient_type": "upi_vpa",
  "value": "fees@okaxis", "observed_on_url": "https://apply.northstar-admissions.example/pay" }
```

`200`:

```json
{ "match": "none",
  "recipient_status": "unknown",
  "normalised_value": "fees@okaxis",
  "organisation_has_verified_recipients": true,
  "expected_recipients": [{ "type": "upi_vpa", "handle": "fees@northstar-demo" }],
  "related_reports": [{ "report_id": "01J...", "confirmed_at": "..." }],
  "finding_codes": ["PAYEE_NOT_IN_VERIFIED_PROFILE"],
  "confidence": 1.0 }
```

Errors: `422 INVALID_RECIPIENT`, `404 ORGANISATION_NOT_FOUND`.

### `POST /inspect-redirect`

Body: `{ "url": "...", "max_hops": 10 }` (max_hops 1–10).
`200`:

```json
{ "final_url": "...", "cross_domain": true, "loop_detected": false,
  "hops": [{ "url": "...", "status": 302, "location": "...", "elapsed_ms": 214 }],
  "blocked_hop": null }
```

If a hop is blocked: `blocked_hop: {url, reason: "private_range"}` and the chain stops; the response is
still `200` (this is a finding, not a client error).

Implemented (2026-11-08): `hops[]` ends with the final non-redirect response (`location: null`).
`reason` is the guard's policy reason (`private_range`, `loopback`, `metadata_address`, `link_local`,
`internal_hostname`, …), `unreachable`, or `too_many_hops` (still redirecting after `max_hops`).
Demo hosts are never contacted: `simulated: true`, no hops. Auth `assess:read`.

---

## 7. Organisations

| Endpoint | Request | Response | Errors |
| --- | --- | --- | --- |
| `GET /organisations` | — | `{data:[{id,name,status,role,verified_domains_count}]}` | `401` |
| `POST /organisations` | `{name, legal_name?, country?, sector?, support_email?}` | `201` org (`status: draft`) | `409 CONFLICT` (name taken by same user) |
| `GET /organisations/{orgId}` | — | full org incl. unverified items, `role` (caller's org role, `null` for staff), `login_hosts_mode`, `logo_phash`, `updated_at` | `404` |
| `PATCH /organisations/{orgId}` | `{name?, legal_name?, country?, sector?, support_email?, brand_tokens?, logo_phash?, login_hosts_mode?, status?}` | `200` org | `409 NO_VERIFIED_DOMAIN` when publishing without one; `403` per the transition rules below |
| `GET /organisations/{orgId}/public-profile` | — | projection (`ORGANISATION_TRUST_PROFILES.md` §6) | `404`, cacheable |

`POST /organisations` body detail:

```json
{ "name": "Northstar University", "legal_name": "Northstar University Trust",
  "country": "IN", "sector": "education", "support_email": "security@northstar-demo.example" }
```

`PATCH` with `status: "active"` is the publish action and requires `org_admin`.

Field rules: `sector` ∈ `education | fintech | ecommerce | government | other`; `country` is
ISO 3166-1 alpha-2 (upper-cased); `brand_tokens` ≤ 20 entries of 2–40 chars, lower-cased and
de-duplicated; `logo_phash` is 16 hex chars (64-bit pHash). `POST` makes the caller `org_admin`;
`409 CONFLICT` if the same user already created an organisation with that name (case-insensitive).

Status transitions (one audit row each: `org.publish`, `org.suspend`, `org.unpublish`; plain field
edits are `org.update`):

| From → to | Who | Extra rule |
| --- | --- | --- |
| `draft → active` | `org_admin`, operator | ≥ 1 verified, unexpired domain; `fintech` needs an operator |
| `active → draft` | `org_admin`, operator | — (also automatic when the last verified domain is revoked) |
| `* → suspended` | operator | — |
| `suspended → active/draft` | operator | publish rules still apply |

---

## 8. Domains

### `GET /organisations/{orgId}/domains`
`200` → `{data:[{id, domain, kind, status, verified_at, expires_at, verification_method}]}`.
Members may read; managing domains requires `org_admin` (operators always may).

### `POST /organisations/{orgId}/domains`
Body: `{ "domain": "northstar-demo.example", "kind": "official" }`.
`201` → domain + `challenges[]` (see `ORGANISATION_TRUST_PROFILES.md` §4.1).
Errors: `409 DOMAIN_ALREADY_CLAIMED`, `422 VALIDATION_FAILED` (`details.issue`:
`bare_domain_required`, `wildcard_not_allowed`, `invalid_domain`, `ip_literal_not_allowed`,
`internal_hostname`). Posting the same domain again re-issues the challenge (new token, old one
invalidated) — that is also how a verified domain is re-verified before it expires.

### `POST /organisations/{orgId}/domains/{domainId}/verify`
Body: `{ "method": "dns_txt" | "http_file" }`.
`200` → `{id, domain, status:"verified", verification_method, verified_at, expires_at, evidence_id}`.
`422 VERIFICATION_TOKEN_MISMATCH` carries `details[0].observed` (first 16 chars). A revoked domain
returns `409 CONFLICT` (add it again for a new challenge).
Errors: `422 VERIFICATION_TOKEN_MISMATCH | VERIFICATION_NOT_FOUND`, `410 VERIFICATION_EXPIRED`,
`502 VERIFICATION_FETCH_FAILED`, `429 RATE_LIMITED`.

### `DELETE /organisations/{orgId}/domains/{domainId}`
`204`. Sets `status=revoked`, writes `domain.revoke` audit.

---

## 9. Recipients

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET .../recipients` | — | `{data:[{id,type,handle,label,status,verified_at}]}` (handle masked for `org_member`? no — members see full) |
| `POST .../recipients` | `{recipient_type, value, label?}` | `201` with `status: pending_attestation` |
| `POST .../recipients/{id}/verify` | `{action:"verify"\|"reject", reason, evidence_ref?}` | `200` updated recipient |
| `DELETE .../recipients/{id}` | — | `204` |

Errors: `422 INVALID_RECIPIENT`, `409 RECIPIENT_ALREADY_EXISTS`, `403 FORBIDDEN` (non-analyst
attestation).

Rules: adding needs `org_admin` (or operator); attestation needs analyst/operator and only applies
to `pending_attestation` (otherwise `409 CONFLICT`); `DELETE` (revoke) is allowed for `org_admin`,
analysts and operators (`ORGANISATION_TRUST_PROFILES.md` §8). Re-adding a `revoked`/`rejected`
address restarts attestation on the same row. Audit actions: `recipient.add`, `recipient.verify`,
`recipient.reject`, `recipient.revoke` (the attestation row records `self_attested`).

---

## 10. Members

| Endpoint | Body | Notes |
| --- | --- | --- |
| `GET .../members` | — | `{data:[{user_id,email,display_name,role,created_at}], invites:[{id,email,role,expires_at,created_at,invited_by}]}` — `invites` (open only) is filled for `org_admin`/operator, `[]` otherwise |
| `POST .../members` | `{email, role}` (`role` default `org_member`) | Creates an invite; `201` `{invite_id, email, role, expires_at, delivery, accept_url}`. `delivery` ∈ `email` (sent via Resend) \| `logged` (dev, no `RESEND_API_KEY`) \| `not_configured` (production, no key) \| `failed`; `accept_url` is returned only when the email was **not** delivered, so an admin can share it. Re-inviting the same email replaces the earlier open invite. `409 CONFLICT` if already a member or > 50 open invites |
| `PATCH .../members/{userId}` | `{role}` | Promote/demote; `409 LAST_ADMIN_REMOVAL` if it would leave none |
| `DELETE .../members/{userId}` | — | `409 LAST_ADMIN_REMOVAL`; `204` otherwise. Any member may remove **themselves** (leave) |
| `DELETE .../invites/{inviteId}` | — | Revoke an open invite; `204` (#63) |

### `POST /invites/{token}/accept` (#64)

Auth: signed-in human. The token comes from the invite link `${WEB_ORIGIN}/invites/{token}` (the
first `ALLOWED_ORIGINS` entry). `200` → `{organisation_id, organisation_name, role}`.
Errors: `404 INVITE_NOT_FOUND` (unknown/used/revoked/replaced), `410 INVITE_EXPIRED`,
`403 INVITE_EMAIL_MISMATCH` (sign in with the invited address). Accepting when already a member
keeps the existing role. Audit: `org.member.join`.

---

## 11. Reports and appeals

### `POST /reports`

Auth: any principal (anonymous limited). Headers: `Idempotency-Key` recommended.
Body:

```json
{ "url": "https://apply.northstar-admissions.example/register",
  "justification": "Asked for an application fee to a personal UPI ID after I applied.",
  "intent": "payment", "observed_payee": "fees@okaxis", "scan_id": "01JCM6A..." }
```

`201` → `{id, status:"pending", created_at, linked_scan_id}`.
Errors: `409 REPORT_DUPLICATE`, `422 VALIDATION_FAILED`, `429`.

### `GET /reports`

Auth: analyst/operator see all; users see their own.
Query: `status`, `decision`, `from`, `to`, `q`, `limit`, `cursor`.
`200` → `{data:[ReportSummary], page}`.

### `GET /reports/{reportId}`

`200` → report with `evidence[]`, `linked_scan`, `reporter` (pseudonymised unless analyst),
`review{reviewed_by, reviewed_at, reason}`.

### `POST /reports/{reportId}/review`

Auth: analyst/operator. Body: `{ "action": "confirm" | "dismiss", "reason": "..." }`.
`200` → updated report + `{reputation_applied: true, campaign_id?: "..."}`.
Errors: `409 REPORT_ALREADY_REVIEWED`, `422 REVIEW_REASON_REQUIRED |
INSUFFICIENT_COVERAGE_FOR_REVIEW`, `403 FORBIDDEN`.

### `POST /appeals`

Auth: none. Body:

```json
{ "domain": "northstar-demo.example", "email": "admin@northstar-demo.example",
  "message": "This is our official site.", "challenge_method": "dns_txt" }
```

`201` → `{appeal_id, challenge:{record_name, record_value}}`. The appeal does not change any verdict
until reviewed.

Implemented shape (2026-11-08): `{appeal_id, status:"pending_challenge", challenge:{method, record_name,
record_type:"TXT"|"FILE", record_value:"tl-verify=<token>", expires_at, instructions}}`. For
`http_file`, `record_name` is the URL `https://<domain>/.well-known/trustlens-verify.txt`. Max 3 open
appeals per domain (`409 CONFLICT`). The raw token is shown only in this response.

Further appeal routes (J10):

| Endpoint | Auth | Result |
| --- | --- | --- |
| `POST /appeals/{id}/verify` | none | `200 {appeal_id, status, verified, attempts, message}`; `422 VERIFICATION_TOKEN_MISMATCH \| VERIFICATION_NOT_FOUND`, `502 VERIFICATION_FETCH_FAILED`, `410 VERIFICATION_EXPIRED`, `409 APPEAL_ATTEMPTS_EXHAUSTED` |
| `GET /appeals` | analyst | `{data:[Appeal], page}`; filters `status`, `domain` |
| `GET /appeals/{id}` | analyst | `Appeal` (`current_reputation`, `open_reports`, `review`) |
| `POST /appeals/{id}/review` | analyst | `{action:"approve"\|"reject", reason}`. Approve needs `challenge_verified` (`409 APPEAL_NOT_VERIFIED`), resets the domain and its page URLs +30 toward 0 (THREAT_INTELLIGENCE_ENGINE §4.1; `confirmed_threat` cleared only at 0) and dismisses the domain's open reports. `409 APPEAL_ALREADY_REVIEWED` |

On-chain integrity anchors (#68–#71). Owner: [`WEB3_REGISTRY.md`](../02-architecture/WEB3_REGISTRY.md) §5.

| Endpoint | Auth | Result |
| --- | --- | --- |
| `POST /reports/{id}/anchor` | report owner or analyst | `201 AnchorOut` (`created: true`) after `register` (revision 1) or `revise` (payload changed); `200` with `created: false` when the payload is unchanged. `503 CHAIN_UNAVAILABLE`, `502 ANCHOR_TX_FAILED`, `409 ANCHOR_ALREADY_EXISTS` |
| `GET /reports/{id}/anchor` | report owner or analyst | `200 AnchorOut`; `{anchored:false}` when never anchored |
| `GET /public/verify/{id}` | none (rate group `public_verify`) | `200 AnchorVerification {valid, checks{payload_hash_matches, chain_commitment_matches, report_unchanged}, payload, salt, …}`; `404 ANCHOR_NOT_FOUND`; `503 CHAIN_UNAVAILABLE` |
| `POST /public/verify/{id}` | none (rate group `public_verify`) | Body `{payload}`. Same response, hashing the supplied payload; a tampered copy returns `valid:false` |

---

## 12. Intelligence

### `GET /intelligence/graph/{entityId}`

Auth: required. Query: `depth` (1–3, default 2), `min_confidence` (0–1, default 0.5),
`types` (comma list), `edge_types` (comma list), `limit` (node cap, default 200, max 500).

```json
{
  "root": "01JCM9D...",
  "nodes": [{ "id": "01J...", "type": "domain", "label": "apply.northstar-admissions.example",
              "attributes": {"age_days": 4}, "reputation_score": -20 }],
  "edges": [{ "id": "01J...", "source": "01J...", "target": "01J...",
              "type": "SHARES_NAMESERVER_WITH", "confidence": 0.35,
              "evidence_refs": ["01J..."], "observed_count": 2 }],
  "truncated": false,
  "counts": { "nodes": 9, "edges": 11 }
}
```

Errors: `422 GRAPH_DEPTH_EXCEEDED | GRAPH_QUERY_TIMEOUT`, `404 ENTITY_NOT_FOUND`.

### `GET /intelligence/entities`

Query: `q` (min 2 chars), `type`, `limit`, `cursor`. `200` → entity summaries.

### `GET /intelligence/entities/{entityId}`

`200` → entity with attributes, reputation basis, first/last seen, and edge counts by type.

### `GET /campaigns`

Query: `min_confidence`, `limit`, `cursor`. `200` →

```json
{ "data": [{ "id": "01J...", "name": "Northstar admissions cluster", "confidence": 0.72,
             "member_count": 4, "first_seen_at": "...", "last_seen_at": "..." }], "page": {...} }
```

### `GET /campaigns/{campaignId}`

`200` → campaign + `members[]` (entity summaries) + `shared_indicators[]` (type, value, confidence).

---

## 13. Certificates

| Endpoint | Query/Body | Response |
| --- | --- | --- |
| `GET /certificates` | `organisation_id?`, `expiring_within_days`, `issuer`, `limit`, `cursor` | certificate inventory with `monitored_domain` |
| `GET /certificates/{certificateId}` | — | full cert, chain, issuer, `first_seen_at`, `last_seen_at` |
| `GET /certificates/monitors` | `organisation_id?` | monitors with `last_checked_at`, `current_certificate_id`, `days_to_expiry` |
| `POST /certificates/monitors` | `{organisation_id, domain}` | `201` monitor |
| `DELETE /certificates/monitors/{monitorId}` | — | `204` |
| `GET /certificates/incidents` | `simulated?`, `issuer`, `limit`, `cursor` | incidents with `affected_domain_count` |
| `POST /certificates/incidents` | `{issuer_cn, title, severity, description, source, simulated}` | `201` incident + `affected[]` |

`POST /certificates/incidents` requires `operator` **and** `DEMO_MODE=1`, otherwise
`403 DEMO_MODE_REQUIRED`. `simulated` defaults to `true` and cannot be `false` through this endpoint
(`403 INCIDENT_NOT_SIMULATED`), because real advisory ingestion is FUTURE.

`GET /certificates/incidents/{id}/affected` is served by the detail projection inside
`GET /certificates/incidents` items as `affected[]` (capped at 100 with `affected_truncated`).

---

## 14. Investigations

### `POST /investigations`

Auth: required. Body: `{ "scan_id": "01JCM6A..." }`.
`202` → `{ id, status: "queued", poll_after_ms: 1000 }`.
Errors: `404 SCAN_NOT_FOUND`, `409 CONFLICT` (an active investigation exists for this scan →
returns the existing one), `429 INVESTIGATION_LIMIT_REACHED`, `422 VALIDATION_FAILED`.

### `GET /investigations/{investigationId}`

```json
{
  "id": "01JCMA...", "scan_id": "01JCM6A...", "status": "completed",
  "decision_context": { "decision": "BLOCK", "risk_level": "CRITICAL", "risk_score": 62 },
  "steps": [ { "name": "collect_tls", "status": "completed", "duration_ms": 812 },
             { "name": "correlate_graph", "status": "completed", "duration_ms": 431 } ],
  "narrative": {
    "sections": [
      { "heading": "What this page does",
        "claims": [ { "text": "The page collects a password and posts it to collect.badhost.example.",
                      "refs": ["F-3", "E-7"] } ] }
    ]
  },
  "references": [ { "id": "F-3", "kind": "finding", "finding_id": "01J..." },
                  { "id": "E-7", "kind": "evidence", "evidence_id": "01J..." } ],
  "dropped_claims": [],
  "ai": { "generated": true, "model": "provider/model-a", "prompt_version": "inv-1.0",
          "tokens_in": 5210, "tokens_out": 880, "latency_ms": 4200 },
  "created_at": "...", "completed_at": "..."
}
```

### `GET /investigations/{investigationId}/export`

`200 text/markdown` with `Content-Disposition: attachment`. Markdown includes references as footnotes
and a header noting whether AI was used.

---

## 15. Developer

### `GET /api-keys`
`200` → `{data:[{id,name,prefix,scopes,kind,last_used_at,revoked_at,created_at}]}`.

### `POST /api-keys`

Body: `{ "name": "checkout", "scopes": ["assess:read","reports:write"], "kind": "api_key" }`.
`201` → `{ id, name, prefix, scopes, secret: "tl_live_ab12cd34_..." }` — **`secret` present only here**.
Errors: `422 VALIDATION_FAILED` (unknown scope), `409 CONFLICT` (max 10 active).

### `DELETE /api-keys/{keyId}`
`204`. Revocation immediate.

### `GET /usage`

Query: `from`, `to`, `group_by=day|endpoint_group`.
`200` → `{data:[{day, endpoint_group, count}], period:{from,to}, quota:{limit,used,reset_at}}`.

Implemented (2026-11-08): the caller's session plus every API key/extension device they own (`key_id`
narrows to one, else `404`). Default period last 7 days, max 90 (`422`). Without `group_by`, rows are per
(day, group); the grouped-away field is `null`. Metered groups: `scans`, `assess`, `verify`, `inspect`,
`reports`, `investigations`, `appeals` (recorded after the response, never on the request path).
`quota` is the hourly `POST /scans` budget, as on `/overview`.

---

## 16. Overview and audit

### `GET /overview`

Auth: required. One call for the dashboard.

```json
{
  "recent_scans": [ { "id": "...", "url": "...", "decision": "BLOCK", "risk_level": "CRITICAL",
                      "created_at": "..." } ],
  "high_risk_domains": [ { "entity_id": "...", "domain": "...", "reputation_score": -70 } ],
  "certificate_alerts": [ { "monitor_id": "...", "domain": "...", "days_to_expiry": 21 } ],
  "campaigns": [ { "id": "...", "name": "...", "confidence": 0.72, "member_count": 4 } ],
  "report_queue": { "pending": 6, "reviewing": 1 },
  "quota": { "scans_used": 12, "scans_limit": 60, "resets_at": "..." }
}
```

Each block is independently nullable: if one source fails, that block is `null` and the rest still
render. The UI shows a per-block error with retry.

### `GET /audit-logs`

Auth: `operator` only. Query: `action` (exact, or a family with a trailing dot such as `org.`),
`actor_id`, `organisation_id`, `target_id`, `from`, `to`, `limit` (1–100, default 20), `cursor`.
`200` → `{data:[{id, actor_user_id, actor_email, actor_kind, action, target_type, target_id,
organisation_id, before, after, request_id, created_at}], page}` newest first, `before`/`after`
redacted at write time; the IP hash is never returned. `Cache-Control: no-store`.

---

## 17. Notes

Private, owner-only investigator notes stored as a closed list of blocks (no HTML). Human sessions only:
API keys and extension device tokens get `403 INSUFFICIENT_SCOPE`. Rate group `notes` (240/h).
`subject_type` is one of `scan | campaign | investigation | report`; `subject_id` is a ULID.
A `scan` subject must exist and be visible (`404 SCAN_NOT_FOUND`); other subjects only validate the ULID
(`422 VALIDATION_FAILED`). Notes never change a finding, score or decision.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/notes?subject_type=&limit=` | List my notes (newest first, `limit` 1–100, default 20) |
| `GET` | `/notes/{subject_type}/{subject_id}` | Read my note for a subject (empty blocks when none) |
| `PUT` | `/notes/{subject_type}/{subject_id}` | Replace the blocks (autosave target, idempotent upsert) |
| `DELETE` | `/notes/{subject_type}/{subject_id}` | Delete my note |

Schema: `NoteOut`, `NoteBlock` in `openapi.json` (block types are the closed enum there).

---

## 18. Endpoint-to-feature map

| Feature | Endpoints |
| --- | --- |
| TL-001 assessment | 13–16 |
| TL-005 redirects | 19 |
| TL-006/007 trust profiles | 20–28 |
| TL-008 payments | 18, 29–32 |
| TL-009 action integrity | 16–19 |
| TL-012 reports | 37–40 |
| TL-013 graph/campaigns | 42–46 |
| TL-014 investigations | 54–56 |
| TL-015 SDK/keys | 57–60 |
| TL-019 reputation | 40, 44 |
| TL-020 certificates | 47–53 |
| TL-021/022 auth & orgs | 4–12, 20–36 |
| TL-023 overview | 61 |
| TL-024 audit/usage | 60, 62 |
| Health/deploy | 1–3 |
