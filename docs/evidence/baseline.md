# Baseline — measured 2026-11-09 before any feature work

All numbers below were observed from commands run on this machine. Nothing here is copied from
earlier documentation.

## Toolchain

| Item | Observed |
| --- | --- |
| OS | Windows (pwsh) |
| Node | v24.14.0 |
| pnpm | 9.15.9 |
| Python (system) | 3.14.2 — not used for the API |
| Python (API venv) | 3.12.10, installed with `winget install Python.Python.3.12` |
| Docker | 29.8.0, Desktop started manually; `postgres:16-alpine` healthy on :5432 |
| Git | initialised; first commit `chore: import existing tree` |

## Bring-up

| Step | Result |
| --- | --- |
| `apps/api/.venv` | Was broken (pointed at a removed Python 3.13). Deleted and rebuilt with 3.12; `pip install -r requirements-dev.txt` succeeded |
| `apps/api/.env` | Pointed at the previous owner's hosted Supabase. Backed up (git-ignored) and replaced by the local Docker profile (`.env.docker-local`, `ALLOW_DEMO_SEED=true`) so reset/seed never touch someone else's database |
| `alembic upgrade head` | OK on local DB (head `c2a0plat0001`) |
| `seed_demo` | OK — 4 scans: lookalike payment BLOCK 62 (O-2), scholarship BLOCK 42 (O-2), placement BLOCK 39 (O-4), genuine payment ALLOW 0 |
| API `python -m app.serve` :8000 | `/health` 200, `/ready` 200 (DB 55 ms), `/api/v1/health` 200 |
| Demo sites `node apps/demo-sites/server.mjs` :8081 | 200 |
| Web `pnpm --filter @trustlens/web dev` :5173 | First failed: `ERR_MODULE_NOT_FOUND esbuild` (node_modules copied from another machine). Fixed by `CI=true pnpm install --frozen-lockfile` (pnpm otherwise waits on an interactive prompt) |

## Checks

| Check | Result |
| --- | --- |
| `ruff check .` | clean |
| `ruff format --check .` | 109 files formatted |
| `mypy app` | **2 errors** — `playwright` (optional deep-scan extra) not installed. Fixed by adding `playwright.*` to the existing `ignore_missing_imports` override; now clean (86 files) |
| `pytest -q` with `TEST_DATABASE_URL` (migrated `trustlens_test`) | **300 passed**, 0 skipped |
| `pnpm -r typecheck` / `lint` / `build` | clean |
| `pnpm -r test` | **web failed** first: Node 24 undici rejects jsdom's `AbortSignal` in React Router navigations (2 tests + unhandled rejections). Fixed in `apps/web/vitest.setup.ts` (test-only Request ignores `signal`). After: web 66/66, extension 54/54, sdk 20/20, demo-sites 15/15 |
| `demo_check` | **26/26** |
| `platform_check` | **42/42** |

## Not run at baseline

- Extension loaded unpacked in Chrome (manual step; built to `apps/extension/dist`).
- Browser viewing of the dashboard (not viewed at baseline).
