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

## 5. Verification record at handover

API 300 tests (incl. DB integration) · ruff/format/mypy strict clean · web 66 · extension 54 · sdk 20 ·
demo-sites 15 · all builds pass · against hosted Supabase: `demo_check` 26/26, `platform_check` 42/42.
