# MONITORING_HEALTHCHECKS

> **Status:** DECIDED · **Group:** 08-infrastructure · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** health/readiness contracts, logging, request IDs, metrics, alerting, troubleshooting.
> **Related:** [`DEPLOYMENT_ARCHITECTURE.md`](DEPLOYMENT_ARCHITECTURE.md) · [`../03-backend/BACKEND_OVERVIEW.md`](../03-backend/BACKEND_OVERVIEW.md)

---

## 1. Health endpoints

| Endpoint | Question | DB access | Typical latency |
| --- | --- | --- | --- |
| `GET /health` | Is the process alive? | No | < 5 ms |
| `GET /ready` | Can it serve traffic? | Yes | < 50 ms |
| `GET /api/v1/health` | Versioned mirror of `/ready` | Yes | < 50 ms |

### 1.1 `/health` (liveness)

```json
{
  "status": "ok",
  "service": "trustlens-api",
  "version": "0.4.1",
  "uptime_s": 8412,
  "timestamp": "2026-11-07T09:14:22Z"
}
```

Always `200` while the event loop is responsive. It must not touch the database — otherwise a DB blip
would make the platform restart a healthy process.

### 1.2 `/ready` (readiness)

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "ok", "latency_ms": 3 },
    "scanner": { "status": "ok", "queue_depth": 0, "breaker": "closed" },
    "llm": { "status": "degraded", "detail": "no_api_key" }
  },
  "version": "0.4.1"
}
```

Semantics:

| Check | `ok` | `degraded` | `down` |
| --- | --- | --- | --- |
| `database` | `SELECT 1` succeeds within 2 s (target < 250 ms; `latency_ms` is reported) | — | error or timeout |
| `scanner` | breaker closed, queue < concurrency×4 | queue saturated **or** breaker open | scanner initialisation failed |
| `llm` | key configured and last call succeeded | no key, or last call failed | — |

HTTP status: `200` if `database` is `ok`; otherwise `503` with `error.code = NOT_READY` and
`checks.database.detail`. `llm: degraded` does **not** make the service unready — investigations fall
back to templates.

Why readiness checks the DB: Render and clients use it to decide whether to send traffic, and a
service that cannot persist is not able to serve a scan.

### 1.3 Anti-patterns we avoid

- No expensive work in `/health` (no scan, no external call, no model ping).
- No hardcoded `"database": "connected"` — the check actually queries.
- No `/health` that returns 200 while the app is shutting down; a `shutting_down` flag flips
  `/ready` to `503` immediately.

---

## 2. Request IDs

- Every response carries `X-Request-Id`.
- If the client sends one and it matches `^[A-Za-z0-9._:-]{8,128}$`, it is reused; otherwise minted
  (`req_<ULID>`).
- The ID is bound to the log context and included in every log line for that request.
- Error envelopes include `error.request_id`.
- The UI shows it in a "Technical details" disclosure for support.

---

## 3. Logging

Structured JSON to stdout.

```json
{"ts":"2026-11-07T09:14:22.104Z","level":"info","event":"scan.completed",
 "request_id":"req_01J...","scan_id":"01J...","decision":"BLOCK","risk_score":62,
 "coverage_pct":85,"duration_ms":8421,"env":"production","version":"0.4.1"}
```

### 3.1 What is logged

| Event | Level | Fields |
| --- | --- | --- |
| Request completed | info | method, path (no query), status, duration_ms |
| Scan started/completed/failed | info/error | scan_id, domain (not full URL with query), decision, duration |
| Probe degraded | warn | probe, reason, domain |
| SSRF rejection | warn | host, reason (never the resolved private IP in client-visible output) |
| Auth failure | warn | email_hash, ip_hash, reason |
| Auth reuse detection | error | user_id, family_id |
| Rate limit hit | warn | group, actor_kind |
| Investigation completed | info | investigation_id, ai_generated, tokens |
| Unhandled exception | error | request_id, exception type, stack (server-side only) |
| Startup/shutdown | info | version, env |

### 3.2 What is never logged

Passwords, tokens, cookies, API keys, full URLs with query strings that may carry tokens, page HTML,
form values, evidence payloads, model prompts, full LLM responses.

### 3.3 Sampling and volume

- 100% of warnings/errors.
- 100% of scan lifecycle events (low volume).
- Successful reads logged at info in development, sampled at 10% in production if volume grows.

---

## 4. Metrics

No Prometheus in the MVP. We derive metrics from logs and from two cheap endpoints.

| Metric | Source | Target |
| --- | --- | --- |
| Request rate / error rate | Render logs | — |
| p50/p95 latency per route | `duration_ms` in logs | scan ≤ 20 s p50 |
| Scan outcomes | log counts by `decision` | — |
| Coverage distribution | log `coverage_pct` | median ≥ 70% |
| Probe degradation rate | warn counts by probe | < 10% |
| LLM failures | error counts | < 5% |
| Queue depth | `/ready.checks.scanner.queue_depth` | < 16 |
| DB latency | `/ready.checks.database.latency_ms` | < 50 ms |

`GET /usage` provides per-key quota usage for users, not for ops monitoring.

---

## 5. Alerting (minimum viable)

| Condition | Channel | Action |
| --- | --- | --- |
| `/ready` 503 for > 2 min | Provider alert / manual check | Inspect DB, restart if needed |
| 5xx rate > 5% over 5 min | Manual (demo: presenter watches) | Roll back |
| Cold start > 90 s | Manual | Warm earlier; check instance size |
| LLM error rate > 20% | Log review | Template path is already active; no user impact |
| DB connections near cap | Log review | Reduce pool, restart |

For the hackathon, alerting is a checklist item in `DEMO_RUNBOOK.md` §7 rather than a paging system.
This is stated plainly rather than pretending we have 24/7 observability.

---

## 6. Startup and shutdown

### 6.1 Startup checklist (logged)

1. Settings validated.
2. Engine created, but **no** connection attempted.
3. HTTP client and semaphore created.
4. Stale `running` scans older than 5 minutes swept to `failed`.
5. Version, env, `demo_mode`, `deep_scan_enabled`, `llm_configured` logged.
6. Router mounted; OpenAPI generated lazily.

Startup never fails on DB unavailability.

### 6.2 Shutdown

1. `shutting_down = true` → `/ready` returns 503 immediately.
2. In-flight scan tasks cancelled.
3. HTTP client closed, engine disposed.
4. Shutdown logged with uptime.

---

## 7. Troubleshooting playbook

| Symptom | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| `/ready` 503, `database.detail: timeout` | DB asleep or connection cap | Provider dashboard, pool settings | Wake DB, reduce pool, restart |
| Scans stuck `running` | Task crashed mid-flight | Logs for `scan.failed`, sweep log | Sweep marks `failed`; re-run |
| All probes `UNAVAILABLE` | Egress blocked or DNS down | Log `probe.degraded`, try `dig` from host | Restore egress; check resolver config |
| `TARGET_NOT_ALLOWED` unexpectedly | DNS resolves to a private range (or rebinding) | Log the rejection reason | Expected behaviour; verify the target |
| Extension shows `UNKNOWN` always | Wrong `VITE_API_BASE_URL` or revoked token | Extension options, `/auth/me` | Rebuild with correct URL, re-pair |
| Investigation always template | No `LLM_API_KEY` or budget guard tripped | `/ready.checks.llm`, logs | Set key, raise budget |
| Frontend blank after deploy | SPA rewrite missing | Request `/app/scan` directly | Fix `routes` rewrite |
| 401 on every request | `JWT_SECRET` changed / clock skew | Token `iat`/`exp`, logs | Re-login; check host clock |

---

## 8. Operational runbook snippets

```bash
# Is it up?
curl -sS https://api.example/health | jq
curl -sS https://api.example/ready | jq

# Wake it before a demo (single request, not a loop)
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.example/ready

# Recent errors (Render log filter)
# provider CLI or dashboard: filter level=error, last 30 min
```

Warm-up is **one** request followed by a wait; never a polling loop every few seconds.

---

## 9. Acceptance criteria

1. `/health` returns 200 with the DB stopped.
2. `/ready` returns 503 with a `database` reason when the DB is stopped, and 200 when it returns.
3. Every 5xx response includes a `request_id` present in the logs.
4. No log line contains a token, password or full page body (grep-based test on a fixture log).
5. A stale `running` scan is swept to `failed` on the next startup.
6. Shutdown flips readiness before the process exits.
