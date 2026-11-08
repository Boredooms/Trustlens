# HOSTED_SERVICES

> **Status:** DECIDED · **Group:** 02-architecture (supporting) · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** which hosted platform provides what, its free-tier limits, its failure behaviour, and how to replace it.
> **Related:** [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) · [`../00-project-foundation/TECH_STACK.md`](../00-project-foundation/TECH_STACK.md) · [`../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md`](../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md)

---

## 1. Policy

TrustLens operates **no servers**. Every stateful capability is a managed service on a free tier, chosen
because it (a) has a usable free tier, (b) speaks a standard protocol so we are not locked in, and
(c) fails in a way we can describe to a user.

Three rules govern every dependency:

1. **Behind an interface.** DNS, cache, storage, auth, email and LLM access each have a narrow adapter.
   No module imports a vendor SDK directly except the adapter.
2. **Degradation is documented.** For each service, §5 states what the product does when it is down.
   "It breaks" is not acceptable.
3. **No silent data gravity.** Anything we store in a vendor must be exportable with a documented
   command, and that command is tested at least once before the demo.

---

## 2. Service inventory

| Capability | Service | Protocol | Adapter module | Free-tier shape |
| --- | --- | --- | --- | --- |
| Relational DB | **Supabase Postgres 16** | Postgres wire (+ pooler) | `db/engine.py` | 500 MB, pauses after ~7 days idle |
| Object storage | **Supabase Storage** | S3-compatible + signed URLs | `services/blobs.py` | 1 GB |
| Human auth | **Clerk** | OIDC/JWT (JWKS) | `security/identity.py` | 10k MAU (free plan) |
| Cache / limits | **Upstash Redis** | Redis over REST/TLS | `security/cache.py`, `security/ratelimit.py` | 10k commands/day, 256 MB |
| Cron | **Upstash QStash** | Signed HTTPS | `api/routes/internal_jobs.py` | 500 messages/day |
| Web hosting | **Vercel** | Static + edge CDN | — | 100 GB bandwidth |
| API hosting | **Render** | Container/process | — | 750 instance-hours, sleeps at 15 min |
| Email (**OPTIONAL**) | **Resend** | HTTPS API | `services/mailer.py` | 3,000 emails/month |
| Error tracking | **Sentry** (optional) | DSN | `logging.py` | 5k events/month |
| LLM tracing | **LangSmith** (optional) | HTTPS | `agents/tracing.py` | 5k traces/month |
| LLM inference | OpenAI-compatible provider | HTTPS | `agents/narrator.py` | Pay-per-use, hard cap |
| DNS (demo) | **Cloudflare** | DNS API/manual | — | Free |
| CI | **GitHub Actions** | — | — | 2,000 min/month |

---

## 3. Limits and what happens at the ceiling

| Service | Limit | Symptom at limit | Mitigation |
| --- | --- | --- | --- |
| Supabase DB | 500 MB | Writes fail (`53100 disk_full`) | Retention jobs (90-day evidence), prune page snapshots, move blobs to Storage |
| Supabase DB | Connection cap on free tier | `too many connections` | Pooler + pool 5, short sessions, no long transactions |
| Supabase DB | 7-day pause | Connection refused | Weekly QStash `keepalive` job; manual wake in dashboard |
| Supabase Storage | 1 GB | Upload 413 | 30-day lifecycle on snapshots; store hashes instead of images |
| Clerk | Rate limits on email sends | Signup emails delayed | Documented; demo accounts pre-created |
| Upstash Redis | 10k cmd/day | `429` from Redis | Cache TTLs lengthen, rate limits fall back to per-worker counters |
| QStash | 500 msgs/day | Jobs skipped | Jobs are idempotent; next run catches up; visible in `/ready` |
| Vercel | 100 GB/mo | Bandwidth notice | Static assets only; no large media |
| Render | Sleep after 15 min | 30–60 s cold start | Warm-up routine; frontend stays instant |
| Resend | 3k/mo | Send rejected | Invite links logged; retry next month or upgrade |
| LLM | Budget cap | Template fallback | Cap is intentional; `ai.generated=false` |

---

## 4. Configuration matrix

| Service | Variables | Where set |
| --- | --- | --- |
| Supabase DB | `DATABASE_URL`, `DIRECT_DATABASE_URL` | Render env (API), local `.env` |
| Clerk | `CLERK_SECRET_KEY`, `CLERK_ISSUER`, `CLERK_JWKS_URL`, `CLERK_AUTHORIZED_PARTY` (server), `VITE_CLERK_PUBLISHABLE_KEY` (web) | Render + Vercel |
| Supabase Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET=evidence` | Render |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Render |
| QStash | `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Render |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Render |
| Sentry | `SENTRY_DSN` | Render + Vercel |
| LangSmith | `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | Render |

Full descriptions and validation rules: `../08-infrastructure/ENVIRONMENT_CONFIGURATION.md` §2.

---

## 5. Failure behaviour (per service)

| Service down | User-visible effect | Internal behaviour | Recovery |
| --- | --- | --- | --- |
| Postgres | `/ready` 503; scans cannot start; dashboard shows "service unavailable" with retry | `/health` still 200; no partial writes | Provider status; wake project; rollback if migration-caused |
| Clerk | New logins fail; existing sessions work until JWT expiry | JWKS cached; API keeps verifying cached keys | Wait; document the outage on `/status` (FUTURE) |
| Storage | Evidence blobs unavailable; findings still render (they store summaries) | Fail the upload, keep the finding | Re-upload job; snapshots are optional to a verdict |
| Redis | Rate limits approximate; cache misses increase scan latency by ~1–2 s | Fall back to in-process counters; log once per minute | Self-heals on reconnect |
| QStash | Cron stops: expiry buckets and decay stall | Data remains correct, just stale | Manual trigger endpoint for an operator |
| Vercel | Frontend unavailable | API unaffected; extension unaffected | Redeploy previous build |
| Render API | Everything user-facing unavailable | DB intact; extension fails open with "not checked" | Wake/restart; rollback |
| Resend | Invites not delivered | Invite row created; link logged at `info` in dev, withheld in prod | Resend, or share the link manually |
| LLM | Investigations use templates | `ai.generated=false`, UI labels it | Automatic on next request |

Rule: **an outage in an enrichment service never blocks a verdict.** Only Postgres is on the critical
path for producing one.

---

## 6. Data export and portability

| Data | Export command | Format |
| --- | --- | --- |
| Relational data | `pg_dump "$DIRECT_DATABASE_URL" --no-owner -Fc` | Postgres custom dump |
| Schema | `pg_dump --schema-only` | SQL |
| Storage objects | `supabase storage cp -r ss:///evidence ./evidence` | Files |
| Users | Clerk dashboard export (email + id; no hashes exist on our side) | CSV |
| Redis | Not exported (all disposable) | — |
| LangGraph checkpoints | Postgres schema `langgraph` — included in `pg_dump` | SQL |

The dump command is exercised in `DEMO_RUNBOOK.md` §4 (pre-flight backup), so it is not a document
that has never been run.

---

## 7. Migration paths

| From | To | Effort | Notes |
| --- | --- | --- | --- |
| Supabase Postgres | Neon / RDS / self-hosted Postgres | Low | Change `DATABASE_URL`, run Alembic; no schema change |
| Clerk | Auth0 / Supabase Auth / WorkOS | Medium | Replace `security/identity.py`; keep `clerk_user_id` → `external_sub` mapping and re-point JWKS |
| Supabase Storage | S3 / R2 | Low | Adapter swap; keys are ULIDs, paths unchanged |
| Upstash Redis | Any Redis / Valkey | Low | REST → RESP adapter; same key names |
| QStash | GitHub Actions cron / Render cron | Low | Endpoints already signed and idempotent |
| Vercel | Netlify / Cloudflare Pages | Low | Static output |
| Render | Fly.io / Railway | Low | Same Dockerfile/start command |
| Resend | Postmark / SES | Low | `services/mailer.py` |
| LangSmith | None (traces optional) | None | Delete env vars |

No migration requires a data model change — that is the point of the adapters.

---

## 8. Security notes per service

| Service | Risk | Control |
| --- | --- | --- |
| Supabase | `service_role` key leaks ⇒ full DB bypass | Key only in the deletion job; startup assertion; never in web/extension |
| Supabase | RLS misconfiguration if the anon key were used directly | The browser never queries Postgres; RLS is defence in depth |
| Upstash | Token leak ⇒ cache poisoning / limit bypass | Token server-only; keys namespaced; no PII in cached values |
| QStash | Unsigned calls to internal jobs | Signature verification required; endpoints not in public OpenAPI |
| Vercel | Preview URLs are public | Preview deployments use demo data only, never production credentials |
| Render | Env var misconfiguration | Validation at startup; fail fast on missing secrets |
| Resend | Phishing via our domain | SPF/DKIM/DMARC configured; templates fixed, no user-supplied bodies |
| LLM | Data exposure | Only the redacted evidence pack leaves our boundary |

---

## 9. Local development

`docker-compose.yml` reproduces the stateful services locally so development does not require accounts:

```yaml
services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: trustlens }
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  # optional: supabase CLI for local Postgres + Storage only
  # npx supabase start
```

The Redis adapter exposes both a REST client (Upstash, production) and a RESP client (local), selected
by whether `UPSTASH_REDIS_REST_URL` is set. Tests use an in-memory fake, never a real service.

---

## 10. Acceptance criteria

1. Every service in §2 has an adapter module and at most one import site outside it.
2. Disabling any enrichment service (Redis, QStash, Resend, LLM, Storage) leaves scans working and
   degrades only the documented behaviour.
3. `/ready` reports the state of Postgres and the scanner; enrichment outages are logged, not fatal.
4. No `service_role` key or Redis token appears in a frontend bundle (CI grep).
5. The `pg_dump` export runs successfully in pre-flight.
6. Free-tier ceilings in §3 are cross-checked before the demo (checklist item in the runbook).
