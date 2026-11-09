# Online end-to-end evidence (2026-11-09)

Every run below used the **hosted** services: Supabase Postgres (transaction pooler 6543 at runtime,
session pooler 5432 for migrations), Clerk dev instance, Upstash Redis, Upstash QStash (eu-central-1)
and the NVIDIA-hosted LLM. There was no local application database. The API, web dev server, demo
sites and Hardhat node ran on the developer machine. No secret values appear in this folder.

| # | Step | How | Result |
| --- | --- | --- | --- |
| 1 | Service reachability | `python -m app.scripts.online_check` | DB 6543 + 5432 ok (Postgres 17.11), Upstash PING 200, QStash schedules 200, Clerk users/count 200, JWKS 1 key, LLM model available |
| 2 | Schema | `alembic upgrade head` on hosted DB | `c2a0plat0001` → `c6a0rls00001` |
| 3 | RLS | `python -m app.scripts.rls_audit` | 33 tables, 0 problems (after `c6a0rls00001`) |
| 4 | Seed | `python -m app.scripts.seed_demo` | Idempotent; Northstar University present |
| 5 | Clerk sign-up link | Chrome (Playwright) on `/login` | Before fix: hosted Account Portal URL with `__clerk_db_jwt`. After: `/register` |
| 6 | Clerk sign-in → `/app` | Chrome, labelled E2E test user | `/login` → new-device email code → `/app`; no token in any URL |
| 7 | `?next=` | Chrome, `/login?next=/app/scan` | Lands on `/app/scan` |
| 8 | Sign-out | Chrome | Lands on `/` |
| 9 | Sign-up through the UI | Chrome | **Not automated**: Clerk bot protection keeps Continue disabled headless. Not bypassed. Needs one manual sign-up |
| 10 | QStash signatures | Real current/next keys against `/internal/jobs/*` | current ✓, next ✓; forged, tampered body, wrong destination, missing signature all rejected |
| 11 | Demo path | `python -m app.scripts.demo_check --timeout 120` | 26/26 |
| 12 | Platform | `python -m app.scripts.platform_check` | 42/42 |
| 13 | Evidence | `python -m app.scripts.evidence_run --network` | 17/17 (`../TESTING_REPORT.md`) |
| 14 | Scans from the UI | Chrome, Scan screen | Completed server-side (benign ALLOW 0, lookalike BLOCK 81, revoked-cert WARN); the UI showed its "took too long" state on this machine's network |
| 15 | Report rendering | Chrome, signed in, three scans | All three render: certificate, header and intel cards present; technical rail shows 6 blocks with no duplicated raw JSON |

Screenshots (signed in as the labelled "E2E Automated test account"):
[`report-benign.png`](report-benign.png) · [`report-lookalike.png`](report-lookalike.png) ·
[`report-revoked.png`](report-revoked.png).

Network notes from this machine: cold DB connect ~4.8 s, round trips 150–470 ms, intermittent
`getaddrinfo failed`, Upstash `ConnectTimeout` (rate limits fell back in-process and logged
`ratelimit.redis_degraded`), Clerk JS load ~20 s. The API should run next to the DB in production.

Not tested here: real QStash delivery (needs a public API URL), the deployed Render/Vercel stack,
production Clerk instance, the extension against the hosted API.
