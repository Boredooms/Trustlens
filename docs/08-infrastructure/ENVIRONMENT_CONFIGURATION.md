# ENVIRONMENT_CONFIGURATION

> **Status:** DECIDED · **Group:** 08-infrastructure · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** every environment variable, validation and secret handling.
> **Related:** [`DEPLOYMENT_ARCHITECTURE.md`](DEPLOYMENT_ARCHITECTURE.md) · [`../03-backend/BACKEND_OVERVIEW.md`](../03-backend/BACKEND_OVERVIEW.md)

---

## 1. Rules

1. `.env` is gitignored; `.env.example` lists names with placeholder values only.
2. Settings are validated at startup by `pydantic-settings`; a missing required variable fails fast
   with a message naming the variable.
3. Secrets are never logged, never returned by an endpoint, never embedded in a client bundle.
4. The frontend only receives `VITE_*` variables, which are **public by definition**. No secret may
   use that prefix.
5. Changing a variable requires updating this document in the same PR.

---

## 2. Backend variables

### 2.1 Core

| Name | Required | Secret | Example / default | Purpose |
| --- | --- | --- | --- | --- |
| `ENVIRONMENT` | yes | no | `development` \| `test` \| `production` | Behaviour switches and safety gates |
| `APP_VERSION` | no | no | `0.4.1` | Reported in `/health` and logs |
| `PORT` | yes (host) | no | `8000` | Injected by Render (`$PORT`) |
| `DATABASE_URL` | yes | **yes** | `postgresql+asyncpg://…@<proj>.pooler.supabase.com:6543/postgres` | Supabase pooler (transaction mode) |
| `DIRECT_DATABASE_URL` | yes | **yes** | `postgresql://…@db.<proj>.supabase.co:5432/postgres` | Migrations only (no pooler) |
| `JWT_SECRET` | no | **yes** | 32+ random bytes | Reserved for internal HMAC (signed export links). Human tokens are Supabase-signed; **not used for auth** in the MVP |
| `ACCESS_TOKEN_MINUTES` | no | no | `15` | Access token lifetime |
| `REFRESH_TOKEN_DAYS` | no | no | `30` | Refresh lifetime |
| `ALLOWED_ORIGINS` | yes | no | `https://trustlens.example,http://localhost:5173` | CORS + CSRF origin check |
| `ALLOWED_ORIGIN_REGEX` | no | no | `^https://trustlens-web(-[a-z0-9]+)?-boredooms-projects\.vercel\.app$` | Deploy-preview origins for CORS and the Clerk `azp` check. Must start `^https://`, end `$`, no `.*`/`.+`; startup aborts otherwise. Keep the team-scoped suffix so other accounts cannot match |

### 2.2 Scanning

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SCAN_CONCURRENCY` | no | `4` | Max concurrent scans (semaphore) |
| `SCAN_BUDGET_SECONDS` | no | `60` | Hard wall-clock budget per scan |
| `PROBE_TIMEOUT_SECONDS` | no | `5` | Per HTTP probe |
| `DNS_TIMEOUT_SECONDS` | no | `2` | Per DNS query |
| `MAX_REDIRECT_HOPS` | no | `10` | Redirect cap |
| `MAX_PAGE_BYTES` | no | `2097152` | HTML fetch cap (2 MB) |
| `DEEP_SCAN_ENABLED` | no | `false` | Enable Playwright renders |
| `PLAYWRIGHT_TIMEOUT_SECONDS` | no | `15` | Render budget |
| `PLAYWRIGHT_MAX_BYTES` | no | `26214400` | Render payload cap (25 MB) |
| `SCAN_USER_AGENT` | no | `TrustLensScanner/0.4 (+https://trustlens.example/bot)` | Identifies our crawler |
| `BLOCKED_PORTS` | no | `22,25,3306,5432,6379,9200,11211` | Never probed |

### 2.3 Reputation and intelligence

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `REPUTATION_BLOCK_THRESHOLD` | no | `-60` | `R-REP-01` threshold |
| `REPUTATION_MAX_PER_DAY` | no | `-24` | Anti-brigading cap |
| `REPORT_MIN_COVERAGE` | no | `50` | Coverage needed to confirm a report |
| `CAMPAIGN_MIN_SCORE` | no | `0.45` | Clustering threshold |
| `GRAPH_MAX_DEPTH` | no | `3` | Traversal cap |
| `GRAPH_MAX_NODES` | no | `500` | Node cap |
| `GRAPH_STATEMENT_TIMEOUT_MS` | no | `3000` | Query timeout |

### 2.4 AI

| Name | Required | Secret | Default | Purpose |
| --- | --- | --- | --- | --- |
| `LLM_API_KEY` | no | **yes** | — | Absent ⇒ template narrative |
| `LLM_BASE_URL` | no | no | provider default | OpenAI-compatible endpoint |
| `LLM_MODEL` | no | no | e.g. `provider/model-a` | Model id |
| `LLM_MAX_INPUT_TOKENS` | no | no | `8000` | Pack truncation |
| `LLM_MAX_OUTPUT_TOKENS` | no | no | `1200` | Response cap |
| `LLM_TIMEOUT_SECONDS` | no | no | `45` | Per call |
| `LLM_TEMPERATURE` | no | no | `0.2` | Determinism |
| `LLM_EXTRA_BODY` | no | no | `{}` | JSON merged into the chat request for provider-specific flags, e.g. NVIDIA NIM reasoning models: `{"chat_template_kwargs":{"enable_thinking":false}}` (otherwise thinking can exhaust `LLM_MAX_OUTPUT_TOKENS` and return no content) |
| `AI_DAILY_LIMIT_PER_USER` | no | no | `20` | Rate limit |
| `AI_MONTHLY_BUDGET_USD` | no | no | `20` | Hard guard; exceeding ⇒ templates |
| `PROMPT_VERSION` | no | no | `inv-1.0` | Stored with each investigation |

### 2.5 Demo and operations

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DEMO_MODE` | no | `false` | Enables simulated-incident endpoints and recorded collector fixtures for the RFC 2606 demo hosts (ADR-016) |
| `DEV_AUTH_ENABLED` | no | `false` | Development-only `Bearer dev:<email>:<role>` sign-in (ADR-017). Startup aborts if set with `ENVIRONMENT=production` |
| `ALLOW_DEMO_SEED` | no | `false` | Permits seeding when `ENVIRONMENT=production` |
| `DEMO_ORG_SLUG` | no | `northstar` | Seed lookup |
| `LOG_LEVEL` | no | `info` | `debug` in development only |
| `RATE_LIMIT_ENABLED` | no | `true` | Disable only in tests |
| `IP_HASH_SALT` | yes (prod) | — | Salt for `audit_logs.ip_hash` |
| `SENTRY_DSN` | no | — | OPTIONAL error reporting |

---

### 2.6 Hosted platform variables

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `CLERK_SECRET_KEY` | yes | **yes** | Clerk Backend API (user delete, session revoke); never in the web bundle |
| `CLERK_ISSUER` | yes | no | Session JWT `iss`, e.g. `https://<instance>.clerk.accounts.dev` |
| `CLERK_JWKS_URL` | yes | no | `https://<instance>/.well-known/jwks.json` |
| `CLERK_AUTHORIZED_PARTY` | yes | no | Expected `azp`: the web origin, or a comma-separated list (production + local). Previews may also match `ALLOWED_ORIGIN_REGEX`; tokens from elsewhere are rejected |
| `CLERK_WEBHOOK_SECRET` | no | no | OPTIONAL. Svix signing secret for `user.created`/`user.deleted` sync |
| `SUPABASE_URL` | yes | no | Project URL — Storage and `pg_dump` only, **not** auth |
| `SUPABASE_SECRET_KEY` | yes | **yes** | `sb_secret_…` key. Storage uploads + deletion cleanup; never in a request path. The legacy name `SUPABASE_SERVICE_ROLE_KEY` is still accepted |
| `UPSTASH_REDIS_REST_URL` | yes | no | Rate limits, cache, idempotency |
| `UPSTASH_REDIS_REST_TOKEN` | yes | **yes** | Redis auth |
| `QSTASH_URL` | no | no | Regional QStash API, e.g. `https://qstash-eu-central-1.upstash.io` (default `https://qstash.upstash.io`) |
| `QSTASH_TOKEN` | no | **yes** | Publishing/schedule management (`online_check` reads schedules) |
| `QSTASH_CURRENT_SIGNING_KEY` | yes (prod) | **yes** | Verify cron calls |
| `QSTASH_NEXT_SIGNING_KEY` | no | **yes** | Key rotation |

Not used, on purpose: `SUPABASE_JWKS_URL`, the Supabase publishable/anon key and any
`VITE_SUPABASE_*`. Clerk is the only identity provider and the API is the only database client
(RLS denies `anon`); wiring those would add Supabase Auth or browser→database access without an ADR.

### 2.5a Database connection

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | **yes** | Runtime: Supabase **transaction pooler**, port **6543**, `postgresql+asyncpg://…` (statement cache disabled in the engine) |
| `DIRECT_DATABASE_URL` | yes (prod) | **yes** | Alembic + LangGraph checkpointer: Supabase **session pooler**, same host, port **5432** |
| `DB_CONNECT_TIMEOUT_SECONDS` | no | no | Connect timeout, default `10` (a cold pooler connect measured ~4.8 s from a distant network) |
| `TEST_DATABASE_URL` | tests only | no | Set by `scripts/test-api.ps1` for its process only; points at the isolated `test-db` (docker compose profile `test`, `localhost:5433/trustlens_test`). Never the hosted DB |

Production refuses a `DATABASE_URL` on a local host (`localhost`, `127.0.0.1`, `::1`, `db`,
`test-db`). The startup log records `database_host` and `database_source` (`process environment`
or `.env file`, because a process env var silently overrides `.env`), never the URL itself. `python -m app.scripts.online_check`
reports reachability of every hosted service without printing values.
| `RESEND_API_KEY` | no | no | OPTIONAL. Invites/notifications; absent ⇒ link logged in dev, shown in the UI in prod. The demo sends no email |
| `EMAIL_FROM` | no | no | `TrustLens <no-reply@trustlens.example>` |
| `LANGSMITH_API_KEY` | no | **yes** | Optional trace export |
| `LANGSMITH_PROJECT` | no | no | `trustlens-investigations` |

Rules:

- `SUPABASE_SECRET_KEY` bypasses RLS. It is loaded only by the deletion task; a startup check
  asserts it is not referenced by any route module (import-time guard).
- The web app receives only `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_BASE_URL` — both are public by
  design. The web app has no Supabase key at all; RLS denies `anon` on every table.
- Redis and QStash tokens are never given to the frontend or the extension.

### 2.8 External intelligence (owner: `02-architecture/THREAT_INTELLIGENCE_SOURCES.md` §3)

| Variable | Required | Secret | Meaning / default |
| --- | --- | --- | --- |
| `INTEL_MODE` | no | no | `auto` (default): live with a key, fixture in DEMO_MODE, else off. Also `live`, `fixture`, `off` |
| `URLHAUS_AUTH_KEY` | no | **yes** | abuse.ch Auth-Key. Absent ⇒ no live lookups (the source is absent, never faked) |

### 2.7 Web3 report registry (owner: `02-architecture/WEB3_REGISTRY.md` §7)

| Variable | Required | Secret | Meaning / default |
| --- | --- | --- | --- |
| `CHAIN_RPC_URL` | no | no | JSON-RPC node. Unset ⇒ anchoring disabled, anchor routes answer `503 CHAIN_UNAVAILABLE` |
| `CHAIN_ID` | no | no | `31337` (local Hardhat). **Refused in production** |
| `CHAIN_REGISTRY_ADDRESS` | with RPC | no | Deployed `ThreatReportRegistry` |
| `CHAIN_SENDER_ADDRESS` | with RPC | no | Node-unlocked account that sends `register`/`revise`. The API never holds a private key |
| `CHAIN_TIMEOUT_SECONDS` | no | no | `5` per RPC call |

## 3. Frontend variables (public)

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | yes | `http://localhost:8000` | API origin |
| `VITE_APP_VERSION` | no | `dev` | Displayed + `X-Client` |
| `VITE_DEMO_MODE` | no | `false` | Shows the demo banner |
| `VITE_CLERK_PUBLISHABLE_KEY` | yes | — | Clerk publishable key (`pk_test_…` / `pk_live_…`) — public by design |
| `VITE_API_BASE_URL` | yes | — | API origin, baked at build time |
| `VITE_TURNSTILE_SITE_KEY` | no | — | OPTIONAL bot protection on public forms |

Anything with `VITE_` is compiled into the bundle. Treat it as public.

---

## 4. Extension build variables

| Name | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | yes | API origin baked into the background worker |
| `VITE_EXT_VERSION` | no | Sent as `X-Client` (normally read from the manifest) |

No key is baked in. The device token is obtained at runtime through pairing.

---

## 5. Example `.env.example` (backend)

```bash
# Core
ENVIRONMENT=development
APP_VERSION=0.4.1
PORT=8000
# Database: your Supabase project (there is no local app database)
DATABASE_URL=postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DIRECT_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DB_CONNECT_TIMEOUT_SECONDS=10
JWT_SECRET=replace-with-32-plus-random-bytes

# Hosted platforms
SUPABASE_URL=https://<project-ref>.supabase.co   # Storage only, not auth
SUPABASE_SECRET_KEY=sb_secret_...
CLERK_ISSUER=https://<dev-instance>.clerk.accounts.dev
CLERK_JWKS_URL=https://<dev-instance>.clerk.accounts.dev/.well-known/jwks.json
CLERK_AUTHORIZED_PARTY=http://localhost:5173
UPSTASH_REDIS_REST_URL=https://<db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
QSTASH_URL=https://qstash-<region>.upstash.io
# QSTASH_TOKEN=
# QSTASH_CURRENT_SIGNING_KEY=
# QSTASH_NEXT_SIGNING_KEY=
# RESEND_API_KEY=
# LANGSMITH_API_KEY=
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=30
ALLOWED_ORIGINS=http://localhost:5173

# Scanning
SCAN_CONCURRENCY=4
SCAN_BUDGET_SECONDS=60
DEEP_SCAN_ENABLED=false

# AI (optional; omit to use template narratives)
# LLM_API_KEY=
LLM_MODEL=provider/model-a
PROMPT_VERSION=inv-1.0

# Demo
DEMO_MODE=1
ALLOW_DEMO_SEED=0
IP_HASH_SALT=replace-with-random-salt
LOG_LEVEL=debug
```

---

## 6. Validation and failure behaviour

| Condition | Behaviour |
| --- | --- |
| Missing `DATABASE_URL` or any `CLERK_ISSUER` / `CLERK_JWKS_URL` / `CLERK_AUTHORIZED_PARTY` | Startup aborts with a single message naming the variable |
| Missing `JWT_SECRET`, `DIRECT_DATABASE_URL`, `CLERK_SECRET_KEY`, `SUPABASE_*`, `UPSTASH_REDIS_*`, `QSTASH_CURRENT_SIGNING_KEY` or `IP_HASH_SALT` with `ENVIRONMENT=production` | Startup aborts naming every missing variable (optional in development so the stack runs without hosted accounts) |
| `DEV_AUTH_ENABLED=true` with `ENVIRONMENT=production` | Startup aborts |
| `JWT_SECRET` set but < 32 chars in production | Startup aborts (it still guards signed export URLs) |
| `CLERK_ISSUER` / `CLERK_JWKS_URL` missing | Startup aborts (no way to verify identity) |
| `CLERK_AUTHORIZED_PARTY` missing | Startup aborts — without it a token from any Clerk origin would pass |
| `ALLOWED_ORIGINS` contains `*` with credentials | Startup aborts |
| `DEMO_MODE=1` and `ENVIRONMENT=production` | Starts, logs a prominent warning, and the UI shows a demo banner |
| `LLM_API_KEY` absent | Starts; investigations use templates; `/ready` reports `llm: degraded` |
| `DEEP_SCAN_ENABLED=true` on a 512 MB instance | Allowed, semaphore 1, logged as a risk |
| Invalid `LOG_LEVEL` | Falls back to `info` with a warning |
| `PORT` missing locally | Defaults to 8000; on Render, `$PORT` is always set |

Fail-fast, not silent-default, for anything security-relevant.

---

## 7. Secret handling across environments

| Secret | Development | Preview/demo | Production |
| --- | --- | --- | --- |
| `DATABASE_URL` | Docker, throwaway | Managed DB, separate instance | Managed DB, restricted role |
| `JWT_SECRET` | `.env` local | Render env var | Render env var, rotated |
| `LLM_API_KEY` | optional local | Render env var with spend cap | Same, separate key |
| `IP_HASH_SALT` | dev value | Render env var | Rotated |
| API keys | created in UI | created in UI | created in UI |

Never: commit a `.env`, paste a key in a ticket, log a key, put a key in a screenshot, or reuse the
demo DB for production.

---

## 8. Rotation

| Secret | Procedure | Impact |
| --- | --- | --- |
| `JWT_SECRET` | Set new value, restart | Access tokens invalid for ≤ 15 min; refresh tokens still valid (they are DB-backed) |
| `DATABASE_URL` password | Rotate in provider, update env, restart | Brief connection errors during restart |
| `LLM_API_KEY` | Rotate in provider, update env, restart | None (template fallback if mistimed) |
| `IP_HASH_SALT` | Set new value | New audit rows use the new salt; old hashes remain (documented) |
| User API keys | User revokes and recreates | Those integrations must update |

---

## 9. Acceptance criteria

1. A clean checkout with only `.env.example` copied and filled runs locally with documented commands.
2. Removing `JWT_SECRET` produces one clear startup error, not a stack trace at first request.
3. `grep -R "tl_live_\|JWT_SECRET\|sk-" apps/web/dist` returns nothing.
4. `/ready` reports `llm: degraded` when `LLM_API_KEY` is absent and the product still works.
5. `DEMO_MODE` cannot be enabled in production without an explicit env var and a visible banner.
