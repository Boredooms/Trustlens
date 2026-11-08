# EXTENSION_API_INTEGRATION

> **Status:** DECIDED · **Group:** 05-browser-extension · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** every extension↔API call, payload, timeout, cache rule and error mapping.
> **Related:** [`EXTENSION_ARCHITECTURE.md`](EXTENSION_ARCHITECTURE.md) · [`../03-backend/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. Calls made by the extension

| # | Call | When | Auth |
| --- | --- | --- | --- |
| 1 | `POST /api/v1/auth/extension/exchange` | User pairs | none (code) |
| 2 | `GET /api/v1/auth/me` | On wake, if token present and > 24 h since last check | device token |
| 3 | `POST /api/v1/assess` (`intent=browse`) | Page ready, cache miss/stale | device token |
| 4 | `POST /api/v1/assess` (`intent=login|payment`) | Sensitive action detected | device token |
| 5 | `GET /api/v1/organisations/{id}/public-profile` | When an org claim is detected, cache miss | device token |
| 6 | `POST /api/v1/reports` | User reports | device token |
| 7 | `GET /api/v1/scans/{id}` | "Full report" opened in dashboard (link only) | n/a |

Nothing else. Specifically not called: scans list, graph, investigations, organisation mutations,
API keys, audit.

---

## 2. Device token handling

```ts
async function authHeaders(): Promise<Record<string, string>> {
  const { device_token } = await chrome.storage.local.get("device_token");
  if (!device_token) throw new NotPairedError();
  return {
    Authorization: `Bearer ${device_token}`,
    "Content-Type": "application/json",
    "X-Client": `ext/${chrome.runtime.getManifest().version}`,
  };
}
```

- Token stored only in `chrome.storage.local`.
- Never logged; never sent to any origin other than the API base (enforced by a single `apiFetch`
  wrapper that hardcodes the base URL).
- 401 handling: clear token, set `paired=false`, show reconnect; do not retry.

---

## 3. `POST /assess` request shapes

### 3.1 Browse

```json
{ "url": "https://apply.northstar-admissions.example/register", "intent": "browse" }
```

### 3.2 Login

```json
{
  "url": "https://apply.northstar-admissions.example/register",
  "intent": "login",
  "form_action": "https://collect.badhost.example/login",
  "destination_host": "collect.badhost.example"
}
```

### 3.3 Payment

```json
{
  "url": "https://apply.northstar-admissions.example/pay",
  "intent": "payment",
  "payee": "fees@okaxis",
  "destination_host": "collect.badhost.example",
  "form_action": "https://collect.badhost.example/pay"
}
```

Headers: `Authorization`, `Content-Type`, `X-Client`, and
`Idempotency-Key: <sha256(url+intent+payee)>` truncated to 64 chars.

Timeout: 8 s for browse, 10 s for action checks. Abort via `AbortController`.

---

## 4. Response handling

Only five fields drive UI:

```ts
type Assessment = {
  decision: "BLOCK" | "WARN" | "ALLOW" | "REVIEW" | "UNKNOWN";
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  coverage: { percent: number };
  reasons: string[];
  action?: {
    intent: string;
    observed_destination?: string;
    expected_destinations?: string[];
    payee?: string;
    match?: "exact" | "none" | "unverifiable";
  };
  scan_id?: string;
};
```

Validation on receipt:

- `decision` must be one of the five; unknown → treat as `UNKNOWN` (forward compatibility).
- `coverage.percent` clamped 0–100; missing → `UNKNOWN`.
- `reasons` capped at 3 for display; the rest are in the dashboard.
- Unknown extra fields are ignored.

---

## 5. Caching

| Key | Storage | TTL | Invalidation |
| --- | --- | --- | --- |
| `verdict:<sha256(url)>` | `storage.session` | 10 min | Navigation to same URL after TTL; manual refresh |
| `profile:<orgId>` | `storage.local` | 24 h | TTL only (server invalidates via `updated_at` check on action checks) |
| `settings` | `storage.local` | — | User change |
| `token` | `storage.local` | 180 d | 401 |

Action checks **never** use the browse cache: they always call the API, because the intent changes
the decision. A cached browse `WARN` must not be shown as an action verdict.

Eviction: on `alarms` every 30 min, drop expired verdicts; cap at 200 entries, LRU.

---

## 6. Error mapping

| API result | Extension state | User-facing |
| --- | --- | --- |
| `200` | render decision | as returned |
| `401 INVALID_API_KEY` | unpaired | "Reconnect TrustLens to keep protecting you." |
| `403 INSUFFICIENT_SCOPE` | misconfigured | "This build needs an updated pairing." (should not happen) |
| `404 ORGANISATION_NOT_FOUND` | degrade | remove org context, re-assess without it |
| `422 TARGET_NOT_ALLOWED` | `UNKNOWN` | "This address can't be checked." |
| `422 INVALID_URL` | `UNKNOWN` | "This page can't be checked." |
| `429` | `UNKNOWN` (or cache) | "Too many checks right now — pausing for {n}s." |
| `5xx` | `UNKNOWN` | "TrustLens is unavailable — this page was not checked." |
| Network error | `UNKNOWN` | same as above |
| Timeout | `UNKNOWN` | same as above |

Copy rule: every degraded state says **"not checked"**. Never "safe", never blank.

---

## 7. Rate-limit budget

The extension's limits are 300 scans/hour and 1200 assesses/hour per device. The client budgets:

| Action | Cap |
| --- | --- |
| Browse checks | max 1 per navigation, 1 per 10 min per URL |
| Action checks | max 1 per action, 3 per page per 5 min |
| Profile fetches | 1 per org per 24 h |
| Reports | 10/hour (local counter, soft warning after 5) |

On `429`, honour `Retry-After` and stop all non-action calls for that window. Action checks still
attempt once (safety over quota) and degrade to `UNKNOWN`.

---

## 8. Offline behaviour

- Browse checks: no request; show `UNKNOWN` with "offline".
- Action checks: attempt; on failure `UNKNOWN` (fail open) with a warning that the action could not be
  verified.
- Reports: queued in `pending_reports` (max 20), retried hourly, surfaced in options as
  "1 report waiting to send".

---

## 9. Security requirements

1. All requests go through one `apiFetch` wrapper with a hardcoded base URL from the build
   (`VITE_API_BASE_URL`), rejecting any other origin.
2. No `eval`, no remote scripts, no dynamic `import()` of remote URLs.
3. Overlay content from the API is inserted with `textContent`, never `innerHTML`.
4. The device token is never included in a URL (no query strings, no logs).
5. Requests carry no cookies (`credentials: "omit"`).
6. Message handlers validate the sender's tab id and message shape before acting.
7. The content script posts only the whitelisted metadata fields; unknown fields are dropped.

---

## 10. Contract tests

| Test | Assertion |
| --- | --- |
| Browse check request | Matches `POST /assess` schema exactly; no extra fields |
| Action check | `intent` and `form_action`/`payee` present as applicable |
| Response parsing | Unknown enum value → `UNKNOWN`, no crash |
| 401 | Token cleared, no retry, reconnect state |
| 429 | `Retry-After` respected; action check still attempts once |
| Idempotency | Repeat call with same key returns the same assessment id |
| No secrets | A recorded request log contains no token in URL or body |
