# TrustLens

Website trust intelligence: decides whether a website is **authorised** to ask for credentials,
money or personal data. Every answer is `BLOCK`, `WARN`, `ALLOW`, `REVIEW` or `UNKNOWN` — and
`ALLOW` never means "safe". Rules decide; the LLM only narrates.

**The specification lives in [`docs/`](docs/INDEX.md) and is the source of truth.** This README only
tells you how to run the code. If the code and the docs disagree, one of them has a defect.

| Start here | Why |
| --- | --- |
| [`docs/INDEX.md`](docs/INDEX.md) | Reading order and source-of-truth map |
| [`docs/CLAUDE.md`](docs/CLAUDE.md) / [`docs/AGENTS.md`](docs/AGENTS.md) | Non-negotiables and traps |
| [`docs/10-hackathon-demo/DEMO_RUNBOOK.md`](docs/10-hackathon-demo/DEMO_RUNBOOK.md) | The finish line |

## Layout

```text
apps/api            FastAPI backend — the only verdict producer (risk engine, scanner, graph, LangGraph)
apps/web            React + Vite SPA (public site + dashboard)
apps/extension      Chrome MV3 extension (observes, asks the API, fails visible)
apps/demo-sites     Inert lookalike + genuine demo pages for the browser (Node, zero deps)
packages/sdk        @trustlens/sdk — assess(), verifyRecipient()
```

## Run the demo locally (Windows/macOS/Linux)

Prerequisites: Node ≥ 20 with pnpm 9, Python 3.12+ (3.13 works), Docker.

```bash
# 1. Database
docker compose up -d db

# 2. API (terminal 1)
cd apps/api
python -m venv .venv && . .venv/Scripts/activate      # macOS/Linux: . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # DEMO_MODE=true, add DEV_AUTH_ENABLED=true
alembic upgrade head
python -m app.scripts.seed_demo                       # idempotent canonical Northstar dataset
python -m app.serve                                   # http://localhost:8000  (Linux: uvicorn app.main:app)

# 3. Web (terminal 2, repo root)
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @trustlens/web dev                      # http://localhost:5173 → Development sign-in

# 4. Demo sites + extension (terminal 3, repo root) — see apps/demo-sites/README.md and
#    apps/extension/README.md for loading the unpacked extension and pairing it.
```

## Prove the demo path

```bash
cd apps/api
python -m app.scripts.reset_demo && python -m app.scripts.seed_demo
python -m app.scripts.demo_check     # 26 assertions over HTTP against the running API; exit 0 = intact
python -m app.scripts.platform_check # 35 checks: orgs, domain verification, members/invites, appeals,
                                     # certificates, redirect inspection, usage, audit (dev sign-in)
```

## Production operations

```bash
python -m app.scripts.register_schedules --api-base https://<api-host>   # QStash cron jobs (idempotent)
python -m app.scripts.set_role <email|clerk_user_id> analyst|operator    # grant staff roles
pip install -r requirements-deepscan.txt && playwright install chromium  # only if DEEP_SCAN_ENABLED
```

## Checks

```bash
(cd apps/api && ruff check . && ruff format --check . && mypy app && pytest -q)
pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build
```

## Secrets you supply for a hosted deploy

`DATABASE_URL` (Supabase pooler, 6543), `DIRECT_DATABASE_URL` (5432, migrations), `CLERK_ISSUER`,
`CLERK_JWKS_URL`, `CLERK_AUTHORIZED_PARTY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`,
`UPSTASH_REDIS_REST_URL/TOKEN`, `QSTASH_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`,
`JWT_SECRET`; optional `LLM_API_KEY` (without it investigations use the labelled template path).

- NVIDIA NIM: `LLM_BASE_URL=https://integrate.api.nvidia.com/v1`,
  `LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b`,
  `LLM_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}` (thinking otherwise eats the
  output budget). Check what your key can call with `GET $LLM_BASE_URL/models`; NIM retires models.
- Put the database in the same region as the API (Render `singapore` ⇒ Supabase `ap-southeast-1`).
  Each statement through the transaction pooler costs ~3 network round trips.
- Clerk users start as `user`. After their first sign-in:
  `python -m app.scripts.set_role <email|clerk_user_id> analyst|operator` (no args lists users).
  For emails instead of `<sub>@users.clerk`, add `{"email": "{{user.primary_email_address}}"}` to
  the Clerk session token (Dashboard → Sessions → Customize session token).
