# DEVELOPMENT_GUIDELINES

> **Status:** DECIDED · **Group:** 00-project-foundation · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** coding conventions, repository layout, git workflow, review expectations, module ownership, AI-agent rules.
> **Related:** [`TECH_STACK.md`](TECH_STACK.md) · [`../02-architecture/API_CONTRACTS.md`](../02-architecture/API_CONTRACTS.md) · [`../09-testing-security/TESTING_STRATEGY.md`](../09-testing-security/TESTING_STRATEGY.md)

---

## 1. Repository layout and ownership

```text
trustlens/
├── apps/
│   ├── web/          React SPA (public site + dashboard)
│   ├── api/          FastAPI backend (the only verdict producer)
│   └── extension/    Chrome MV3 extension
├── packages/
│   ├── sdk/          @trustlens/sdk
│   ├── shared-types/ generated from apps/api/openapi.json — never hand-edited
│   └── ui/           thin shared primitives (optional)
├── infrastructure/   render.yaml, docker-compose.yml, deploy scripts
├── docs/             this documentation system — source of truth
└── .github/          workflows, PR template, issue templates
```

| Area | Owner | May change without review from others |
| --- | --- | --- |
| `docs/**` | Tech lead | Structure, wording |
| `apps/api/app/services/**`, `risk/**` | Backend/scanner owner | Internal refactors |
| `apps/api/app/api/**`, `schemas/**` | Backend owner | Only additive changes; contract changes need the API owner |
| `apps/web/**` | Frontend owner | Components, routes within agreed specs |
| `apps/extension/**` | Extension owner | Internal modules |
| `packages/sdk/**` | SDK owner | Internal modules |
| `packages/shared-types/**` | Generated | **Nobody** — regenerate, never edit |
| `infrastructure/**`, `.github/**` | DevOps owner | With a note in the PR |

Boundary rule: **one module owner approves changes to that module's public surface.** Public
surface means exported functions, API routes, schemas, and anything another module imports.

---

## 2. Non-negotiable rules

These are the rules that keep a four-person team from producing four incompatible products.

1. **No client invents a response shape.** Types come from `packages/shared-types`, generated from
   the API's OpenAPI document. If a field is missing, change the API and regenerate.
2. **No hardcoded colours, spacing or radii in components.** Use design tokens
   (`../04-frontend/DESIGN_SYSTEM.md`).
3. **No AI-generated verdicts.** The model explains structured findings; it never creates, scores
   or overrides them (`../03-backend/RISK_ENGINE.md` §2).
4. **Every finding carries a source and a timestamp.** A finding without evidence is a bug.
5. **Unknown is not safe.** Missing data must map to `UNAVAILABLE`/`SKIPPED` coverage, never to a
   passing rule.
6. **No deployment without working `/health` and `/ready`.**
7. **No secrets in the repo, bundle, extension or logs.** `.env` is gitignored; `.env.example`
   documents names only.
8. **No scanning of private address space, localhost, cloud metadata or third-party sites on
   request.** The SSRF guard runs before every network call, on every redirect hop.
9. **Active security testing is out of scope.** Passive analysis only.
10. **Never store passwords, OTPs, card numbers or session cookies.** Record destinations, not secrets.
11. **Every documented contract change updates the owning document in the same PR.**
12. **Every feature has a demo fallback** if it depends on the network, an LLM or an external feed.

---

## 3. TypeScript conventions

| Rule | Detail |
| --- | --- |
| Strictness | `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` |
| No `any` | Use `unknown` + narrowing; `any` requires a `// eslint-disable-next-line` with a reason |
| Exports | Named exports only; no default exports except route components required by lazy loading |
| Types vs interfaces | `type` for unions/aliases, `interface` for object shapes that may be extended |
| Enums | `as const` objects + union types, never TS `enum` (bad interop with generated types) |
| Files | `kebab-case.ts` for modules, `PascalCase.tsx` for components |
| Components | One component per file; props interface named `<Component>Props`; no barrel files inside feature folders |
| Hooks | `use-<thing>.ts`, return objects (not tuples) beyond two values |
| Async | `async/await` only; no floating promises (`@typescript-eslint/no-floating-promises` is an error) |
| Errors | Throw `Error` subclasses; never throw strings; never swallow a caught error without logging a code |
| Dates | ISO-8601 strings over the wire; `Date` only inside the UI layer |
| Money/amounts | Never use floats for currency; demo uses integer minor units |
| Imports | Absolute alias `@/` for `src/`, workspace packages by name |
| Comments | Explain *why*; the *what* should be readable from names |

Lint/format: ESLint (`@typescript-eslint`, `react-hooks`, `jsx-a11y`) + Prettier. CI fails on any
warning in `apps/web`, `apps/extension`, `packages/*`.

---

## 4. Python conventions

| Rule | Detail |
| --- | --- |
| Version | 3.12, modern typing (`list[str]`, `str | None`) |
| Style | Ruff format + Ruff lint (`E,F,I,B,UP,S`), line length 100 |
| Modules | `snake_case.py`; one responsibility per module; services never import routers |
| Types | Full annotations on public functions; `mypy` in CI for `app/services` and `app/risk` |
| Pydantic | v2 `BaseModel`, `model_config = ConfigDict(extra="forbid")` on requests |
| DB | SQLAlchemy 2 typed `Mapped[...]` models; no raw string SQL except reviewed CTE queries |
| Errors | Raise domain exceptions (`ScanRejected`, `SSRFBlocked`, `RateLimited`); routers translate to HTTP |
| Async | Never block the event loop; CPU work via `asyncio.to_thread` under a semaphore |
| Time | `datetime.now(timezone.utc)`; store `TIMESTAMPTZ`; never naive datetimes |
| Logging | `structlog`-style key/value; include `request_id`, `scan_id`; never log secrets or full page bodies |
| Tests | `pytest` + `pytest-asyncio`; ASGI transport, no real network in unit tests |

---

## 5. API conventions

Full contract: `../02-architecture/API_CONTRACTS.md`. Summary of the rules that bite:

- Prefix `/api/v1`. Health endpoints live outside the version prefix *and* are mirrored inside it.
- Resource IDs are ULIDs (26 chars). Never expose database sequence numbers.
- Enums are `UPPER_SNAKE_CASE` strings; unknown enum values must be rejected, not defaulted.
- Errors use one envelope: `{"error": {"code", "message", "requestId", "details?"}}`.
- Lists use `{"data": [...], "page": {"nextCursor": "..." | null, "limit": n}}`.
- Timestamps are ISO-8601 UTC with `Z`.
- Every response carries `X-Request-Id`; clients log it and quote it in bug reports.
- Mutating endpoints accept `Idempotency-Key`; duplicate keys within 24 h return the original result.
- Field naming is `snake_case` in JSON (matches Python and Postgres; the TS SDK exposes the same
  names — no camelCase translation layer, so there is exactly one spelling of every field).

---

## 6. Git workflow

### 6.1 Branches

```text
main        ← always demo-able; tags mark demo builds
develop     ← integration branch
feature/<slug>        e.g. feature/action-integrity
fix/<slug>            e.g. fix/ssrf-redirect-hop
docs/<slug>           e.g. docs/risk-engine-weights
```

`main` is protected: no direct pushes, one approving review, CI green, branch up to date.

### 6.2 Commits

Conventional Commits, imperative mood, ≤ 72 char subject:

```text
feat(api): add payment recipient verification endpoint
fix(scanner): reject redirects into link-local address space
docs(risk): document coverage gating for UNAVAILABLE signals
test(extension): cover fail-open path on API timeout
chore(ci): cache pnpm store between jobs
```

Scopes: `api`, `scanner`, `web`, `extension`, `sdk`, `types`, `docs`, `infra`, `ci`.

### 6.3 Pull requests

Template requires: what changed, why, which `TL-*` feature, which docs updated, how it was tested,
screenshots for UI, and a rollback note for anything touching deployment or the risk engine.

Review expectations:

- ≤ 400 changed lines preferred; larger PRs must explain why they cannot be split.
- Reviewer checks the *contract*, not only the code: does this match `API_ENDPOINTS.md`?
- A PR that changes a verdict, a threshold, or a finding code requires review from the risk owner
  and a test that pins the new behaviour.

### 6.4 Merging

Squash-merge into `develop`. Release = merge `develop` → `main` + tag `v0.x.y`. Demo builds are
tagged `demo-YYYY-MM-DD`.

---

## 7. Testing expectations

| Change | Minimum tests |
| --- | --- |
| New endpoint | Contract test (schema + status codes) + one auth-failure test |
| New risk rule | Unit test with a positive and a negative fixture; rule ID asserted |
| SSRF/validation change | Test for every blocked address class in `SECURITY_THREAT_MODEL.md` §4 |
| New UI screen | Component test for empty/loading/error states; visual check by the author |
| Extension logic | Unit test of the decision function (pure), plus one integration with a mocked API |
| SDK surface | Type-level test + runtime test with a mocked `fetch` |
| Migration | Forward migration on a copy of the schema + downgrade check |

Tests that require the network are marked `@pytest.mark.network` / `test.skipIf(!process.env.E2E)`
and never run in the default CI job. See `../09-testing-security/TESTING_STRATEGY.md`.

---

## 8. Documentation update rule

When code changes any of the following, the owning document changes in the same PR:

| Change | Document |
| --- | --- |
| Endpoint, field, status code | `02-architecture/API_CONTRACTS.md` and/or `03-backend/API_ENDPOINTS.md` |
| Table, column, index | `02-architecture/DATABASE_DESIGN.md` |
| Rule, weight, finding code, threshold | `03-backend/RISK_ENGINE.md` |
| Env var | `08-infrastructure/ENVIRONMENT_CONFIGURATION.md` |
| Colour, spacing, component API | `04-frontend/DESIGN_SYSTEM.md` |
| Extension permission | `05-browser-extension/EXTENSION_ARCHITECTURE.md` |
| SDK method or error | `06-sdk/SDK_SPECIFICATION.md` |
| Security control | `09-testing-security/SECURITY_THREAT_MODEL.md` §12 status table |
| Demo step or seed data | `10-hackathon-demo/DEMO_RUNBOOK.md` |

CI includes a documentation-drift check: if `apps/api/openapi.json` changes without a change under
`docs/`, the job fails with a pointer to this table.

---

## 9. Local workflow

```bash
pnpm install
# apps/api/.env points at hosted Supabase (DB only), Clerk, Upstash; there is no local app DB
(cd apps/api && python -m app.scripts.online_check && alembic upgrade head)
pwsh scripts/dev-up.ps1   # or bash scripts/dev-up.sh: API + web + demo sites

# checks (identical to CI)
pnpm lint && pnpm typecheck && pnpm test
docker compose --profile test up -d test-db   # isolated test DB :5433, once
(cd apps/api && ruff check . && mypy app/services app/risk)
pwsh scripts/test-api.ps1                     # pytest against the test DB only
```

Seeding the demo dataset:

```bash
(cd apps/api && python -m app.scripts.seed_demo)
```

The seed script is idempotent: it upserts Northstar University, its verified domains and
recipients, the three lookalike sites, their shared infrastructure, and the simulated CA incident.
It refuses to run when `ENVIRONMENT=production` unless `ALLOW_DEMO_SEED=1`.

---

## 10. Instructions for AI coding agents

Read this section before touching the repository.

### 10.1 Before writing code

1. Read `INDEX.md`, then the owning document for the module you are changing.
2. Read `API_CONTRACTS.md` and the relevant section of `API_ENDPOINTS.md`.
3. Search for existing implementations before creating new ones (`rg` for the concept, not the name).
4. Check `../09-testing-security/SECURITY_THREAT_MODEL.md` if the change touches networking,
   auth, uploads, or the risk engine.

### 10.2 Hard constraints

- Do not invent endpoints, fields, enums, table names or finding codes. If something is missing,
  stop and report the gap; do not guess a contract.
- Do not add a dependency without checking `TECH_STACK.md` §8 (rejected list) and stating why.
- Do not weaken tests, skip tests, or add lint/type suppressions to make CI pass.
- Do not modify `packages/shared-types` by hand; regenerate it.
- Do not remove or rename documented behaviour; deprecate and document instead.
- Do not write outside your assigned module's directory.
- Do not put secrets, tokens or real user data into fixtures, docs or screenshots.
- Do not present simulated data as real (the CA incident must carry `simulated: true`).

### 10.3 Definition of done for an agent task

- Code compiles (`pnpm typecheck`, `mypy` on touched modules).
- Tests for the new behaviour exist and pass.
- The relevant document is updated if a contract changed.
- The final message lists: files changed, checks run with their results, and anything not verified.

### 10.4 Things that have burned us before

| Symptom | Cause | Rule |
| --- | --- | --- |
| Extension shows "Safe" for an unscanned page | Cache miss treated as `ALLOW` | Cache miss → `UNKNOWN`, never `ALLOW` |
| Scan takes 90 s and the request is killed | Unbounded `asyncio.gather` | Global scan budget 60 s, per-probe 5 s |
| Frontend breaks after a backend field rename | Hand-written response types | Types come from OpenAPI |
| Demo fails because the API is asleep | No warm-up | Run `DEMO_RUNBOOK.md` §7 warm-up |
| SSRF guard bypassed by a redirect | Guard only checked the submitted URL | Check every hop, re-resolve DNS |

---

## 11. Security practices for everyday work

- Enable 2FA on GitHub and the hosting provider.
- Never paste production credentials into an issue, chat or commit.
- Treat every submitted URL and every rendered page as hostile input.
- Use `pnpm audit` / `pip-audit` results in review; do not auto-merge dependency bumps that touch
  crypto, HTTP clients or parsing libraries.
- When logging, prefer identifiers over content: `scan_id`, `entity_id`, `finding_code` — never the
  full HTML, form values, or headers containing cookies.
- Report a suspected secret leak by rotating the secret first, then cleaning history.
