# TrustLens — Handover (START HERE)

> **Audience:** the new owner of this codebase and the AI coding agent working on their machine.
> **Written:** 2026-11-08, at the moment of transfer. **Read this first**, then
> [`PROGRESS_LOG.md`](PROGRESS_LOG.md), then [`../CLAUDE.md`](../CLAUDE.md) and [`../INDEX.md`](../INDEX.md).
> If [`CONVERSATION_LOG.md`](CONVERSATION_LOG.md) exists, it is a redacted export of the build
> conversation — useful for *why*, not required for *what*.

---

## 1. What TrustLens is (one paragraph)

TrustLens decides whether a website is **authorised by an organisation** to ask a user for
credentials, money or personal data. Organisations register verified domains and verified payment
recipients; the API compares what a page *does* (where its forms submit, which payee it asks for)
against that record. Every answer is one of five decisions — `BLOCK`, `WARN`, `ALLOW`, `REVIEW`,
`UNKNOWN` — and **`ALLOW` is always worded "No known threat", never "safe"**. **Rules decide; the LLM
only narrates** (it can never change a decision or score). Confirmed reports propagate through a
threat graph so one confirmed report protects other users (network effect).

Full product: [`../00-project-foundation/PROJECT_OVERVIEW.md`](../00-project-foundation/PROJECT_OVERVIEW.md).

## 2. State at handover

**All features specified in `docs/` are implemented and tested.** Nothing is deployed yet.

| Area | State |
| --- | --- |
| API (FastAPI) | 55 OpenAPI paths (+ `/internal/jobs/*`, `/webhooks/clerk` excluded from OpenAPI). **300 tests pass** incl. DB-backed integration tests; ruff + mypy strict clean |
| Web (React/Vite) | All screens incl. org governance, appeals, audit log, usage, certificates, settings (delete account, Clerk profile, demo controls). **66 tests**; builds |
| Extension (MV3) | Overlay + popup + pairing + appeal link. **54 tests**; builds to `apps/extension/dist` |
| SDK | `@trustlens/sdk`, **20 tests** |
| Demo sites | Inert lookalike pages on :8081, **15 tests** |
| Database | Alembic head `c2a0plat0001` (chain `b019d0cc250d` → `c1a0gov00001` → `c2a0plat0001`). The previous owner's Supabase project is migrated to head |
| End-to-end | `demo_check` **26/26** and `platform_check` **42/42** passed against hosted Supabase on 2026-11-08 |
| Deployment | **Not done.** Render (API) + Vercel (web) configs exist; see §8 |

Feature inventory (what exists, by endpoint number) is in
[`../03-backend/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md) §1 (64 numbered rows; 4–6 are
delegated to Clerk; #63–#67 were added during the build: invite revoke, invite accept, account
deletion, admin demo status/reset).

## 3. Repository map

```text
apps/api            FastAPI backend — the ONLY verdict producer
  app/risk/           rule engine (codes, rules, engine, reasons)        RISK_ENGINE.md
  app/services/       scanner (guard, collectors), orchestrator, context, investigations,
                      domain_verification, accounts, audit, email, ratelimit, usage, jobs,
                      redirects, deep_scan (optional Playwright)
  app/intelligence/   threat graph + campaign clustering                 THREAT_GRAPH.md
  app/agents/         LangGraph investigation graph + narrator            AI_INVESTIGATION_ENGINE.md
  app/api/routes/     one module per resource (+ internal_jobs, webhooks, admin)
  app/security/       auth (Clerk JWT, dev tokens, API keys), ssrf, redaction, qstash, svix
  app/scripts/        seed_demo, reset_demo, demo_check, platform_check, set_role,
                      register_schedules, dump_openapi
  alembic/            migrations (env.py loads apps/api/.env)
  tests/              unit/, contracts/, integration/ (marker `db`, needs TEST_DATABASE_URL)
apps/web            React + Vite + Tailwind SPA (public site + dashboard)
apps/extension      Chrome MV3 extension (esbuild)
apps/demo-sites     Node server for inert demo pages (path mode: /site/<host>/...)
packages/sdk        @trustlens/sdk
packages/shared-types  generated from apps/api/openapi.json (`pnpm gen:types`)
infrastructure/     render.yaml
docs/               the specification (source of truth) + this handover folder
```

## 4. First hour on a new machine (checklist)

Prerequisites: Node ≥ 20 + pnpm 9, Python 3.12+ (3.13 works), Docker Desktop.

```bash
# 0. Fresh git history under YOUR identity (the folder was handed over without .git)
git init && git add -A && git commit -m "TrustLens: initial import"

# 1. Local Postgres
docker compose up -d db

# 2. API
cd apps/api
python -m venv .venv && . .venv/Scripts/activate     # macOS/Linux: . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env        # then fill it in — see §6. For a purely local start:
                            # DATABASE_URL/DIRECT_DATABASE_URL -> local docker DB,
                            # DEMO_MODE=true, DEV_AUTH_ENABLED=true
alembic upgrade head
python -m app.scripts.seed_demo
python -m app.serve         # http://localhost:8000 (Windows-safe launcher; Linux: uvicorn app.main:app)

# 3. Web + demo sites + extension (repo root, new terminals)
pnpm install
cp apps/web/.env.example apps/web/.env.local     # leave VITE_CLERK_PUBLISHABLE_KEY empty for dev sign-in
pnpm --filter @trustlens/web dev                 # http://localhost:5173
node apps/demo-sites/server.mjs                  # http://localhost:8081
VITE_DEMO_SITES_ORIGIN=http://localhost:8081 pnpm --filter @trustlens/extension build
#   chrome://extensions -> Developer mode -> Load unpacked -> apps/extension/dist
#   Pair: dashboard Developers -> Browser extension -> Generate pairing code

# 4. Prove it works
python -m app.scripts.reset_demo && python -m app.scripts.seed_demo
python -m app.scripts.demo_check        # expect 26/26
python -m app.scripts.platform_check    # expect 42/42
```

Full checks: `(cd apps/api && ruff check . && ruff format --check . && mypy app && pytest -q)` and
`pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build`. DB integration tests run only
with `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/<db>` (migrated);
without it ~31 tests are skipped.

## 5. Hosted services (accounts belong to whoever creates them)

| Service | Used for | Notes |
| --- | --- | --- |
| Supabase (Postgres) | Database | Use the **Transaction pooler (6543)** for `DATABASE_URL` and the **Session pooler (5432)** for `DIRECT_DATABASE_URL` (migrations + LangGraph checkpointer). Put the project in the **same region as the API** (Render `singapore` ⇒ Supabase `ap-southeast-1`) — each statement through the pooler costs ~3 round trips |
| Clerk | Human sign-in (Google etc.) | Dev instance today. API verifies JWTs via JWKS; email/name are fetched once from the Backend API with `CLERK_SECRET_KEY`. Staff roles are ours: `python -m app.scripts.set_role <email\|clerk_id> analyst\|operator` |
| NVIDIA NIM | Investigation narratives (optional) | `LLM_BASE_URL=https://integrate.api.nvidia.com/v1`, `LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b`, `LLM_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}`. NIM retires models (llama-3.3-70b returned 410) — check `GET $LLM_BASE_URL/models`. Without a key, the labelled template narrator is used |
| Upstash Redis | Distributed rate limiting | Falls back to in-process limits (`X-RateLimit-Degraded`) if unset/unreachable |
| Upstash QStash | Cron jobs → `/internal/jobs/*` | Register after deploy: `python -m app.scripts.register_schedules --api-base https://<api>` |
| Resend | Invite emails (optional) | Without `RESEND_API_KEY`, invites return/log the accept link instead |
| Render / Vercel | API / web hosting | `infrastructure/render.yaml`, `apps/web/vercel.json` |

## 6. Environment variables

Names, meaning and defaults: [`../08-infrastructure/ENVIRONMENT_CONFIGURATION.md`](../08-infrastructure/ENVIRONMENT_CONFIGURATION.md).
Templates: `apps/api/.env.example`, `apps/web/.env.example`, `apps/extension/.env.example`.
Real values live only in `.env` files (git-ignored) and in the hosting dashboards — **never commit
them, never put API secrets in Vercel/`VITE_*`**.

API (`apps/api/.env`): `ENVIRONMENT, PORT, DATABASE_URL, DIRECT_DATABASE_URL, JWT_SECRET, IP_HASH_SALT,
ALLOWED_ORIGINS, CLERK_ISSUER, CLERK_JWKS_URL, CLERK_AUTHORIZED_PARTY, CLERK_SECRET_KEY,
CLERK_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UPSTASH_REDIS_REST_URL,
UPSTASH_REDIS_REST_TOKEN, QSTASH_TOKEN, QSTASH_URL, QSTASH_CURRENT_SIGNING_KEY,
QSTASH_NEXT_SIGNING_KEY, RESEND_API_KEY, EMAIL_FROM, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL,
LLM_EXTRA_BODY, DEMO_MODE, DEV_AUTH_ENABLED, ALLOW_DEMO_SEED, DEEP_SCAN_ENABLED, LOG_LEVEL`.
Web: `VITE_API_BASE_URL, VITE_CLERK_PUBLISHABLE_KEY, VITE_DEMO_MODE, VITE_APP_VERSION`.
Extension (build time): `VITE_API_BASE_URL, VITE_WEB_BASE_URL, VITE_DEMO_SITES_ORIGIN`.

Production gates enforced at startup (`app/config.py`): `DEV_AUTH_ENABLED` must be false;
`DIRECT_DATABASE_URL`, `JWT_SECRET` (≥32), `CLERK_SECRET_KEY`, `SUPABASE_*`, `UPSTASH_*`,
`QSTASH_CURRENT_SIGNING_KEY`, `IP_HASH_SALT` required.

## 7. Things that will bite you (learned the hard way)

1. **Windows event loop.** Run the API with `python -m app.serve` (selector loop). The Proactor
   loop breaks psycopg's async pool; dnspython's async resolver stalls under the selector loop, so
   DNS lookups use the blocking resolver in threads (`collectors.collect_dns`, `domain_verification`).
2. **`PYTHONIOENCODING=utf-8`** on Windows consoles, or scripts printing `→`/`₹` crash (cp1252).
3. **Transaction pooler + asyncpg:** statement caches are disabled and statement names are unique
   (`app/db/engine.py`). Enabling the cache on 6543 causes 500s. Don't "optimise" this.
4. **Idle connections are dropped by Supavisor.** The LangGraph checkpointer pool uses
   `check_connection` + `max_idle`; SQLAlchemy uses `pool_pre_ping`. Keep both.
5. **Latency is geography.** From far away, `/ready`'s 2 s DB check can trip on the first request
   after idle and `/assess` takes seconds. Co-locate API and DB.
6. **`demo_check` / `platform_check` use dev sign-in (`Bearer dev:<email>:<role>`)** — development
   only; production refuses dev tokens. On production, rehearse manually.
7. **Reasoning LLMs** can spend the whole output budget "thinking" and return empty content —
   hence `LLM_EXTRA_BODY` (thinking off). Empty/fenced content now fails cleanly to the template.
8. **Clerk default session token has no email** — the API fills email/name once via the Backend API.
   Account deletion requires Clerk re-verification (`fva` claim ≤ 10 min) and answers 403
   `REVERIFICATION_REQUIRED` with Clerk's `clerk_error` hint so `useReverification` opens the modal.
9. **RLS is on for all tables.** The API connects as the table owner (bypasses RLS); Supabase
   `anon`/`authenticated` roles are denied. `audit_logs` is append-only via trigger.
10. **Web tests must not read `.env.local`** (`vite.config.ts` `test.env` blanks the Clerk key) and
    use a 20 s per-test timeout (full-flow tests flake at 5 s under parallel runs).
11. **Extension demo mode** maps `http://localhost:8081/site/<host>/…` to `https://<host>/…` only
    when built with `VITE_DEMO_SITES_ORIGIN`. Rebuild + reload the extension after changing env.
12. **Seed/reset are idempotent** but `demo_check` creates a report; running it twice without
    `reset_demo` gives 409 `REPORT_DUPLICATE` (correct behaviour).
13. **Render free tier sleeps** after ~15 min; first request takes 30–60 s. Warm it before a demo.
14. **Deep scan** (Playwright) is off by default and needs `pip install -r requirements-deepscan.txt`
    + `playwright install chromium` and a larger instance than Render free.

## 8. Deployment runbook (not yet executed)

1. Push this repo to GitHub (your account).
2. **Supabase:** create project in the API's region; run `alembic upgrade head` with the session
   pooler URL as `DIRECT_DATABASE_URL`; optionally `ALLOW_DEMO_SEED=true python -m app.scripts.seed_demo`.
3. **Render:** New → Blueprint → `infrastructure/render.yaml` (root `apps/api`, region singapore).
   Set secrets from §6. `ENVIRONMENT=production`, `DEV_AUTH_ENABLED=false`,
   `ALLOWED_ORIGINS` and `CLERK_AUTHORIZED_PARTY` = the Vercel URL. Check `/ready`.
4. **Vercel:** import repo, root `apps/web`; set `VITE_API_BASE_URL` (Render URL),
   `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_DEMO_MODE`. Add the Vercel URL to Clerk's allowed origins.
5. **QStash:** `python -m app.scripts.register_schedules --api-base https://<render-url>` (`--dry-run` first).
6. **Clerk webhook:** endpoint `https://<render-url>/webhooks/clerk`, events `user.created`,
   `user.updated`, `user.deleted`; put the `whsec_…` into `CLERK_WEBHOOK_SECRET` (until then the
   endpoint answers 503 by design).
7. **Extension:** rebuild with `VITE_API_BASE_URL=<render-url>` and `VITE_WEB_BASE_URL=<vercel-url>`
   (host permissions follow), reload.
8. Sign in once, then `python -m app.scripts.set_role <you> operator` against the production DB.
9. Rehearse [`../10-hackathon-demo/DEMO_RUNBOOK.md`](../10-hackathon-demo/DEMO_RUNBOOK.md) manually.

## 9. Open items (not code defects)

| Item | Owner action |
| --- | --- |
| Deploy (Render + Vercel) | §8 |
| `RESEND_API_KEY` + verified sending domain | for real invite emails |
| `CLERK_WEBHOOK_SECRET` | after deploy (§8.6) |
| Production Clerk instance on an owned domain + own Google OAuth credentials | before real customers |
| Rotate all provider keys | the previous owner's keys were shared during development; issue fresh keys under your own accounts |
| Deep scan | off by default; needs paid compute |

Known non-blocking limitations: the operator `/ready` DB budget is 2 s (trips only with a distant DB);
real-website scanning is less exercised than the demo path (demo hosts use recorded, `simulated`
fixtures — ADR-016).

## 10. Working agreements for the agent

- `docs/` is the source of truth. If code and docs disagree, fix both in the same change.
- Non-negotiables: [`../CLAUDE.md`](../CLAUDE.md) §3 — never let the LLM set decision/score; never
  store passwords, OTPs, card data or cookies; ALLOW never says "safe"; every fetch goes through the
  SSRF guard (`app/services/guard.py`) including every redirect hop and the connected peer IP.
- Before claiming done: run the full checks in §4 and both e2e scripts; report actual numbers.
