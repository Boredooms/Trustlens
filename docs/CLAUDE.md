# CLAUDE.md — TrustLens

Project memory for Claude-based coding sessions. `AGENTS.md` is the full rulebook; this file is the
short, opinionated version plus the things that are easy to get wrong.

---

## 1. Orientation in 30 seconds

- **Product:** website trust intelligence. Verify whether a site is *authorised* for a login/payment,
  not merely whether it has HTTPS.
- **Differentiator:** Action Integrity Verification against a verified Organisation Trust Profile.
- **Hard architectural law:** deterministic rules decide; the LLM narrates. Never the reverse.
- **Stack:** React 18 + Vite + Tailwind (Vercel) · FastAPI + Python 3.12 (Render) · Supabase Postgres
  + Auth + Storage · Upstash Redis + QStash · LangGraph for investigations · TypeScript SDK · Chrome
  MV3 extension.
- **Docs are the spec.** `docs/` is authoritative. Code that contradicts it is a bug in one of them.

---

## 2. Before you edit

1. Open `docs/INDEX.md` and the owning document for the area.
2. Grep for the concept before creating anything (`rg "payee" apps/api/app`).
3. Check `docs/09-testing-security/SECURITY_THREAT_MODEL.md` if the change touches URLs, auth, uploads
   or model input.

---

## 3. Non-negotiables

| # | Rule |
| --- | --- |
| 1 | Do not invent endpoints, fields, enums, tables or finding codes. Report the gap instead. |
| 2 | `ALLOW` ≠ safe. Coverage must be shown. No "safe/trusted/verified" copy for `ALLOW`. |
| 3 | Failed checks are `UNAVAILABLE`, never a pass. |
| 4 | Every outbound request passes `services/guard.py`, including redirect hops and file challenges. |
| 5 | The model cannot add findings, change a score, or change a decision. Claims need valid refs. |
| 6 | Never read or store passwords, OTPs, card numbers, cookies or form values. Metadata only. |
| 7 | Secrets only in host env vars. `SUPABASE_SERVICE_ROLE_KEY` serves Storage + one cleanup job; `CLERK_SECRET_KEY` serves delete/revoke only. Neither appears in a request path or the web bundle. |
| 8 | Types are generated from `openapi.json`. Never hand-edit `packages/shared-types`. |
| 9 | Simulated data carries `simulated: true` on every surface, including CSV filenames. |
| 10 | Do not weaken or skip tests, and do not add suppressions to pass CI. |

---

## 4. Conventions that differ from defaults

- **JSON is `snake_case`** end to end (ADR-007). No camelCase mapping layer.
- **Enums are `as const` unions**, not TS `enum`. Unknown response values map to `UNKNOWN`, never throw.
- **No default exports** except lazy route components.
- **No hex colours in components.** Tokens only (`var(--danger)` / `bg-surface`).
- **No Lenis in `/app`.** It fights nested scroll and keyboard behaviour.
- **Redis is advisory.** Never make correctness depend on it.
- **Migrations use `DIRECT_DATABASE_URL`** (5432), not the pooler.
- **asyncpg + Supabase pooler** needs `statement_cache_size=0`, or you will see intermittent
  "prepared statement already exists" errors under load.
- **LangGraph topology is static.** Adding a node is fine; letting the model choose tools is not.

---

## 5. Where things live

```text
apps/api/app/risk/          scoring, rules, policy  ← verdict truth
apps/api/app/services/      probes, verification, orchestration
apps/api/app/agents/        LangGraph graph, narrator, template fallback
apps/api/app/intelligence/  graph traversal, correlation, campaigns
apps/web/src/components/domain/  VerdictBadge, CoverageMeter, FindingRow, GraphCanvas
packages/shared-types/      generated; do not edit
docs/skills/                design + frontend craft skills (read before UI work)
```

---

## 6. Commands

```bash
pnpm install
docker compose up -d db redis
(cd apps/api && alembic upgrade head && uvicorn app.main:app --reload)

pnpm lint && pnpm typecheck && pnpm test
(cd apps/api && ruff check . && mypy app/services app/risk && pytest -q)
(cd apps/api && python -m app.scripts.dump_openapi)
```

Demo data: `python -m app.scripts.seed_demo` (idempotent, refuses production without
`ALLOW_DEMO_SEED=1`).

---

## 7. UI work

Before writing components, read `docs/skills/impeccable-frontend/SKILL.md` and
`docs/skills/design-system-guardrails/SKILL.md`. They encode the visual standard: monochrome editorial
layout, fine borders, no gradients or glassmorphism, semantic colour only for security states, and the
five-state rule (loading, empty, error, populated, degraded) for every list.

If a design decision is not covered by the design system, prefer restraint and ask — do not invent a
new visual language.

---

## 8. Answering style in this repo

- Report what you changed, the checks you ran **with their results**, and what you could not verify.
- Never claim a UI "looks right" if you did not view it; say it was not viewed.
- Quote `requestId` when discussing a server error.
- When you find a documentation/implementation conflict, say which one you followed and why.

---

## 9. Known traps

1. Cold start on Render mid-demo → warm up; keep the frontend static-friendly.
2. Supabase free project paused → weekly keep-alive job; wake manually before a demo.
3. Redis outage → limits approximate, cache missed; never 500 because of it.
4. QStash signatures → internal job endpoints must verify, and are not in public OpenAPI.
5. `service_role` in a request path → security incident by definition; the startup check enforces it.
6. Extension cache > 10 min → render `UNKNOWN`, never a stale green.
7. Prompt injection in page text → decision must not change; fixtures assert it.
