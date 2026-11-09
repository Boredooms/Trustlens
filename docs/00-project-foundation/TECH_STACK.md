# TECH_STACK

> **Status:** DECIDED · **Group:** 00-project-foundation · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** technology selection, versions policy, rejected alternatives.
> **Related:** [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) · [`../02-architecture/SYSTEM_ARCHITECTURE.md`](../02-architecture/SYSTEM_ARCHITECTURE.md) · [`../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md`](../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md)

---

## 1. Stack at a glance

```text
Monorepo (pnpm workspaces + Python venv)
├── apps/web          React 18 · TypeScript · Vite · Tailwind · shadcn/ui · TanStack Query · Cytoscape
├── apps/api          Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 (async) · Alembic
├── apps/extension    Chrome MV3 · TypeScript · Vite (CRXJS)
├── packages/sdk      TypeScript · tsup · openapi-fetch-generated types
├── packages/shared-types   Generated TS types from the OpenAPI document
└── packages/ui       Shared primitives used by web (optional, thin)
```

Runtime dependencies in production are **hosted, free-tier services** — we operate no infrastructure
ourselves:

| Role | Service | Tier |
| --- | --- | --- |
| Postgres | **Supabase** (Postgres 16 + pooler) | Free |
| Cache / rate limits / locks | **Upstash Redis** (REST + TLS) | Free |
| Scheduled jobs | **Upstash QStash** | Free |
| Evidence blobs | **Supabase Storage** | Free |
| Human auth | **Clerk** (JWKS-verified session JWT) | Free — 10k MAU |
| Web hosting | **Vercel** (static SPA + previews) | Free |
| API hosting | **Render** (Python web service) | Free |
| Email | **Resend** — OPTIONAL | Free |
| Errors (optional) | **Sentry** | Free |
| LLM tracing (optional) | **LangSmith** | Free |
| LLM | OpenAI-compatible API | Pay-per-use, hard cap |

Every service is replaceable behind an interface; none holds state we cannot rebuild or export.
Full inventory, limits and failure behaviour: [`../02-architecture/HOSTED_SERVICES.md`](../02-architecture/HOSTED_SERVICES.md).

---

## 2. Selection principles

1. **One deployable backend.** Scanning, verification and investigation are Python-heavy; splitting
   them into a Node gateway plus a Python service doubles deploys and doubles the contract surface.
2. **Boring, documented technology.** Every choice must be something a teammate can debug at 2 a.m.
3. **Free-tier shaped.** No always-on workers, no Kafka, no Kubernetes, no self-hosted graph DB.
4. **Contracts before code.** OpenAPI is generated from FastAPI and consumed by TypeScript, so the
   frontend, extension and SDK cannot drift.
5. **Degrade honestly.** Any external dependency (LLM, reputation feed, CT log) must have a
   defined "unavailable" state that surfaces as reduced coverage, never as an implicit pass.

---

## 3. Frontend

### 3.1 React 18 + TypeScript 5 + Vite 5

| Aspect | Detail |
| --- | --- |
| Purpose | Public marketing site and authenticated dashboard in one SPA |
| Why | Fast dev server, trivial static build, no server runtime needed on the host |
| Alternatives considered | Next.js (SSR/SEO): rejected for MVP — the product value is behind auth, and SSR adds a Node runtime we do not want on a free tier. Astro for marketing: rejected — two apps, two design systems, duplicated components |
| Advantages | Single build artefact, code splitting per route, mature ecosystem |
| Disadvantages | No SSR → weaker SEO for public pages; mitigated with prerendered static `index.html` meta, sitemap, and semantic content |
| Integration | Builds to `dist/`, served by Vercel (SPA rewrite); `VITE_API_BASE_URL` and `VITE_CLERK_PUBLISHABLE_KEY` are baked at build time |
| Versioning | React/TS/Vite pinned by lockfile; majors upgraded deliberately, never automatically |
| Security | No secrets in the bundle; all privileged operations server-side; strict CSP on the static host; `dangerouslySetInnerHTML` banned |
| Performance | Route-level lazy loading; Cytoscape loaded only on graph routes (~250 kB gzip); budget 180 kB gzip initial JS |

### 3.2 Tailwind CSS 3 + shadcn/ui + Radix primitives

| Aspect | Detail |
| --- | --- |
| Purpose | Design-token-driven styling and accessible component primitives |
| Why | Tokens map 1:1 to CSS variables in `DESIGN_SYSTEM.md`; Radix gives keyboard/focus behaviour we would otherwise re-implement badly |
| Alternatives | MUI (heavy, opinionated look), Chakra (runtime CSS-in-JS cost), hand-rolled (accessibility risk) |
| Advantages | Copy-in components (no version lock on a component library), full control of monochrome identity |
| Disadvantages | We own the components; upgrades are manual |
| Integration | `tailwind.config.ts` reads CSS variables; shadcn components live in `src/components/ui` and are edited in-repo |
| Security | No remote component fetching, no runtime theme injection |
| Performance | Purged CSS, ~14 kB gzip |

### 3.3 TanStack Query 5

Server-state cache for every API read. Rules: queries keyed by resource + params; mutations
invalidate by key prefix; `retry: 1` for GETs, `retry: 0` for mutations; scan polling uses
`refetchInterval` that stops at terminal status (`RISK_ENGINE`/`API_CONTRACTS` status enum).

### 3.4 Zustand 4

Only for genuinely client-global, non-server state: selected graph node, extension-like "recent
checks" list in the dashboard, UI density preference. **Do not** duplicate server data into
Zustand — that is TanStack Query's job. One store file per concern, max three stores.

### 3.5 React Router 6, React Hook Form 7, Zod 3

- Router: nested layouts (`PublicLayout`, `AppLayout`), lazy routes, route-level error boundaries.
- RHF + Zod: form state and validation mirroring the API's Pydantic constraints. Zod schemas for
  API inputs live in `packages/shared-types` when they are also needed by the SDK.
- Server errors are mapped to field errors by `code`, never by string matching a message.

### 3.6 Recharts 2 and Cytoscape.js 3

| Library | Use | Why not the other |
| --- | --- | --- |
| Recharts | Small trend charts (scans/day, findings by group, certificate expiry buckets) | Cytoscape is a graph engine, not a chart lib |
| Cytoscape.js | Threat graph rendering, layouts (`cose`, `concentric`), filtering | Recharts cannot do node-link interaction |

Cytoscape graph data comes from `GET /api/v1/intelligence/graph/{entityId}` with `depth` ≤ 3.
Styling is token-driven (`DESIGN_SYSTEM.md` §9).

### 3.7 Animation: GSAP 3, Motion 11, Lenis 1

Division of labour is normative and defined in `../04-frontend/ANIMATION_GUIDELINES.md`:

- **GSAP + ScrollTrigger** — public landing hero and scroll narrative only.
- **Motion (Framer Motion)** — in-app transitions: drawers, modals, tab panels, list reorder, page fades.
- **CSS transitions** — hover/focus/press, skeletons, status colour changes.
- **Lenis** — public marketing pages only. Never in `/app/*` (interferes with nested scroll and a11y).

Three libraries is the maximum; adding a fourth requires an ADR.

### 3.8 Lucide React

Icon set. Single source for iconography; no mixed icon packs.

---

## 4. Backend

### 4.1 Python 3.12 + FastAPI 0.115

| Aspect | Detail |
| --- | --- |
| Purpose | The only verdict-producing service: scans, verification, risk engine, graph, investigations, auth |
| Why | Async I/O for fan-out network probes; Pydantic-native validation; automatic OpenAPI for type generation; scanning libraries are Python |
| Alternatives | Node/Express (needs a Python sidecar for TLS/DNS/Playwright anyway), Django (heavier, sync ORM ergonomics), Flask (no async story) |
| Advantages | One process, one contract, one deploy, strong typing at the boundary |
| Disadvantages | CPU-bound work (perceptual hashing) blocks the loop → run in a thread pool with a concurrency cap |
| Integration | `uvicorn app.main:app`, port from `$PORT`, health at `/health` and `/ready` |
| Versioning | `pyproject.toml` + pinned `requirements.txt` for the deploy image |
| Security | Pydantic validation on every input; SSRF guard before any network call; no `eval`; secrets from env only |
| Performance | Async probes with `asyncio.gather` and per-probe timeouts; global scan budget 60 s |

### 4.2 Pydantic v2

All request/response models, settings (`pydantic-settings`), and the OpenAPI schema that
`packages/shared-types` is generated from. Strict mode for enums; `extra="forbid"` on request
bodies so typos are 422s rather than silent no-ops.

### 4.3 Supabase Postgres 16 + SQLAlchemy 2 (async) + asyncpg + Alembic

| Aspect | Detail |
| --- | --- |
| Purpose | System of record: users, orgs, profiles, scans, findings, entities, relationships, reports, campaigns, certificates, investigations, audit |
| Why Supabase Postgres | Real Postgres with CTEs, `JSONB`, `pg_trgm`, daily backups and a connection pooler on a free tier; no database to operate |
| Alternatives | Neon (equally good; kept as a documented fallback), Render Postgres (free instance **expires after 30 days** — disqualified), MongoDB (weak relational integrity), SQLite (ephemeral disk) |
| Advantages | Managed backups, pooler, SQL editor for demos, Storage/Auth in the same project |
| Disadvantages | Free tier pauses after ~7 days of inactivity; pooler does not support prepared statements in transaction mode; row-level security must be understood, not ignored |
| Integration | `DATABASE_URL=postgresql+asyncpg://…@<project>.pooler.supabase.com:6543/postgres`; asyncpg with `statement_cache_size=0` in transaction mode; pool 5 + overflow 5; Alembic migrations run as an explicit release step |
| Security | App connects as a dedicated non-`postgres` role with DML only; **no `service_role` key in the API**; RLS enabled as defence in depth for the Supabase-facing surfaces; parameterised queries only |
| Performance | Indexes defined in `DATABASE_DESIGN.md` §10; pooler handles connection fan-in across restarts; `EXPLAIN` review for any query over 50 ms in dev |

**Pooler caveat, learned the hard way:** Supabase's transaction-mode pooler (port 6543) cannot use
server-side prepared statements. asyncpg must be configured with `statement_cache_size=0` (and
`prepared_statement_cache_size=0` on the SQLAlchemy dialect), or intermittent
`prepared statement "__asyncpg_stmt_1__" already exists` errors appear under load. The session-mode
pooler (port 5432) is available but exhausts connections faster; we use transaction mode.

### 4.4 ASGI HTTP client, DNS and TLS libraries

| Need | Library | Note |
| --- | --- | --- |
| HTTP probes | `httpx` (async) | Manual redirect handling so each hop is validated |
| DNS | `dnspython` (async resolver) | A, AAAA, CNAME, NS, MX, TXT; no DoH dependency |
| TLS | stdlib `ssl` + `cryptography` | Chain parse, SANs, key size, signature algorithm, fingerprints |
| Registration | RDAP over HTTPS | No WHOIS scraping; RDAP failure → `UNAVAILABLE` |
| Identifiers | `python-ulid` | 26-char sortable IDs |
| Hashing/phash | `Pillow` + `imagehash` | Logo/favicon perceptual hashes |
| HTML parsing | `selectolax` or `lxml` | Fast DOM queries for forms/links/scripts |

### 4.5 Playwright (Chromium) — OPTIONAL at MVP runtime, REQUIRED for deep scans

Headless rendering is the only reliable way to see JS-injected forms and client-side redirects.
Constraint: it is memory-hungry and slow on a 512 MB free instance.

**DECIDED:** MVP runs *static* DOM analysis for every scan (fast, cheap) and enables Playwright
behind a `DEEP_SCAN_ENABLED` flag with a strict one-page, 15 s, 25 MB budget. When disabled, the
scan reports `page.dom_source = "static"` and coverage for `PAGE_RENDER` is `SKIPPED`. The
`UNAVAILABLE`/`SKIPPED` distinction is defined in `RISK_ENGINE.md` §6.

### 4.6 AI: hosted LLM API via a provider-agnostic client

| Aspect | Detail |
| --- | --- |
| Purpose | Turn structured findings into a human-readable, evidence-cited incident narrative |
| Why external | No GPU, no training budget, no need to host a model for text summarisation |
| Alternatives | Self-hosted OSS model (ops cost), no AI (loses the "investigator" story) |
| Constraint | **The model never produces findings, scores or decisions.** It may only reference finding IDs it was given |
| Failure mode | No key / provider error → deterministic template report, `ai.generated = false`; UI labels it as template output |
| Cost | One call per investigation, max 8k input tokens, max 1.2k output; hard per-user daily cap |
| Security | Untrusted page text is fenced and labelled as data; tool allowlist; output validated against a JSON schema before storage |

### 4.7 Auth libraries

`python-jose` (JWT), `passlib[bcrypt]` (password hashing, cost 12), `secrets` for API keys and
pairing codes. API keys stored as SHA-256 of the secret with a visible prefix for identification.
Details: `../03-backend/AUTHENTICATION_AUTHORIZATION.md`.

---

## 5. Browser extension

| Aspect | Detail |
| --- | --- |
| Platform | Chrome Manifest V3 (also loads in Edge/Chromium) |
| Language | TypeScript, built with Vite + CRXJS |
| Modules | Service worker (network + cache + verdicts), content script (DOM/form inspection), popup (UI), options page |
| Why not MV2 | MV2 is unsupported in current Chrome |
| Constraints | Service worker is ephemeral (state lost after ~30 s idle) → state in `chrome.storage.session`/`local`; no remote code; no `eval` |
| Permissions | `storage`, `activeTab`, `scripting`, host permissions only for the API origin and the demo domains; **not** `<all_urls>` at install — optional host permission requested on demand |
| Security | Device token in `chrome.storage.local` (never synced), no passwords/OTP/card capture, minimal DOM read, no screenshot upload |
| Distribution | Unpacked build for the demo; Chrome Web Store listing is FUTURE |

Observation limits (what a content script genuinely cannot see) are enumerated in
`../05-browser-extension/BROWSER_PROTECTION_LOGIC.md` §4. This matters: we must not promise
protection inside cross-origin iframes, closed shadow roots, or native payment sheets.

---

## 6. SDK and shared types

| Aspect | Detail |
| --- | --- |
| Package | `trustlens-sdk` |
| Language | TypeScript 5, dual ESM+CJS, `.d.ts` shipped |
| Build | `tsup` |
| HTTP | Native `fetch` (Node 18+, browsers, Workers); no axios |
| Types | Generated from `apps/api/openapi.json` into `packages/shared-types`; SDK re-exports the verdict types |
| Why generated types | Guarantees the SDK cannot describe a field the API does not return |
| Errors | Typed error classes with `code`, `status`, `requestId`, `retryable` (`SDK_SPECIFICATION.md` §7) |
| Versioning | Semver; additive fields only within a major; deprecations announced one minor ahead |

---

## 7. Infrastructure and tooling

| Concern | Choice | Why |
| --- | --- | --- |
| Hosting (web) | **Vercel** | Free, CDN, per-PR previews, immutable deploys |
| Hosting (API) | Render Web Service, Python runtime, free plan | Single service, `render.yaml` codified |
| Database | **Supabase Postgres** (pooler, port 6543) | Managed, backed up, free; Render's free Postgres expires after 30 days |
| Cache / limits | **Upstash Redis** (REST) | Shared rate limits and verdict cache across workers without a VPC |
| Scheduled jobs | **Upstash QStash** | Free cron → HTTPS, no worker process to keep alive |
| Objects | **Supabase Storage** | Evidence blobs without self-hosted S3 |
| Human auth | **Clerk** | Hosted sign-in UI, MFA, password reset, JWKS — removes auth UI and session work |
| Object storage (optional) | S3-compatible bucket | Evidence blobs (page snapshots, logos) beyond 30 days |
| CI | GitHub Actions | Lint, typecheck, tests, OpenAPI drift check, secret scan |
| Local dev | `docker-compose.yml` for Postgres only | Everything else runs natively |
| Package manager | pnpm workspaces (JS) + `uv`/venv (Python) | Fast, deterministic |
| Formatting | Prettier + ESLint (TS), Ruff (Python) | Single formatter per language, no debates |
| Testing | Vitest (web/sdk/extension), Playwright (E2E), pytest + httpx ASGI transport (API) | See `09-testing-security/TESTING_STRATEGY.md` |

---

## 8. Rejected and deferred technologies

| Technology | Verdict | Reason |
| --- | --- | --- |
| Next.js | Rejected for MVP | Node runtime on the host; product value is authenticated |
| Node/Express gateway | Rejected | Duplicate deploy + duplicate contract for no benefit |
| Neo4j | Deferred | Relational recursive CTE is sufficient at depth ≤ 3 |
| Redis (self-hosted) | Rejected; **Upstash Redis adopted** | We need shared rate limits and cache across workers, but will not operate a Redis server |
| Celery / BullMQ | Rejected | Bounded async tasks inside the API; QStash covers cron; scans capped at 60 s |
| Supabase Edge Functions | Deferred | Our logic is Python; a Deno runtime would split the codebase for no gain |
| Supabase Realtime | Deferred | Polling is sufficient for scans/investigations at this scale |
| Auth0 | Rejected | Same capability, but heavier configuration than Clerk for a single Vite SPA |
| NextAuth / Auth.js | Rejected | Requires Next.js route handlers; our web app is a Vite SPA and our API is FastAPI |
| Supabase Auth | Rejected | Would couple human identity to the database vendor; Clerk keeps the seam clean |
| Kafka | Rejected | No stream processing need |
| Kubernetes | Rejected | One service |
| GraphQL | Rejected | REST + OpenAPI generates better types for three clients |
| Meilisearch / Elasticsearch | Deferred | Postgres `pg_trgm` covers URL/domain search |
| MongoDB | Rejected | Verification and profile invariants want transactions |
| Self-hosted LLM | Deferred | No GPU budget |
| Sentry SaaS | OPTIONAL | Structured logs + request IDs first; add if a DSN is available |
| Terraform | Rejected | `render.yaml` + provider dashboard is enough at this scale |

---

## 9. Constraints imposed by free hosting

| Constraint | Engineering response |
| --- | --- |
| Web service sleeps after ~15 min idle; cold start ≈ 30–60 s | Static frontend stays instant; dashboard shows a "waking backend" state; warm before demo; `/ready` is cheap |
| 512 MB RAM, shared CPU | Static DOM analysis by default; Playwright behind a flag and a semaphore of 1 |
| Ephemeral filesystem | No local writes for state; evidence to Postgres (JSONB) or object storage |
| No background workers | Scans execute as bounded in-process tasks with polling; **QStash** drives cron (certificate sweep, reputation decay, stale-scan reconciliation) |
| Free tier pause (Supabase) | A weekly QStash job touches the database so the free project does not pause mid-week; documented in `HOSTED_SERVICES.md` §5 |
| Single instance | No in-memory state that must survive a restart; no leader election assumptions |
| DB connection limits | Pool 5 + overflow 5; short-lived sessions; no long transactions across network calls |

Details and the deployment sequence: `../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md`.

---

## 10. Version policy

| Layer | Policy |
| --- | --- |
| Node | 20 LTS, pinned via `.nvmrc` and `engines` |
| pnpm | 9.x, `packageManager` field |
| Python | 3.12 (`runtime: python` in `render.yaml`, `.python-version`) |
| Runtime deps | Lockfile pinned; Renovate/Dependabot PRs reviewed weekly |
| Majors | Upgraded in dedicated PRs with a full test run; never bundled with a feature |
| API | `/api/v1`; breaking change → `/api/v2`, v1 supported for at least one release cycle |
| Design tokens | Additive only; renaming a token is a breaking change for the design system |

---

## 11. What a new contributor must install

```bash
# Node toolchain
node -v      # 20.x
pnpm -v      # 9.x
pnpm install

# Python toolchain
python -V    # 3.12.x
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r apps/api/requirements-dev.txt

# Database: hosted Supabase (no local app DB). Fill apps/api/.env first.
python -m app.scripts.online_check               # from apps/api
alembic -c apps/api/alembic.ini upgrade head     # uses DIRECT_DATABASE_URL (session pooler :5432)
# Integration tests only: docker compose --profile test up -d test-db && pwsh scripts/test-api.ps1

# Run
pnpm --filter web dev          # http://localhost:5173
uvicorn app.main:app --reload  # run from apps/api, http://localhost:8000
```

Playwright browsers are installed only when working on deep-scan features:
`python -m playwright install chromium`.
