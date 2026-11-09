# TrustLens — Progress Log

> Chronological record of how the codebase was built (2026-11-08), so the git history that was
> removed at handover is not lost. Times are IST. Companion to [`HANDOVER.md`](HANDOVER.md).

## 1. Former commit history (removed at handover)

| Time | Change |
| --- | --- |
| 11:56 | docs: import TrustLens specification (36 core docs + index) |
| 12:29 | feat(api): skeleton, contracts, schema, risk engine, scanner, demo seed |
| 12:47 | docs: reconcile spec with implementation (ADR-016/017, risk-engine notes, error codes, runbook) |
| 12:47 | feat(web): dashboard with demo screens, verdict components, dev sign-in |
| 12:57 | feat(extension, sdk): MV3 extension, typed SDK, inert demo sites, deploy configs |
| 13:06 | feat(api): HTTP API for the demo path, LangGraph investigations, security test suites |
| 15:09 | Hosted wiring: batched graph writes, NIM-ready narrator, `set_role` |
| 16:26 | Fill Clerk user email/name once from the Backend API |
| 18:28 | extension: pairing copy points at Developers → Browser extension |
| 18:44 | Fix stale checkpointer connections; web tests no longer read `.env.local` |
| 19:43 | Production features: governance, appeals, platform jobs, RLS, web screens |
| 19:49 | Risk context ignores lapsed domain verifications |
| 20:28 | Account deletion, Clerk webhooks, login-hosts enforcement, DNS-rebinding guard, UI completion |
| 21:15 | Clerk re-verification for account deletion, operator demo controls |

## 2. Phases

**Phase 0–1 (demo build).** Monorepo, FastAPI skeleton, 24-table schema, risk engine (weights rep 30
/ identity 25 / credential 20 / payment 15 / infra 10; overrides O-1…O-7 raise only; coverage gates;
critical floor), SSRF guard, collectors with recorded demo fixtures (ADR-016), dev sign-in (ADR-017),
threat graph + campaigns, report confirmation propagation, LangGraph investigations with template
narrator, web dashboard, MV3 extension, SDK, demo sites. Demo rehearsal script `demo_check` (26).

**Hosted wiring.** Supabase (moved from Tokyo to Singapore for latency), Clerk (Google sign-in),
NVIDIA NIM, Upstash credentials. Batched graph upserts (48 → 27 statements per assess).

**Production completion.** Every endpoint in `API_ENDPOINTS.md` plus: org create/edit/publish,
domain verification (DNS TXT + HTTPS file), recipients delete, members + invites + last-admin gate,
audit log, Resend email, appeals with domain challenge, certificate detail + monitors,
inspect-redirect, usage metering, QStash-signed internal jobs, Upstash rate limiting, optional
Playwright deep scan, Postgres RLS, account deletion (+ Clerk re-verification), Clerk webhooks
(Svix), `explicit_only` login hosts, logo pHash, DNS-rebinding peer check, operator demo controls,
public info pages. E2E script `platform_check` (42).

## 3. Decisions made during the build (and where they are recorded)

| Decision | Why | Recorded in |
| --- | --- | --- |
| Demo hosts use recorded collector fixtures, labelled `simulated` | Reproducible demo without real infrastructure | SYSTEM_ARCHITECTURE ADR-016 |
| Dev sign-in `Bearer dev:<email>:<role>`, refused in production | Local work without Clerk | ADR-017, AUTHENTICATION_AUTHORIZATION |
| Worked example is HIGH (62) not CRITICAL; O-2 forces BLOCK | Owning doc (RISK_ENGINE) wins over runbook | RISK_ENGINE §7.6a, DEMO_RUNBOOK |
| UPI handle regex allows hyphens | `fees@northstar-demo` must validate | API_CONTRACTS §13 |
| Pairing errors `INVALID_PAIRING_CODE` 401 / `PAIRING_CODE_EXPIRED` 410 | Extension needs distinct copy | API_CONTRACTS §7 |
| `LLM_EXTRA_BODY` setting | Provider-specific flags (NIM thinking off) without code changes | ENVIRONMENT_CONFIGURATION |
| Domain-challenge responses not stored for idempotent replay | They contain a one-time token | API_CONTRACTS §9 |
| Invite accept endpoint `POST /invites/{token}/accept` (#64) | Docs defined none | API_ENDPOINTS |
| Account deletion anonymises the user row instead of deleting it | Audit FKs survive; NFR-032 | API_ENDPOINTS #65, AUTHENTICATION_AUTHORIZATION |
| Re-verification via Clerk `fva` claim (≤10 min) | JWT `iat` is refreshed every ~60 s, so it proves nothing | AUTHENTICATION_AUTHORIZATION |
| Logo pHash computed in the browser; no upload endpoint | No file storage needed | ORGANISATION_TRUST_PROFILES |
| RLS deny-all for Supabase `anon`/`authenticated`; API as owner | Defence in depth without breaking the API | DATABASE_DESIGN |
| `retention` internal job added | Data-retention sweep | BACKEND_OVERVIEW |

## 4. Bugs found and fixed (regression-relevant)

- Body-size overflow returned a generic 400 → buffered size limit middleware (413 `PAYLOAD_TOO_LARGE`).
- psycopg pool `min_size` > `max_size`; Proactor loop `PoolTimeout` → `app/serve.py` selector loop.
- Startup blocked ~30 s with DB down → bounded checkpointer connect, background maintenance.
- Alembic ignored `.env` → `load_dotenv` in `alembic/env.py`.
- 25 single-row graph upserts per scan → two multi-row upserts.
- NIM model retired (410); reasoning model returned empty content → model switch + thinking off +
  clean failure path.
- Investigations failed after idle (Supavisor dropped connections) → `check_connection` on the pool.
- Web tests loaded the real Clerk key from `.env.local` → test env override.
- Scan DNS timed out under the Windows selector loop → threaded resolver.
- Shutdown logged "Task was destroyed" → lifespan awaits cancelled tasks.
- Expired domain verifications still vouched for a domain → expiry filter in risk context.
- Flaky 5 s web test timeouts under parallel runs → 20 s.

## 6. 2026-11-09 — problem-statement build (BUILD_PROMPT.md workstreams A–E)

| Commit | Change |
| --- | --- |
| `chore: import existing tree` | First git history; secret scan of the tracked tree |
| `fix: baseline on Node 24 / Python 3.12` | venv rebuilt (3.12.10); vitest AbortSignal shim for Node 24 undici; mypy override for the optional playwright extra |
| `feat(web3)` | `ThreatReportRegistry` (Solidity 0.8.24, Hardhat), anchor/verify API (#68–#71), `report_anchors`, on-chain proof panel, public `/verify/:id`, independent CLI verifier, offline replay (ADR-018) |
| `feat(messages)` | Deterministic message/scam analysis (#72), `R-MSG-*`, policy O-8…O-10, `risk_class`, `message_analyses`, `/app/messages`, engine 1.1.0 |
| `feat(intel,certs)` | URLhaus feed (live/fixture/off, Postgres cache), `LISTED_BY_EXTERNAL_FEED` (O-6), certificate depth `R-INF-16…20` + OCSP, certificate report, unscored header posture `R-HDR-*` |
| `fix: NAT64 guard, certifi roots, …` | Defects found by the evidence run against real sites (below) |
| `docs: …` | README, LICENSE, extension README, owning docs, evidence bundle, drift rows closed |

Bugs found by running real targets, each with a regression test:

- **NAT64 refused every IPv4-only site** on DNS64 networks (github.com, paypal.com → `TARGET_NOT_ALLOWED`):
  `64:ff9b::/96` is now judged by its embedded IPv4 (`64:ff9b::a00:1` is still refused as 10.0.0.1).
- **Valid public chains looked untrusted on Windows** (example.com): TLS now verifies against certifi's
  Mozilla roots instead of the OS store.
- **Let's Encrypt certificates had no revocation answer** (OCSP retired in 2025): CRL fallback, accepted only
  when signed by the issuer and current.
- **A self-signed certificate alone banded to `ALLOW`** (score 7): TLS trust floor §8.5a → `REVIEW`.
- **A non-resolving lookalike banded to `ALLOW`** (score 24; O-7 unreachable because `DOMAIN_NXDOMAIN`
  counted as "another finding"): O-7 fixed and §8.5b (an unreached target is never `ALLOW`).
- **Fixture intel answered "not listed" for real hosts**: fixture mode now covers demo hosts only; other
  hosts are not consulted.

Verification record (2026-11-09, local Docker Postgres, local Hardhat node): API **401 passed** (incl. DB
integration, 0 skipped) · ruff/format/mypy strict clean (100 files) · web **78** · extension **54** · SDK
**21** · demo-sites **15** · contracts **9** · all builds pass · `demo_check` **26/26** · `platform_check`
**42/42** · `evidence_run --network` **17/17** · `chain_evidence` original valid / tampered invalid ·
independent `verify-report` matched the chain. Not done: hosted deployment, browser viewing of the UI,
manual extension load.

Process note: during the session one API process inherited `DATABASE_URL` for `trustlens_test` from a
shell used for integration tests, so an intermediate e2e run used the test database. It was caught
(an anchor written by a CLI script was not visible to the API), the API was restarted with the variable
cleared, and every number above was re-measured against the dev database. Keep `TEST_DATABASE_URL`
runs in their own shell.

## 5. Verification record at handover

API 300 tests (incl. DB integration) · ruff/format/mypy strict clean · web 66 · extension 54 · sdk 20 ·
demo-sites 15 · all builds pass · against hosted Supabase: `demo_check` 26/26, `platform_check` 42/42.

## 6. Fully online (2026-11-09, evening)

- Development now runs against the owner's hosted Supabase (DB only), Clerk (only identity
  provider), Upstash Redis and QStash, and the NVIDIA LLM. The local Postgres container and volume
  were removed; `docker-compose.yml` keeps only `test-db` (profile `test`, :5433) and an optional
  `api` service. Production refuses a local `DATABASE_URL`.
- Clerk redirect bug, reproduced in Chrome: the "Sign up" link went to the hosted Account Portal with
  `__clerk_db_jwt` in the URL and never returned to `/app`. Fixed with `CLERK_ROUTES` on
  `ClerkProvider` (`AUTHENTICATION_AUTHORIZATION.md` §2.1).
- `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (old name still accepted); `QSTASH_URL`,
  `QSTASH_TOKEN`, `DB_CONNECT_TIMEOUT_SECONDS` documented. `SUPABASE_JWKS_URL` and `VITE_SUPABASE_*`
  deliberately not wired.
- Migration `c6a0rls00001` (RLS on `alembic_version`). New scripts: `online_check`, `rls_audit`,
  `scripts/test-api.ps1`, `scripts/secret-scan.ps1`. httpx/httpcore logging lowered to WARNING (they
  logged Clerk user ids in URLs). Startup log records DB host and source, never the URL.
- Old env files from the previous owner moved out of the repo.
- Technical rail no longer repeats certificate/security-posture/intel blocks as raw JSON.

Verification record: API **403 passed** against the isolated test DB · ruff/format/mypy clean (102
files) · web **80** · extension **54** · SDK **21** · all builds pass · OpenAPI unchanged · hosted:
`demo_check` 26/26, `platform_check` 42/42, `evidence_run --network` 17/17, QStash signature checks
pass, Clerk sign-in → `/app` seen in Chrome. Details: [`../evidence/online/README.md`](../evidence/online/README.md).

## 7. Dashboard redesign, extension on real sites, AI/SDK verified (2026-11-09, late)

- Git history: all commits re-authored to `Boredooms <devarghochakraborty7@gmail.com>` (dates kept,
  trees identical; backup tag `backup/pre-author-rewrite-2026-11-09`).
- Dashboard: app-1 shell (fixed banner/header, collapsible sidebar, sign-out in the sidebar), shadcn
  parts, Instrument Serif display pairing, mesh tokens, Bklit charts on real scan data, Motion grammar,
  rebuilt Overview and Settings (Clerk card themed from tokens — dark-mode white card fixed), scan list
  filters (`?decision=`, `?q=`), agent layer (`lib/agents`: linked-context orbits, citation-checked
  explanations, action proposals, request-id trace).
- Extension: content script on every http(s) page; one-click connect via the dashboard bridge;
  popup rebuilt (live checking state, score ring, findings, Full report, Explain with AI); local /
  private / own-site pages are neutral. Verified in real Chromium: 16/16 (google.com, github.com,
  paypal.com, example.com checked by the server; token never exposed to the page).
- API: `/assess` reuses the caller's own browse decision for 10 min (`cached: true`); DB pool
  pre-ping removed (per-request overhead ~4.2 s → ~1.9 s from this machine).
- AI: NVIDIA key rotated in `apps/api/.env`; investigation on a real scan: model-generated
  (nemotron-3-ultra-550b-a55b), 9 claims, 0 dangling references, decision unchanged.
- SDK + API keys against the live API: 8/8 (assess real sites, verifyIdentity, scan wait, usage
  12 → 16, revoke → `AuthenticationError`).

Verification: API 406 passed (test DB) · ruff/format/mypy clean · web 19 files · extension 5 files ·
SDK pass · all typechecks/lints pass · OpenAPI unchanged. Not done: deployment (needs the owner's
Render/Vercel/GitHub access), production Clerk instance, Chrome Web Store packaging.
