# AGENTS.md (repository root)

Start with [`docs/handover/HANDOVER.md`](docs/handover/HANDOVER.md), then
[`docs/handover/PROGRESS_LOG.md`](docs/handover/PROGRESS_LOG.md), then the rulebook in
[`docs/AGENTS.md`](docs/AGENTS.md) and the index in [`docs/INDEX.md`](docs/INDEX.md).
`docs/` is the source of truth; code and docs change together.

# AGENTS.md — TrustLens

Operating instructions for AI coding agents (and humans who want the short version).

Read this file, then `INDEX.md`, then the owning document for the module you are changing. This file
does not replace the specifications; it tells you how to behave while following them.

---

## 1. What this project is

TrustLens verifies whether a website is **authorised** to ask for credentials, payment or personal
data, investigates connected infrastructure, and shares confirmed findings. The differentiator is
action integrity verification against a verified Organisation Trust Profile.

It is **not** a URL reputation scanner, and the verdict is **not** produced by a language model.

---

## 2. Read before writing

| You are changing | Read first |
| --- | --- |
| An API route, field or status code | `02-architecture/API_CONTRACTS.md`, `03-backend/API_ENDPOINTS.md` |
| A table, column or index | `02-architecture/DATABASE_DESIGN.md` |
| A rule, weight, finding code or threshold | `03-backend/RISK_ENGINE.md` |
| A screen or component | `04-frontend/DESIGN_SYSTEM.md`, `04-frontend/UI_UX_SPECIFICATIONS.md` |
| Extension behaviour | `05-browser-extension/BROWSER_PROTECTION_LOGIC.md` |
| SDK surface | `06-sdk/SDK_SPECIFICATION.md` |
| AI / investigation | `07-ai-intelligence/AI_INVESTIGATION_ENGINE.md` |
| Hosting, env, health | `08-infrastructure/*`, `02-architecture/HOSTED_SERVICES.md` |
| Anything touching URLs, auth or AI input | `09-testing-security/SECURITY_THREAT_MODEL.md` |

---

## 3. Hard rules

1. **Never invent a contract.** No new endpoint, field, enum value, table, finding code or error code
   without it existing in the owning document. If it is missing, stop and report the gap.
2. **The model never decides.** Findings, scores and decisions come from `app/risk`. The LLM writes
   prose only, citing existing finding/evidence IDs.
3. **`ALLOW` is never "safe".** No user-facing string may claim a site is safe, trusted or verified on
   the basis of an `ALLOW` decision. Coverage must accompany every verdict.
4. **Unknown is not a pass.** A failed check is `UNAVAILABLE`/`SKIPPED`, never treated as clean.
5. **Every network call goes through `services/guard.py`.** Including verification-file fetches and
   every redirect hop, with DNS re-resolution.
6. **No secrets in the repo, a bundle, a log or a screenshot.** Supabase `service_role` is server-only
   and used by one job.
7. **No dependency without a reason.** Check `TECH_STACK.md` §8 (rejected list) first. State the reason
   in the PR body.
8. **No weakening tests** to make CI pass. Fix the cause.
9. **Types come from OpenAPI.** Never hand-edit `packages/shared-types`.
10. **Demo data is labelled.** `simulated: true` everywhere it appears, including export filenames.
11. **Don't touch files outside your module.** Shared changes go through the owner.

---

## 4. Module map and boundaries

```text
apps/web          React SPA            owner: frontend
apps/api          FastAPI             owner: backend
apps/api/app/services, app/risk        owner: scanner/security
apps/api/app/agents                    owner: AI
apps/extension    Chrome MV3          owner: extension
packages/sdk      @trustlens/sdk       owner: SDK
packages/shared-types  generated      nobody edits
docs/             specifications       tech lead
```

Allowed import direction: `routes → services → repositories → models`. Never the reverse. A service may
call another service; `agents/` may call `risk/` for reading, never for scoring changes.

---

## 5. Canonical anchors (do not drift)

| Anchor | Value |
| --- | --- |
| API prefix | `/api/v1` |
| IDs | ULID `CHAR(26)` |
| Decisions | `BLOCK \| WARN \| ALLOW \| REVIEW \| UNKNOWN` |
| Risk levels | `CRITICAL \| HIGH \| MEDIUM \| LOW \| UNKNOWN` |
| Signal weights | reputation 30 · identity 25 · credential 20 · payment 15 · infrastructure 10 |
| Base URL env | `VITE_API_BASE_URL` |
| DB | Supabase Postgres, pooler 6543, `statement_cache_size=0` |
| Cache | Upstash Redis (advisory only) |
| Cron | Upstash QStash, signed internal endpoints |
| Human auth | Clerk session JWT via JWKS (`azp`-bound); local `users` row keyed by `clerk_user_id` |
| Machine auth | `tl_live_…` API keys, `tl_ext_…` device tokens |
| Investigation graph | LangGraph `StateGraph`, static topology |
| Demo org | Northstar University, `northstar-demo.example` |

If you must change one, update **every** document that contains it (grep for the value), add an ADR to
`SYSTEM_ARCHITECTURE.md` §11+, and say so in the PR.

---

## 6. Definition of done

- [ ] Types compile (`pnpm typecheck`; `mypy` on touched Python modules).
- [ ] Lint clean (`eslint`, `ruff`).
- [ ] Tests added for the behaviour and passing.
- [ ] Contract test updated if an endpoint changed.
- [ ] Rule test added if a risk rule changed.
- [ ] Owning document updated if a contract changed.
- [ ] No secret, no raw HTML injection, no unbounded network call.
- [ ] Final message lists: files changed, checks run **with results**, what was not verified.

---

## 7. Verification commands

```bash
pnpm lint && pnpm typecheck && pnpm test
(cd apps/api && ruff check . && mypy app && pytest -q)
(cd apps/api && python -m app.scripts.dump_openapi && git diff --exit-code openapi.json)
```

Never report a check you did not run. Never report a failed check as a pass.

---

## 8. Things that have caused real bugs here

| Symptom | Cause | Rule |
| --- | --- | --- |
| Extension shows green on an unchecked page | Cache miss treated as `ALLOW` | Cache miss ⇒ `UNKNOWN` |
| Scan never finishes | Unbounded `gather` | Global 60 s budget, 5 s per probe |
| `prepared statement already exists` | asyncpg + Supabase transaction pooler | `statement_cache_size=0` |
| Frontend breaks on a field rename | Hand-written types | Generate from OpenAPI |
| Demo fails at 0:30 | API asleep | Warm-up, then a static-friendly loading state |
| SSRF via redirect | Guard only on the submitted URL | Guard every hop, re-resolve |
| Rate limits doubled | Two workers, in-process counters | Redis counters with documented fallback |
| Invite emails silently missing | No `RESEND_API_KEY` | Log the link and surface "email not configured" |

---

## 9. When you are unsure

Ask a question in the PR rather than guessing a contract. A blocked PR is cheap; three modules built
against three different assumptions is not.

Do not: add features outside the task, refactor unrelated code, rename documented fields for taste,
introduce a state library, or "improve" the design tokens.
