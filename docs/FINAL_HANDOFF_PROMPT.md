# Final stage brief: TrustLens (handoff)

Use this as the last-stage prompt for the next agent or person. It states what exists, what does not, and what to
do next. Facts below were checked on 2026-11-09 unless marked **unverified**.

## 1. State left behind

- **Repo:** monorepo (`apps/api`, `apps/web`, `apps/extension`, `apps/demo-sites`, `packages/{contracts,sdk,shared-types}`, `docs/`).
- **Runs locally** against the hosted Supabase DB (migrated to `c7a0note0001`, 34 tables, RLS audit clean), Clerk, Upstash Redis, QStash and the NVIDIA LLM.
- **Deployed:** four Vercel projects serving labelled, inert fixtures (genuine `trustlens-demo-northstar`, lookalikes `-admissions`, `-scholarships`, `-placement`, all `*.vercel.app`).
- **Deployable, not deployed:** API (Render Docker, image builds), dashboard (Vercel static).
- **Not done:** public testnet contract, npm publish, Chrome Web Store, production Clerk instance.

## 2. Stack decisions

| Area | Decision | Why |
| --- | --- | --- |
| Motion | `motion` (one library) | single grammar, reduced-motion respected |
| Charts | Bklit UI, vendored in `components/charts` | one chart lib; Recharts rejected even though the app-1 block uses it |
| CSS | Tailwind **v3** + tokens in `styles/tokens.css`; no raw hex elsewhere (`check-tokens.mjs`) | a v4 jump would break the Vercel build |
| Primitives | Radix + lowercase shadcn parts; Button/Card shadcn APIs exported from `Button.tsx`/`Card.tsx` | Windows case-insensitivity collisions |
| Type | Instrument Serif display + Geist body | premium pairing, two families only |
| Shell | app-1 sidebar, `SidebarInset` is the scroller, demo banner fixed, sign-out in the sidebar footer | banner no longer scrolls away |
| Verdict | Only `apps/api/app/risk`. UI, agents, charts, notes never decide | product rule |
| Notes | Server-persisted, owner-only RLS, closed block model, no HTML | analyst workflow without XSS surface |

## 3. Routing and deployment

- **API:** `infrastructure/render.yaml` (Docker, `dockerContext ./apps/api`). `GET /health` liveness, `GET /ready` checks DB (no values returned). Migrations are a release step (`release.yml`, `alembic upgrade head` with `DIRECT_DATABASE_URL`). `ALLOWED_ORIGINS` must list the dashboard origin.
- **Dashboard:** `apps/web/vercel.json` (SPA rewrite, security headers). Build vars: `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY` (public key only). Deep links resolve through the rewrite.
- **Extension:** host permissions are baked at build from `VITE_API_BASE_URL`, `VITE_WEB_BASE_URL`, `VITE_DEMO_SITES_ORIGIN`. Rebuild for the production API before any store submission. `releases/trustlens-extension-local.zip` targets localhost.
- **Fixtures:** `pnpm --filter @trustlens/demo-sites build:vercel`, then `vercel deploy --prod --yes` inside each `apps/demo-sites/dist/<project>`.

## 4. Check gating that exists

`.github/workflows/ci.yml`: secret scan (tracked files), `pnpm typecheck/lint/test/build` with a lockfile install, extension bundle check, API `ruff check`, `ruff format --check`, `mypy app`, `alembic upgrade head` and `pytest` on a Postgres 16 service, OpenAPI drift (`git diff --exit-code openapi.json`). `release.yml` is manual (migrate, Render hook, extension zip). `ci.yml` is **green on GitHub** (run 42629140843, commit `ebec472`: secret scan, JS, API with Postgres all success). `release.yml` has not been run.

Local results: API 410 passed; web 106 tests; typecheck/lint clean; extension E2E 16/16 and 10/10 against live lookalikes; `docker build` of the API succeeds (**container not booted with real env**).

## 5. Deliverable status

| # | Deliverable | Status |
| --- | --- | --- |
| 1 | Prototype | Works locally; no public dashboard URL until the API is hosted |
| 2 | Public repo | Pushed to `github.com/Boredooms/Trustlens` (`main`), CI green |
| 3 | AI demo | Message analysis + cited narratives |
| 4 | Cyber demo + TLS | Live lookalikes blocked at the action; cert posture separates misconfig from trust compromise |
| 5, 6 | Web3 + evidence | Local deterministic chain, replay and verify scripts, anchors in hosted DB; no testnet |
| 7, 8 | Docs, testing report | Present (`docs/`, `docs/evidence/TESTING_REPORT.md`) |
| 9 | Live demo | Fixtures live; end-to-end needs the hosted API |

## 6. Security posture

No secrets in tracked files (staged scan clean; one **fake** webhook fixture string remains in two old commits of `test_hardening.py`, now split in HEAD). `.env*` ignored. The Supabase service key is server-only. Fixtures are inert (CSP `form-action 'none'`, JS cancels submits, `.example` form targets, `noindex`). **Credentials pasted into chat (NVIDIA, Supabase, Clerk, QStash, Upstash, npm) must be rotated.** Hosting phishing-style pages can trigger Safe Browsing or Vercel abuse review; keep the banners.

## 7. Gaps

| Gap | Owner | Next action |
| --- | --- | --- |
| API not deployed | repo owner | `render login`, create the service from `render.yaml`, set env names from `ENVIRONMENT_CONFIGURATION.md`, set `ALLOWED_ORIGINS` |
| Dashboard not deployed | after API | `vercel deploy --prod` in `apps/web` with `VITE_API_BASE_URL` set |
| Production Clerk instance | repo owner | create it, add its issuer/JWKS/azp to the API env |
| `release.yml` never run | repo owner | add `DIRECT_DATABASE_URL`, `RENDER_DEPLOY_HOOK` secrets, then dispatch it |
| SDK unpublished | repo owner | decide the npm scope (token authenticates as `boredooms`, not an org named `trustlens`); rename e.g. `@boredooms/trustlens-sdk`, remove `private`, `npm publish --access public` |
| Public testnet | repo owner | provide a funded key and RPC; deploy `ThreatReportRegistry`; set `CHAIN_*` |
| Extension store listing | repo owner | rebuild against the production API, then submit |
| New pages not screenshot-reviewed | frontend | run `shots.mjs` and review |

## 8. Questions

- Answered: chart library (Bklit), CSS stack (Tailwind v3), fixtures on Vercel only, logout in the sidebar.
- Open: Render account/login; npm package name and scope; whether to deploy to a testnet.
