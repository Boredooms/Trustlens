# TrustLens — Master Start Prompt

> **Status:** DECIDED · **Audience:** the next AI coding agent (Claude) and the human owner.
> **Purpose:** everything needed to go from "fresh session, empty context" to "server running,
> verified, tested, and honest about what is broken" — without re-reading 16,841 lines of docs
> and 9,000 lines of code in the wrong order.
> **Verified against the repository on 2026-11-08.** Numbers in §2 were extracted from the code,
> not copied from the documentation. Where the two disagree, this file records the disagreement
> (§14) instead of hiding it.

---

## 0. How to use this file

1. **Human:** paste §1 into a fresh Claude session. It is self-contained. Everything after §1 is
   the reference the prompt tells Claude to consult.
2. **Agent:** §1 is your instruction. §2 is what exists. §3 is the context folder. §4–§5 are the
   maps. §6 is what is broken on this machine right now. §7–§9 are the bring-up and test plan.
   §10–§13 are standards. §14 is a list of defects you are expected to fix. §15–§17 are the rules.
3. **Never** treat this file as a substitute for `docs/handover/HANDOVER.md` for operational
   detail, or for `docs/INDEX.md` for the source-of-truth map. This file is the *entry ramp*.

---

## 1. The prompt (copy from here)

```text
You are taking over TrustLens at C:\trustlens\trustlens — a working monorepo with a FastAPI API,
a React/Vite dashboard, a Chrome MV3 extension, a TypeScript SDK, inert demo sites, and a complete
specification in docs/. Your job in this session: understand what is actually built, start every
service, prove the system works end to end with realistic scenarios, close the real gaps, and
leave the repository in a state where a stranger can run it.

Do not start by writing code. Start by reading, then running, then testing, then changing.

=== PHASE 1 — ORIENT (read, do not edit) ===

Read in exactly this order:
1. docs/handover/HANDOVER.md                  (state, runbook, deployment, traps)
2. docs/handover/PROGRESS_LOG.md              (what was built and why, bugs already fixed)
3. docs/CLAUDE.md and docs/AGENTS.md          (non-negotiables and full rulebook)
4. docs/MASTER_PROMPT.md §2, §5, §6, §14      (verified inventory, code map, machine state, drift)
5. docs/INDEX.md                              (source-of-truth map: one owner per fact)
6. docs/02-architecture/API_CONTRACTS.md + docs/03-backend/API_ENDPOINTS.md
7. docs/03-backend/RISK_ENGINE.md             (weights, rule ids, overrides O-1..O-7)
8. docs/02-architecture/DATABASE_DESIGN.md
Then read code only where a doc points:
   apps/api/app/risk/engine.py, apps/api/app/risk/rules.py, apps/api/app/api/routes/*.py,
   apps/api/app/security/auth.py, apps/api/app/services/scan_orchestrator.py,
   apps/web/src/app.tsx, apps/web/src/lib/api/endpoints.ts,
   apps/extension/src/background/service-worker.ts.
docs/handover/CONVERSATION_LOG.md is 234 KB: do not read it whole. grep it for a specific
"why" question only.

While reading, build a written inventory and confirm it against the code with commands:
endpoints, routes, enums, error codes, tables, env vars, test files, scripts. Report the counts
you measured. If a documented number differs from the code, say so and add it to the drift list.

=== PHASE 2 — START EVERYTHING (and record what fails) ===

Machine facts you must re-verify first: node -v, pnpm -v, python --version, docker --version,
docker info. Known state on this machine (2026-11-08): node v24, pnpm 9.15.9, system Python 3.14,
Docker installed but the daemon is NOT running, apps/api/.venv exists but is BROKEN (it points at a
removed Python 3.13 install), node_modules and dist/ folders already exist, and there is no .git.

Bring-up, in order, stopping at the first real failure:
  a. docker compose up -d db            (start Docker Desktop first)
  b. rebuild apps/api/.venv with a Python the deps support (3.12 or 3.13 — not 3.14 unless every
     wheel resolves), pip install -r requirements-dev.txt
  c. ensure apps/api/.env exists and points at the local DB; DEMO_MODE=true, DEV_AUTH_ENABLED=true
  d. alembic upgrade head               (DIRECT_DATABASE_URL, port 5432)
  e. python -m app.scripts.seed_demo
  f. python -m app.serve                (Windows: selector loop; NOT plain uvicorn)
  g. pnpm install (if needed); pnpm --filter @trustlens/web dev   -> :5173
  h. node apps/demo-sites/server.mjs                              -> :8081
  i. build the extension with VITE_DEMO_SITES_ORIGIN and load it unpacked
Verify each with a command, not a banner: curl /health, curl /ready, an authenticated GET, a page
load. Record the exact port, PID and result. If something cannot start, report the first useful
error and continue with what does work — never claim a service is up because a port is open.

=== PHASE 3 — PROVE IT (real scenarios, not smoke tests) ===

Run the existing proof scripts first and report their real numbers:
  python -m app.scripts.demo_check       (26 assertions)
  python -m app.scripts.platform_check   (42 checks)
  (cd apps/api && ruff check . && ruff format --check . && mypy app && pytest -q)
  pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build
DB integration tests need TEST_DATABASE_URL (migrated) — run them, do not let them skip silently.
Then extend coverage with the scenario matrix in docs/MASTER_PROMPT.md §9:
genuine vs lookalike payment (BLOCK via O-2), login to a third party (O-4/O-5), dead domain
(UNKNOWN via O-7), HTTP-only credential form, typosquat, brand claim on an unverified domain,
expired domain verification, last-admin removal, expired invite, appeal attempt limits, stale
extension cache (>10 min => UNKNOWN), signed-out 401, foreign-Origin 403, oversized body 413,
idempotency-key reuse, rate limiting. For real-world sanity use read-only targets that are safe to
fetch (example.com, wikipedia.org, github.com login page, paypal.com); never submit credentials,
never automate a login, never upload a file, keep all demo data labelled simulated.

=== PHASE 4 — CLOSE THE GAPS (code + docs together) ===

Fix the drift in docs/MASTER_PROMPT.md §14 in the same change as the code it describes. Add the
missing tests that the matrix exposes, at the right layer:
  - backend rules/engine: apps/api/tests/unit/, table-driven, no network
  - wire contract: apps/api/tests/contracts/ (enums + snake_case + error codes)
  - DB behaviour: apps/api/tests/integration/ (marker db), real Postgres, real constraints
  - web: colocated *.test.tsx with the existing harness (Testing Library, jsdom)
  - extension: apps/extension/test/ (vitest), fixture-driven
  - sdk/demo-sites: existing suites
Do not weaken, skip or suppress a test to get green. If a test is wrong, say why before changing it.
Optional and clearly marked PROPOSED: an edge layer (apps/edge) for a same-origin API proxy and a
cached public-profile read. It must never produce a verdict, never hold secrets, and must be
deployed only with the owner's explicit approval.

=== PHASE 5 — REPORT ===

End with: what you verified (commands + actual numbers), what you changed and why, what is still
broken or unverified, and the drift items you closed. Never say a UI "looks right" unless you
viewed it. Never claim a deployment you did not perform.

Hard rules, no exceptions:
- Deterministic rules decide; the LLM narrates. The model can never set a decision or a score.
- ALLOW means "no known threat within executed checks" — never "safe", never "verified".
- A failed check is UNAVAILABLE, never a pass.
- Every outbound fetch goes through apps/api/app/services/guard.py, including redirect hops.
- Never read or store passwords, OTPs, card data, cookies or form values. Metadata only.
- No secrets in the repo, in logs, in the web bundle, or in chat. .env files are never printed.
- Do not invent endpoints, fields, enums, finding codes or tables. Report the gap instead.
- docs/ is the source of truth; when code and docs disagree, fix both in one change.
```

---

## 2. Verified state of the repository

Measured from the working tree on 2026-11-08 with commands, not from prose.

### 2.1 What exists

| Area | Path | Size / state | Verdict |
| --- | --- | --- | --- |
| API | `apps/api` | 68 OpenAPI operations on 55 paths; 25 tables; 3 Alembic revisions | Implemented |
| Web | `apps/web` | 19 dashboard routes + 9 public pages (`src/app.tsx`); 66 tests claimed | Implemented |
| Extension | `apps/extension` | MV3, esbuild, overlay + popup + options + pairing | Implemented, builds to `dist/` |
| SDK | `packages/sdk` | `@trustlens/sdk`, 20 tests | Implemented |
| Shared types | `packages/shared-types` | generated from `apps/api/openapi.json` | Generated — never hand-edit |
| Demo sites | `apps/demo-sites` | 6 inert sites, 2 lookalike families, 15 tests | Implemented |
| Infra | `infrastructure/render.yaml`, `docker-compose.yml`, `apps/web/vercel.json` | Blueprints only | **Not deployed** |
| Database | Alembic head `c2a0plat0001` | chain `b019d0cc250d → c1a0gov00001 → c2a0plat0001` | Migrated (previous owner's Supabase) |
| Docs | `docs/` | 47 files, 17,659 lines (46 / 16,841 before this brief) | Source of truth |
| Git | — | no `.git` | **Not initialised** |

**Nothing is deployed.** Render and Vercel configs exist; no hosted environment has been created by
the current owner.

### 2.2 API surface — 68 operations, 55 paths

Paths excluded from OpenAPI by design: `/internal/jobs/*` (QStash-signed) and `/webhooks/clerk`
(Svix-signed). They exist in code and must be tested, but are not public contract.

**auth** (7) — `GET/DELETE /api/v1/auth/me`, `POST /api/v1/auth/logout`,
`POST /api/v1/auth/extension/pair`, `POST /api/v1/auth/extension/exchange`,
`GET /api/v1/auth/extension/devices`, `DELETE /api/v1/auth/extension/devices/{device_id}`

**scans** (7) — `POST /api/v1/assess`, `POST /api/v1/scans`, `GET /api/v1/scans`,
`GET /api/v1/scans/{scan_id}`, `POST /api/v1/verify-identity`, `POST /api/v1/verify-payment`,
`POST /api/v1/inspect-redirect`

**organisations** (18) — `GET/POST /api/v1/organisations`,
`GET/PATCH /api/v1/organisations/{org_id}`, `GET /api/v1/organisations/{org_id}/public-profile`;
domains `GET/POST /api/v1/organisations/{org_id}/domains`,
`DELETE .../domains/{domain_id}`, `POST .../domains/{domain_id}/verify`;
recipients `GET/POST .../recipients`, `DELETE .../recipients/{recipient_id}`,
`POST .../recipients/{recipient_id}/verify`;
members `GET/POST .../members`, `PATCH/DELETE .../members/{user_id}`;
invites `DELETE /api/v1/organisations/{org_id}/invites/{invite_id}`,
`POST /api/v1/invites/{token}/accept`

**certificates** (8) — `GET /api/v1/certificates`, `GET /api/v1/certificates/{certificate_id}`,
`GET/POST /api/v1/certificates/incidents`, `GET/POST /api/v1/certificates/monitors`,
`DELETE /api/v1/certificates/monitors/{monitor_id}`

**intelligence** (5) — `GET /api/v1/intelligence/entities`,
`GET /api/v1/intelligence/entities/{entity_id}`, `GET /api/v1/intelligence/graph/{entity_id}`,
`GET /api/v1/campaigns`, `GET /api/v1/campaigns/{campaign_id}`

**investigations** (3) — `POST /api/v1/investigations`,
`GET /api/v1/investigations/{investigation_id}`,
`GET /api/v1/investigations/{investigation_id}/export`

**reports** (4) — `GET/POST /api/v1/reports`, `GET /api/v1/reports/{report_id}`,
`POST /api/v1/reports/{report_id}/review`

**appeals** (5) — `GET/POST /api/v1/appeals`, `GET /api/v1/appeals/{appeal_id}`,
`POST /api/v1/appeals/{appeal_id}/verify`, `POST /api/v1/appeals/{appeal_id}/review`

**developer** (5) — `GET/POST /api/v1/api-keys`,
`DELETE /api/v1/api-keys/{key_id}`, `GET /api/v1/overview`, `GET /api/v1/usage`

**audit** (1) — `GET /api/v1/audit-logs`

**admin** (2) — `GET /api/v1/admin/demo`, `POST /api/v1/admin/demo/reset`

**health** (3) — `GET /health` (liveness), `GET /ready` (2 s DB budget), `GET /api/v1/health`

Route modules: `apps/api/app/api/routes/` — one file per resource, plus `internal_jobs.py`,
`webhooks.py`, `admin.py`.

### 2.3 Data model — 25 tables

`users`, `refresh_tokens`, `api_keys`, `pairing_codes`, `organisations`,
`organisation_members`, `organisation_invites`, `verified_domains`, `domain_verifications`,
`verified_recipients`, `scans`, `scan_findings`, `evidence`, `entities`, `relationships`,
`threat_reports`, `campaigns`, `certificates`, `certificate_monitors`,
`certificate_incidents`, `investigations`, `audit_logs`, `idempotency_keys`, `usage_counters`,
`appeals`.

Owner: `docs/02-architecture/DATABASE_DESIGN.md`. ULID primary keys; JSON is `snake_case`;
`users.clerk_user_id TEXT` (Supabase `auth.uid()` is never populated — Supabase is Postgres, not
identity). RLS is enabled on every table; the API connects as owner and bypasses it, while Supabase
`anon`/`authenticated` are denied. `audit_logs` is append-only via trigger.

### 2.4 Enums and error codes

Owner: `docs/02-architecture/API_CONTRACTS.md` §5.5/§7, asserted against
`apps/api/tests/fixtures/contract_enums.json`.

| Enum | Values |
| --- | --- |
| `Decision` | `BLOCK`, `WARN`, `ALLOW`, `REVIEW`, `UNKNOWN` |
| `RiskLevel` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN` |
| `ScanStatus` | `queued`, `running`, `completed`, `partial`, `failed` |
| `Intent` | `browse`, `login`, `payment`, `download`, `data_submission` |
| `SignalGroup` | `reputation`, `identity`, `credential_destination`, `payment_destination`, `infrastructure` |
| `Severity` | `critical`, `high`, `medium`, `low`, `info` |
| `CoverageState` | `collected`, `unavailable`, `skipped` |
| `ReportStatus` | `pending`, `reviewing`, `confirmed`, `dismissed` |
| `InvestigationStatus` | `queued`, `running`, `completed`, `partial`, `failed` |
| `RecipientType` | `upi_vpa`, `iban`, `bank_account`, `wallet_address`, `payment_link` |
| `Match` | `exact`, `none`, `unverifiable` |
| `VerificationStatus` | `pending`, `verifying`, `verified`, `failed`, `expired`, `revoked` |
| `EntityType` | `domain`, `url`, `ip`, `asn`, `nameserver`, `certificate`, `certificate_authority`, `organisation`, `payment_recipient`, `campaign`, `threat_report` |
| `ErrorCode` | 57 stable strings (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `REPORT_DUPLICATE`, `INVESTIGATION_LIMIT_REACHED`, `REVERIFICATION_REQUIRED`, …) |

42 finding codes live in `apps/api/app/risk/codes.py`, including
`DOMAIN_NOT_REGISTERED_BY_BRAND`, `PAYEE_NOT_IN_VERIFIED_PROFILE`, `PAYEE_MATCH_CONFIRMED`,
`CREDENTIAL_DESTINATION_MISMATCH`, `SHARES_INFRA_WITH_REPORTED_THREAT`,
`NO_KNOWN_THREAT_IN_COVERAGE`.

### 2.5 Risk engine facts (code, not prose)

- Weights: `reputation` 30, `identity` 25, `credential_destination` 20,
  `payment_destination` 15, `infrastructure` 10 (`risk/engine.py`).
- Overrides, evaluated in order, can only **raise** a decision:
  - `O-1` `DOMAIN_ON_ANALYST_BLOCKLIST` → `BLOCK`
  - `O-2` `PAYEE_NOT_IN_VERIFIED_PROFILE`, payment intent, observed match `none`, ≥1 expected payee → `BLOCK`
  - `O-3` `PAYEE_LINKED_TO_REPORTED_SCAM` + payment intent → `BLOCK`
  - `O-4` login intent and `CREDENTIAL_DESTINATION_MISMATCH` or `CREDENTIALS_POSTED_OVER_HTTP` → `BLOCK`
  - `O-5` `CREDENTIALS_POSTED_TO_THIRD_PARTY` + login intent → `BLOCK`
  - `O-6` `KNOWN_MALICIOUS_REPUTATION` → `BLOCK`
  - `O-7` target unreachable and **no** non-info findings → `UNKNOWN`
- Two brand claims on one page caps the decision at `WARN` unless an override forced `BLOCK`.
- Worked example: lookalike ≈ 62 / `HIGH`, `O-2` forces `BLOCK`.

### 2.6 Environment variables (names only)

**API** (`apps/api/.env.example`): `ENVIRONMENT`, `APP_VERSION`, `PORT`, `DATABASE_URL`,
`DIRECT_DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `CLERK_ISSUER`, `CLERK_JWKS_URL`,
`CLERK_AUTHORIZED_PARTY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_TOKEN`,
`QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `RESEND_API_KEY` (OPTIONAL),
`EMAIL_FROM`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_EXTRA_BODY`, `PROMPT_VERSION`,
`DEMO_MODE`, `DEV_AUTH_ENABLED`, `ALLOW_DEMO_SEED`, `DEEP_SCAN_ENABLED`, `SCAN_CONCURRENCY`,
`SCAN_BUDGET_SECONDS`, `IP_HASH_SALT`, `LOG_LEVEL`, `SENTRY_DSN`, `LANGSMITH_API_KEY`,
`LANGSMITH_PROJECT`.

Production gates in `app/config.py`: `DEV_AUTH_ENABLED` must be false; `DIRECT_DATABASE_URL`,
`JWT_SECRET` (≥32 chars), `CLERK_SECRET_KEY`, `SUPABASE_*`, `UPSTASH_*`,
`QSTASH_CURRENT_SIGNING_KEY`, `IP_HASH_SALT` are required.

**Web** (`apps/web/.env.example`): `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`,
`VITE_DEMO_MODE`, `VITE_APP_VERSION`.

**Extension** (`apps/extension/.env.example`): `VITE_API_BASE_URL`, `VITE_WEB_BASE_URL`,
`VITE_DEMO_SITES_ORIGIN`.

Never put an API secret in a `VITE_*` variable; it is compiled into a public bundle.

### 2.7 Test suites

| Suite | Location | Run | Handover count |
| --- | --- | --- | --- |
| API unit / contract / integration | `apps/api/tests/{unit,contracts,integration}` | `pytest -q` | 300 (incl. DB) |
| Web | colocated `*.test.tsx` under `apps/web/src` | `pnpm --filter @trustlens/web test` | 66 |
| Extension | `apps/extension/test` | `pnpm --filter @trustlens/extension test` | 54 |
| SDK | `packages/sdk/test` | `pnpm --filter @trustlens/sdk test` | 20 |
| Demo sites | `apps/demo-sites/test` | `pnpm --filter @trustlens/demo-sites test` | 15 |

Pytest markers: `db` (needs `TEST_DATABASE_URL`), `network` (never in default CI). DB tests skip
without `TEST_DATABASE_URL` — a skipped integration suite is not a passing one.

### 2.8 Scripts

`apps/api/app/scripts/`: `seed_demo` (idempotent canonical Northstar data), `reset_demo`,
`demo_check` (26 assertions over HTTP), `platform_check` (42 checks), `set_role`, `register_schedules`
(QStash cron), `dump_openapi`.

---

## 3. The context folder — `docs/handover/`

This is the "what is built and why" folder. Read it before the specification; it is the only
material written *after* the code existed.

| File | Size | Read it | Why |
| --- | --- | --- | --- |
| `HANDOVER.md` | ~14 KB | **Fully, first** | Current state, first-hour checklist, hosted services, env vars, 14 traps, deployment runbook, open items, working agreements |
| `PROGRESS_LOG.md` | ~6 KB | **Fully, second** | Build chronology, decisions made during the build, bugs found and fixed, verification record |
| `CONVERSATION_LOG.md` | ~234 KB | **Selectively by grep** | Redacted build conversation. Use for "why was this done" only; never read end to end |

Rules for the conversation log: search a term (`grep -n -i "reverification" docs/handover/CONVERSATION_LOG.md`),
read ±30 lines, cite the decision you found, and prefer `PROGRESS_LOG.md` §3 if both answer.

---

## 4. Documentation map — what folder explains what

`docs/` is the specification, 46 files. Read docs for intent and contracts; read code for what
actually runs. When they disagree, that is a defect (§14) — fix both.

| Folder / file | Question it answers |
| --- | --- |
| `00-project-foundation/PROJECT_OVERVIEW.md` | What is TrustLens, what is out of scope, terminology |
| `00-project-foundation/TECH_STACK.md` | Why these technologies; rejected alternatives |
| `00-project-foundation/DEVELOPMENT_GUIDELINES.md` | Coding, review, documentation rules; agent instructions |
| `01-product/PRODUCT_REQUIREMENTS.md` | Requirements and IDs (`PR-*`) |
| `01-product/FEATURE_SPECIFICATIONS.md` | Feature catalogue `TL-001`…`TL-024` |
| `01-product/USER_JOURNEYS.md`, `USER_PERSONAS.md` | Who uses it and what they do |
| `01-product/PRODUCT_ROADMAP.md` | What comes after the MVP |
| `02-architecture/SYSTEM_ARCHITECTURE.md` | Components, request lifecycle, trust boundaries, **15 ADRs** |
| `02-architecture/DATA_FLOW.md` | End-to-end flows and sequence diagrams |
| `02-architecture/DATABASE_DESIGN.md` | Tables, columns, indexes, invariants, restore drill (§13) |
| `02-architecture/API_CONTRACTS.md` | Envelope, enums, error codes, pagination, versioning |
| `02-architecture/HOSTED_SERVICES.md` | Free-tier services, limits, failure behaviour, migration path |
| `03-backend/BACKEND_OVERVIEW.md` | Module layout and request path |
| `03-backend/AUTHENTICATION_AUTHORIZATION.md` | Clerk JWT verification, `azp`, revocation, webhooks, RLS posture |
| `03-backend/API_ENDPOINTS.md` | Per-endpoint request/response contracts (64 numbered rows) |
| `03-backend/RISK_ENGINE.md` | Weights, `R-*` rules, finding codes, decision policy, overrides |
| `03-backend/ORGANISATION_TRUST_PROFILES.md` | Domain/recipient verification lifecycles |
| `04-frontend/FRONTEND_ARCHITECTURE.md` | Routing, data fetching, state, error boundaries |
| `04-frontend/DESIGN_SYSTEM.md` | Tokens, components, colour semantics |
| `04-frontend/UI_UX_SPECIFICATIONS.md` | Screens, states, interactions |
| `04-frontend/ANIMATION_GUIDELINES.md`, `ACCESSIBILITY_RESPONSIVENESS.md` | Motion and a11y rules |
| `05-browser-extension/*` | MV3 architecture, decision behaviour, fail modes, API integration |
| `06-sdk/*` | Public SDK surface and integration guide |
| `07-ai-intelligence/THREAT_GRAPH.md` | Node/edge vocabulary, confidence, traversal limits |
| `07-ai-intelligence/THREAT_INTELLIGENCE_ENGINE.md` | Ingestion and correlation |
| `07-ai-intelligence/AI_INVESTIGATION_ENGINE.md` | LangGraph topology, prompts, output schema |
| `08-infrastructure/DEPLOYMENT_ARCHITECTURE.md` | Render/Vercel topology, cold starts |
| `08-infrastructure/ENVIRONMENT_CONFIGURATION.md` | Every env var, default, production gate |
| `08-infrastructure/MONITORING_HEALTHCHECKS.md` | Health/readiness contracts, logs, metrics |
| `09-testing-security/TESTING_STRATEGY.md` | Test pyramid, fixtures, what must be asserted |
| `09-testing-security/SECURITY_THREAT_MODEL.md` | Threats, mitigations, residual risk, implementation status |
| `10-hackathon-demo/DEMO_RUNBOOK.md` | Seed data, demo beats, expected verdicts |
| `INDEX.md` | Source-of-truth map — one owner per fact |
| `DOCUMENTATION_COVERAGE.md` | Coverage and consistency matrix, open questions |
| `AGENTS.md` / `CLAUDE.md` | Rulebooks for agents |
| `skills/impeccable-frontend`, `skills/design-system-guardrails` | Visual craft standards — read before any UI work |
| `handover/*` | See §3 |

---

## 5. Code map — what each folder does

```text
apps/api/
  app/main.py                  app factory, middleware, routers, lifespan
  app/config.py                pydantic settings + production gates
  app/serve.py                 Windows-safe launcher (selector loop)
  app/api/routes/              one module per resource (+ internal_jobs, webhooks, admin)
  app/api/deps.py              auth dependencies, pagination, org permission checks
  app/api/handlers.py          exception → error envelope mapping
  app/api/middleware.py        body-size limit, request id, CORS, security headers
  app/risk/                    engine.py (weights, score, overrides, decide), rules.py, codes.py, reasons.py
  app/services/                guard.py (SSRF), collectors.py, scan_orchestrator.py, context.py,
                               investigations.py, domain_verification.py, accounts.py, audit.py,
                               email.py, ratelimit.py, usage.py, jobs.py, redirects.py, deep_scan.py,
                               idempotency.py, serialise.py, validation.py, demo_fixtures.py
  app/intelligence/            graph.py (entities/relationships traversal), campaigns.py
  app/agents/                  graph.py (LangGraph StateGraph), narrative.py (LLM + template fallback)
  app/security/                auth.py (Clerk JWT, dev tokens, API keys), ssrf.py, redaction.py,
                               qstash.py, svix.py
  app/models/tables.py         25 SQLAlchemy tables
  app/schemas/                 enums.py, common.py, resources.py, platform.py, governance.py, health.py
  app/scripts/                 seed_demo, reset_demo, demo_check, platform_check, set_role,
                               register_schedules, dump_openapi
  alembic/                     env.py loads apps/api/.env; versions/ has 3 revisions
  tests/                       unit/, contracts/, integration/ (marker db), fixtures/

apps/web/src/
  app.tsx                      router (public + /app dashboard)
  routes/public/               Landing, Login, Appeal, InfoPages, NotFound
  routes/app/                  Overview, ScanIndex, ScanReport, Investigation, Intelligence, Campaigns,
                               Organisations (+ tabs), Certificates, Appeals, AuditLogs, Reports,
                               Developers, Settings (+ ClerkAccount, DeleteAccount, DemoCard), AcceptInvite
  components/ui/               Button, Card, Field, Table, Tabs, Overlay, Skeleton, States, Toaster,
                               ConfirmDialog
  components/domain/           Badges (verdict), Meters (coverage), FindingRow, EvidenceDrawer,
                               ChallengePanel, GraphList, Monitors, PairedDevices, ReportSiteDialog,
                               ScanInput, TechnicalPanel, UsagePanel, Text
  components/layout/           AppShell, PublicShell, Guards, Banners, PageHeader, Logo, ThemeController
  lib/api/                     client.ts (fetch + auth header), endpoints.ts (typed calls), types.ts,
                               enums.ts (as-const unions), errors.ts
  lib/auth/                    AuthProvider, token.ts, reverification.ts
  lib/query/                   hooks.ts (React Query), keys.ts
  lib/validation/domain.ts     domain normalisation shared with forms
  lib/image/phash.ts           logo perceptual hash (computed in browser)
  stores/                      recent.ts, toast.ts, ui.ts (zustand)
  styles/tokens.css, globals.css
  test/harness.tsx             render helper for tests

apps/extension/src/
  background/service-worker.ts  the only network caller; cache TTL 10 min; fail-visible
  background/api.ts, storage.ts
  content/content.ts, overlay.ts
  popup/, options/
  shared/                       detect.ts (page intent), assessment.ts, cache.ts, config.ts, copy.ts,
                                demo-url.ts, hash.ts, messages.ts, overlay-model.ts, page.ts,
                                pair-form.ts, tokens.ts, types.ts

apps/demo-sites/
  server.mjs                   zero-dependency node:http server, path mode /site/<host>/...
  sites/<host>/                inert HTML for genuine + lookalike sites
  static/demo.css, demo.js

packages/sdk/src/              client.ts, types.ts, normalise.ts, helpers.ts, errors.ts, index.ts
packages/shared-types/src/     openapi.ts + index.ts, generated (`pnpm gen:types`)
infrastructure/render.yaml     Render blueprint (root apps/api, region singapore)
```

---

## 6. Machine state — initialised vs not (verified 2026-11-08)

| Item | State | Consequence |
| --- | --- | --- |
| Node | v24.14.0 | OK (repo requires ≥20) |
| pnpm | 9.15.9 | Matches `packageManager` pin |
| `node_modules` | present | `pnpm install` may be unnecessary; run `pnpm install --frozen-lockfile` only if resolution errors appear |
| System Python | 3.14.2 | Newer than the tested 3.12/3.13; some wheels may not exist |
| `apps/api/.venv` | **BROKEN** — interpreter path points at a removed `Python313\python.exe` | Rebuild the venv; do not try to repair it |
| Docker | 29.8.0 installed, **daemon not running** | `docker compose up -d db` fails until Docker Desktop starts |
| `apps/api/.env` | present | Never print it; verify names, not values |
| `apps/api/.env.tokyo` | present | Second, region-specific env file; not the one used locally |
| `apps/web/.env.local` | present | Leave `VITE_CLERK_PUBLISHABLE_KEY` empty for dev sign-in |
| `apps/web/dist`, `apps/extension/dist` | present | Build artefacts from the previous owner; rebuild before trusting |
| `.git` | **absent** | No history; commit before making changes so a diff is reviewable |
| Local DB | not verified (daemon down) | Migrations/seed/e2e cannot run until it is up |

`git init && git add -A && git commit -m "TrustLens: initial import"` is the first action after
inspection, so every later change is reviewable. Do not push anywhere without being asked.

---

## 7. Bring-up runbook

### 7.1 Local (Docker Postgres)

```bash
# 0. history
git init && git add -A && git commit -m "TrustLens: initial import"

# 1. database
docker compose up -d db
docker compose ps                     # expect db healthy

# 2. API
cd apps/api
python -m venv .venv                  # with 3.12 or 3.13
. .venv/Scripts/activate              # macOS/Linux: . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                  # DATABASE_URL/DIRECT_DATABASE_URL -> localhost:5432/trustlens
                                      # DEMO_MODE=true, DEV_AUTH_ENABLED=true
alembic upgrade head
python -m app.scripts.seed_demo
python -m app.serve                   # :8000 ; Linux: uvicorn app.main:app
```

Expected: `GET /health` → 200 with `status: ok`; `GET /ready` → 200 with DB check under 2 s;
`GET /api/v1/health` → versioned envelope. `POST /api/v1/assess` with the lookalike host returns
`BLOCK` when `DEMO_MODE=true` (recorded fixtures, ADR-016).

```bash
# 3. web (repo root)
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @trustlens/web dev       # :5173, strictPort
```

```bash
# 4. demo sites
node apps/demo-sites/server.mjs        # :8081, index at /
```

```bash
# 5. extension
VITE_DEMO_SITES_ORIGIN=http://localhost:8081 pnpm --filter @trustlens/extension build
# chrome://extensions -> Developer mode -> Load unpacked -> apps/extension/dist
# dashboard -> Developers -> Browser extension -> Generate pairing code -> pair
```

```bash
# 6. prove
python -m app.scripts.reset_demo && python -m app.scripts.seed_demo
python -m app.scripts.demo_check        # 26/26
python -m app.scripts.platform_check    # 42/42
```

### 7.2 Failure playbook

| Symptom | Cause | Fix |
| --- | --- | --- |
| `did not find executable ...Python313` | stale venv | delete `.venv`, rebuild with an installed Python |
| `PoolTimeout` / loop errors on Windows | Proactor loop with psycopg async | `python -m app.serve`, never plain uvicorn |
| `prepared statement already exists` | statement cache on pooler 6543 | keep `statement_cache_size=0` and unique statement names |
| `→` / `₹` crashes a script | cp1252 console | `PYTHONIOENCODING=utf-8` |
| `/ready` 503 first request | distant DB / paused Supabase | co-locate regions; wake the project |
| DNS timeouts on Windows | selector loop + async resolver | threaded resolver (already in `collectors`/`domain_verification`) |
| `409 REPORT_DUPLICATE` in `demo_check` | ran twice without reset | `reset_demo` first |
| Web tests read the real Clerk key | `.env.local` leaking into tests | `vite.config.ts` blanks it in `test.env`; keep that |
| Extension shows `UNKNOWN` after 10 min | cache TTL by design | expected behaviour, not a bug |

---

## 8. Verification ladder

Run in order; each rung must pass before the next is meaningful.

| # | Rung | Command | Pass criterion |
| --- | --- | --- | --- |
| 1 | Lint/format | `cd apps/api && ruff check . && ruff format --check .` | clean |
| 2 | Types (API) | `mypy app` | clean, strict |
| 3 | Unit tests | `pytest -q` | all pass, no unexpected skips |
| 4 | Contract | `pytest tests/contracts -q` | enums + error codes + snake_case match fixtures |
| 5 | DB integration | `TEST_DATABASE_URL=... pytest -m db -q` | pass against migrated Postgres |
| 6 | Web checks | `pnpm --filter @trustlens/web lint typecheck test build` | clean, 66+ tests |
| 7 | Extension | `pnpm --filter @trustlens/extension lint typecheck test build` | clean, 54+ tests |
| 8 | SDK + demo sites | `pnpm --filter @trustlens/sdk test` `pnpm --filter @trustlens/demo-sites test` | clean |
| 9 | API e2e | `demo_check` | 26/26 |
| 10 | Platform e2e | `platform_check` | 42/42 |
| 11 | Manual browser | load web, scan the lookalike, open report | `BLOCK`, findings listed, coverage shown |
| 12 | Extension | load unpacked, visit lookalike `/pay` | overlay `BLOCK`, "Full report" opens the scan |

Rung 11/12 counts only if you actually viewed the page. Otherwise report "not viewed".

---

## 9. Real-world scenario matrix

Each row is a test that must exist somewhere (unit, contract, integration, or e2e). "Real" means a
realistic input, not necessarily a live target. Live targets are read-only and safe.

| # | Scenario | Input | Expected | Asserted in |
| --- | --- | --- | --- | --- |
| 1 | Genuine login | `login.northstar-demo.example`, intent login | `ALLOW`, coverage shown, copy "No known threat" | e2e + web |
| 2 | Genuine payment | `pay.northstar-demo.example`, payee `fees@northstar-demo` | `ALLOW`, `PAYEE_MATCH_CONFIRMED` | e2e |
| 3 | Lookalike payment | `apply.northstar-admissions.example/pay`, payee `fees@okaxis` | `BLOCK`, `O-2`, `PAYEE_NOT_IN_VERIFIED_PROFILE` | demo_check + unit |
| 4 | Lookalike scholarship | `apply.northstar-scholarships.example/pay` | `BLOCK` or `WARN` per fixtures; never `ALLOW` | e2e |
| 5 | Credential exfiltration | `portal.northstar-placement.example`, login action to `collect.badhost.example` | `BLOCK`, `O-4`/`O-5`, `CREDENTIALS_POSTED_TO_THIRD_PARTY` | unit + e2e |
| 6 | HTTP credential form | login form over `http://` | `BLOCK`, `CREDENTIALS_POSTED_OVER_HTTP` | unit |
| 7 | Brand claim on unverified domain | page claims Northstar, domain not in profile | `WARN`/`BLOCK` per rules, `BRAND_CLAIM_ON_UNVERIFIED_DOMAIN` | unit |
| 8 | Two brands on one page | conflicting claims | capped at `WARN` unless override | unit |
| 9 | Dead domain | NXDOMAIN target | `UNKNOWN` via `O-7`, no findings | unit + integration |
| 10 | Typosquat | `northstar-admissions.example` vs `northstar-demo.example` | `TYPOSQUATTING_PATTERN`, score raised | unit |
| 11 | Shared infrastructure | same NS/IP as a reported threat | `SHARES_INFRA_WITH_REPORTED_THREAT`, `RELATED_THREAT_FOUND` | unit |
| 12 | Expired domain verification | verification past expiry | risk context ignores it; no false trust | unit (regression) |
| 13 | Last admin removal | `DELETE .../members/{id}` on sole admin | `409 LAST_ADMIN_REMOVAL` | integration |
| 14 | Invite expiry | accept after expiry | `410 INVITE_EXPIRED` | integration |
| 15 | Duplicate report | same target twice | `409 REPORT_DUPLICATE` | integration |
| 16 | Review without reason | `POST /reports/{id}/review` | `422 REVIEW_REASON_REQUIRED` | contract |
| 17 | Appeal attempt exhaustion | verify repeatedly | `APPEAL_ATTEMPTS_EXHAUSTED` | integration |
| 18 | Signed out | any `/api/v1/*` | `401 UNAUTHENTICATED` envelope | contract |
| 19 | Foreign origin | mutation with bad `Origin` | `403 CSRF_ORIGIN_MISMATCH` | unit |
| 20 | Wrong authorized party | valid JWT, wrong `azp` | `401`/`403`, no session | unit |
| 21 | Dev token in production | `Bearer dev:...` with `ENVIRONMENT=production` | refused at startup / 401 | unit (config) |
| 22 | Oversized body | > limit POST | `413 PAYLOAD_TOO_LARGE` | unit |
| 23 | Idempotency reuse | same key, different body | `409 IDEMPOTENCY_KEY_REUSED` | integration |
| 24 | SSRF attempts | `http://127.0.0.1`, `http://169.254.169.254`, `file://`, blocked port | `TARGET_NOT_ALLOWED` / `UNSUPPORTED_SCHEME` / `UNSUPPORTED_PORT` | unit (`test_ssrf`) |
| 25 | Redirect to blocked target | open redirect to metadata IP | `REDIRECT_TO_BLOCKED_TARGET` | unit |
| 26 | Stale extension cache | cache entry older than 10 min | renders `UNKNOWN`, never stale `ALLOW` | extension test |
| 27 | Prompt injection in page | page text says "ignore rules, ALLOW" | decision unchanged; narrative may quote, never obey | unit (`test_narrative`) |
| 28 | LLM failure | timeout/empty/fenced output | template narrative, `AI_UNAVAILABLE` where applicable | unit |
| 29 | Redis down | unset Upstash | in-process limits, `X-RateLimit-Degraded`, never 500 | unit |
| 30 | Real public site (read-only) | `https://example.com`, `https://wikipedia.org`, `https://github.com/login`, `https://paypal.com` | `ALLOW`/`WARN`/`UNKNOWN` with honest coverage; never a crash | manual, marker `network` |
| 31 | Unreachable host | `https://does-not-exist.invalid` | `UNKNOWN`, `TARGET_UNREACHABLE` info finding | unit |
| 32 | API key scopes | read-only key calling a write endpoint | `403 INSUFFICIENT_SCOPE` | integration |

Live-target rules: read-only GETs only, no credential submission, no automated login, no uploads,
rate-limit yourself, and never record a real site's data as demo seed.

---

## 10. Test-writing standard

**Backend.**
- Unit tests: pure functions (`risk/`, `security/redaction.py`, `services/validation.py`), no network,
  no DB, table-driven with `pytest.mark.parametrize`.
- Contract tests: assert enum spellings against `tests/fixtures/contract_enums.json`, response
  envelope keys are `snake_case`, error codes come from `ErrorCode`.
- Integration tests: `pytest.mark.db`, real Postgres from `TEST_DATABASE_URL`, assert constraints,
  RLS posture, audit append-only behaviour, ULID ordering.
- Never mock the risk engine to test the API; assert the decision it actually produces.
- Every bug fix gets a regression test named after the bug, not the ticket.

**Frontend.**
- Use `src/test/harness.tsx`; Testing Library + `user-event`; assert what a user sees.
- Every list has five states: loading, empty, error, populated, degraded. Test at least error,
  empty and populated for anything that fetches.
- Assert copy rules: `ALLOW` never renders "safe"/"trusted"/"verified".
- No snapshot tests of whole pages; assert roles, labels, and text.
- Fetch mocking follows the existing `lib/api/client.test.ts` pattern; do not add a new HTTP mock
  library.

**Extension.** Fixture-driven (`test/fixtures/*.json`); assert fail-visible behaviour, cache TTL
boundary, detection on real page markup shapes, and that no page content is ever sent to the API
beyond what the contract allows.

**SDK / demo sites.** Keep the zero-dependency property of `apps/demo-sites`; SDK tests assert typed
errors and `normalise()` behaviour on unknown enum values (must map to `UNKNOWN`, never throw).

Coverage is not a target. The matrix in §9 is the target. Do not add tests that assert
implementation details, and never delete a failing test to make a run green.

---

## 11. Edge functions — what may be deployable at the edge

**Status: PROPOSED. Nothing at the edge exists today, and nothing needs to.** The stack is a
FastAPI service on Render plus a static Vite SPA on Vercel. There is no edge runtime in the
architecture, and the verdict path must not move to one.

What is legitimately edge-shaped, if the owner wants it:

| Candidate | Runtime | Allowed to do | Must never do |
| --- | --- | --- | --- |
| Same-origin API proxy `/api/*` → API origin | Vercel Function (Node) or Cloudflare Worker | forward method/body/headers, strip cookies, add no secrets | cache authenticated responses, log bodies, alter payloads |
| Public profile read cache | Cloudflare Worker + Cache API | `GET /api/v1/organisations/{id}/public-profile`, 30 s cache, key by id | cache anything user-scoped, serve stale after revoke |
| Health probe / uptime fan-out | Vercel Cron or Worker cron | poll `/health`, alert | poll `/ready` aggressively (2 s DB budget) |
| SPA fallback + security headers | Vercel/Cloudflare config | routing, CSP, HSTS | relax CORS to `*` for credentialed routes |

Rules if built:
- Folder `apps/edge/`, own `package.json`, `wrangler.toml` **and** a Vercel `api/` alternative;
  document the choice in `docs/08-infrastructure/DEPLOYMENT_ARCHITECTURE.md` as a new ADR.
- Worker secrets hold no API keys. If a proxy needs auth, it forwards the caller's bearer token.
- Tests: `vitest` + `miniflare` for the Worker; no test may call the real API.
- Deploy requires the owner's Cloudflare/Vercel account and explicit approval. A prompt cannot
  authorise a deploy.
- The edge never scores, never decides, never parses a page for trust signals. Scanning stays behind
  `services/guard.py`.

If the owner does not want this, the correct outcome is to say "not built, not needed" — not to
invent a Worker to satisfy the word "edge".

---

## 12. Folder hygiene

```text
trustlens/
├── apps/
│   ├── api/            FastAPI — the only verdict producer
│   ├── web/            Vite SPA
│   ├── extension/      MV3, builds to dist/
│   ├── demo-sites/     zero-dependency demo server
│   └── edge/           PROPOSED — only if §11 is approved
├── packages/
│   ├── sdk/            @trustlens/sdk
│   └── shared-types/   generated from openapi.json
├── infrastructure/     render.yaml, future IaC
├── docs/               specification + handover
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

Rules:
- New backend module → owning folder under `app/` (`services`, `risk`, `intelligence`, `agents`,
  `security`) + a route module only if it is HTTP-facing. No new top-level folders in `apps/api/app`.
- New test → `tests/unit` (pure), `tests/contracts` (wire), `tests/integration` (DB) for API;
  colocated `*.test.tsx` for web; `apps/extension/test` for the extension.
- Fixtures → `tests/fixtures/` (API), `test/fixtures/` (extension). Never inline a 200-line fixture.
- Scripts → `app/scripts/`, invoked as `python -m app.scripts.<name>`.
- Migrations → `alembic/versions/`, one revision per change, descriptive slug.
- Generated artefacts (`packages/shared-types`, `dist/`, `openapi.json` when regenerated) are marked
  as generated in their header and never hand-edited.
- Never commit: `.env*` (except `.env.example`), `node_modules`, `dist`, `.venv`, caches,
  `__pycache__`, real keys, real user data, real scan evidence.

---

## 13. Deployment runbook (not yet executed by the current owner)

1. Push to GitHub under the owner's account.
2. **Supabase:** project in the API's region; `alembic upgrade head` via session pooler (5432);
   optionally `ALLOW_DEMO_SEED=true python -m app.scripts.seed_demo`.
3. **Render:** Blueprint `infrastructure/render.yaml`; secrets from §2.6;
   `ENVIRONMENT=production`, `DEV_AUTH_ENABLED=false`, `ALLOWED_ORIGINS` and
   `CLERK_AUTHORIZED_PARTY` = Vercel URL; verify `/ready`.
4. **Vercel:** root `apps/web`; `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_DEMO_MODE`;
   add the URL to Clerk allowed origins.
5. **QStash:** `python -m app.scripts.register_schedules --api-base https://<api>` (`--dry-run` first).
6. **Clerk webhook:** `https://<api>/webhooks/clerk`, events `user.created/updated/deleted`;
   `CLERK_WEBHOOK_SECRET` (until set, the endpoint answers 503 by design).
7. **Extension:** rebuild with production origins, reload.
8. Sign in once, `python -m app.scripts.set_role <you> operator` against production.
9. Rehearse `docs/10-hackathon-demo/DEMO_RUNBOOK.md` manually.

Gates: no deploy without the owner's accounts and explicit approval; warm the Render instance before
any demo (free tier sleeps ~15 min); rotate every key the previous owner shared.

---

## 14. Known doc ↔ code drift (fix in the same change)

These are verified mismatches, not suspicions. Each is small; each misleads the next reader.

| # | Where | Says | Reality | Fix |
| --- | --- | --- | --- | --- |
| 1 | `docs/CLAUDE.md` §1 | "Supabase Postgres + **Auth** + Storage" | Identity is Clerk; Supabase is Postgres only (`users.clerk_user_id`) | Reword to Clerk; keep Supabase as database |
| 2 | `docs/CLAUDE.md` §6 | `docker compose up -d db redis` | `docker-compose.yml` has no `redis` service | Drop `redis` or add the service |
| 3 | `docs/CLAUDE.md` §6 | `mypy app/services app/risk` | README and CI use `mypy app` | Align on `mypy app` |
| 4 | `docs/02-architecture/HOSTED_SERVICES.md` | object storage via `services/blobs.py`, `STORAGE_BUCKET=evidence` | No `blobs.py`, no such setting; logo pHash is computed in the browser | Mark storage as DEFERRED, or implement it |
| 5 | `README.md` | "see `apps/extension/README.md`" | File does not exist | Write it or point at `docs/05-browser-extension/` |
| 6 | `docs/INDEX.md` §3 tree | Shows `INDEX.md`, `AGENTS.md`, `CLAUDE.md`, `skills/` | Also has `handover/` (3 files) | Add `handover/` to the tree |
| 7 | Machine state | Docs assume a working Python 3.12/3.13 venv | `.venv` is broken; system Python is 3.14 | Rebuild venv; note the supported range |
| 8 | Test counts | Docs/handover claim 300/66/54/20/15 | Not re-measured after the move | Re-run and update the numbers honestly |

Rule: when you fix one of these, change docs and code in the same commit and delete the row above.

---

## 15. Traps (learned the hard way — do not rediscover)

1. **Windows event loop.** `python -m app.serve`, not bare `uvicorn`; psycopg's async pool dies on
   the Proactor loop. DNS uses a threaded resolver for the same reason.
2. **`PYTHONIOENCODING=utf-8`** or scripts printing `→`/`₹` crash on cp1252 consoles.
3. **Pooler 6543 + asyncpg**: statement caches off, unique statement names. "Optimising" this
   produces intermittent 500s.
4. **Supavisor drops idle connections.** Keep `check_connection`/`max_idle` on the checkpointer pool
   and `pool_pre_ping` on SQLAlchemy.
5. **Latency is geography.** API and DB in the same region, or `/ready` and `/assess` look broken.
6. **Dev tokens** (`Bearer dev:<email>:<role>`) are refused in production; `demo_check` and
   `platform_check` depend on them.
7. **Reasoning models** can spend the whole output budget thinking and return nothing — hence
   `LLM_EXTRA_BODY`; empty output must fall back to the template narrator.
8. **Clerk's default session token has no email.** The API fills it once via the Backend API.
   Account deletion needs `fva` ≤ 10 min; answer `403 REVERIFICATION_REQUIRED` with `clerk_error`.
9. **RLS is on everywhere.** The API bypasses as owner; `anon`/`authenticated` are denied.
   `audit_logs` is append-only by trigger. Never disable RLS to fix a query.
10. **Web tests must not read `.env.local`**; `vite.config.ts` blanks the Clerk key in `test.env`,
    and timeouts are 20 s for full-flow tests.
11. **Extension demo mode** maps `localhost:8081/site/<host>/…` to `https://<host>/…` only when built
    with `VITE_DEMO_SITES_ORIGIN`; rebuild after changing env.
12. **Seed/reset are idempotent**, but `demo_check` creates a report — reset before re-running.
13. **Render free tier sleeps**; warm it 60 s before a demo.
14. **Deep scan** (Playwright) is off by default and needs extra deps and compute.

---

## 16. Definition of done

A change is done when all of these are true, and the report says so with numbers:

- [ ] `ruff check`, `ruff format --check`, `mypy app` clean.
- [ ] `pytest -q` passes; DB integration ran (not skipped) when the change touches persistence.
- [ ] `pnpm -r typecheck lint test build` passes.
- [ ] `demo_check` 26/26 and `platform_check` 42/42 still pass, or the report explains exactly why not.
- [ ] The §9 rows affected by the change have a test that would fail if the behaviour regressed.
- [ ] Docs updated in the same change; drift rows in §14 deleted when closed.
- [ ] No secret, no real user data, no credential, no cookie in code, logs, fixtures or screenshots.
- [ ] UI changes were actually viewed; otherwise reported as "not viewed".
- [ ] Nothing deployed without explicit approval; nothing claimed as deployed unless it is.

Report format: **verified** (commands + numbers) · **changed** (files + why) · **not verified /
broken** · **drift closed**.

---

## 17. Non-negotiables

| # | Rule |
| --- | --- |
| 1 | Deterministic rules decide; the LLM narrates. The model never sets a decision or a score. |
| 2 | `ALLOW` means "no known threat within executed checks" — never "safe", "trusted" or "verified". |
| 3 | A failed check is `UNAVAILABLE`, never a pass. Coverage is always shown. |
| 4 | Every outbound request goes through `services/guard.py`, including every redirect hop and peer IP. |
| 5 | Never read or store passwords, OTPs, card numbers, cookies or form values. Metadata only. |
| 6 | Secrets live only in host env vars. No `VITE_*` secret; no `service_role` in a request path. |
| 7 | No invented endpoints, fields, enums, finding codes or tables. Report gaps instead. |
| 8 | Types are generated from `openapi.json`; never hand-edit `packages/shared-types`. |
| 9 | Simulated data is labelled `simulated: true` on every surface, including filenames. |
| 10 | Do not weaken, skip or suppress tests, and do not add linter/type suppressions to pass. |
| 11 | JSON is `snake_case` end to end; enums are `as const` unions; unknown values map to `UNKNOWN`. |
| 12 | Migrations use `DIRECT_DATABASE_URL` (5432), never the pooler. |
| 13 | Redis is advisory; correctness never depends on it. |
| 14 | LangGraph topology is static; the model never chooses tools. |
| 15 | Ask before deploying, publishing, pushing, rotating keys, or spending money. |
