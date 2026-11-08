# BACKEND_OVERVIEW

> **Status:** DECIDED · **Group:** 03-backend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** FastAPI application structure, lifecycle, dependency injection, middleware, configuration, error handling, in-process task model.
> **Related:** [`AUTHENTICATION_AUTHORIZATION.md`](AUTHENTICATION_AUTHORIZATION.md) · [`API_ENDPOINTS.md`](API_ENDPOINTS.md) · [`RISK_ENGINE.md`](RISK_ENGINE.md) · [`../02-architecture/SYSTEM_ARCHITECTURE.md`](../02-architecture/SYSTEM_ARCHITECTURE.md)

---

## 1. Responsibilities

The backend is the only component that:

- authenticates and authorises,
- validates and normalises URLs,
- enforces the SSRF policy,
- talks to the open internet,
- scores findings and issues decisions,
- persists evidence and graph edges,
- calls the language model,
- logs audit events.

It does **not** render UI, store credentials, move money, or trust client-supplied conclusions.

---

## 2. Application layout

```text
apps/api/
├── app/
│   ├── main.py               create_app(), lifespan, router mounting
│   ├── config.py             Settings (pydantic-settings)
│   ├── logging.py            structured logging, request_id binding
│   ├── errors.py             DomainError hierarchy + handlers
│   ├── api/
│   │   ├── deps.py           get_db, current_user, require_scope, rate_limit
│   │   ├── middleware.py     request id, timing, body size, CORS, security headers
│   │   └── routes/           one module per resource
│   ├── schemas/              request/response models, enums, pagination
│   ├── models/               SQLAlchemy 2 mapped classes
│   ├── repositories/         SQL only
│   ├── services/             probing, verification, orchestration
│   ├── risk/                 rules, scoring, policy
│   ├── intelligence/         graph, correlation, campaigns
│   ├── agents/               investigation orchestrator
│   ├── security/             ssrf, redaction, rate limit, tokens
│   ├── db/                   engine, session factory, base
│   └── scripts/              seed_demo, verify_config, backfill
├── alembic/                  migrations
├── tests/                    unit, contract, integration
├── pyproject.toml
└── requirements.txt
```

Layering rule (repeated because it is broken most often): `routes → services → repositories →
models`. `risk/` and `intelligence/` are called by services, never by routes directly. `agents/` is
called only by the investigations service.

---

## 3. Application lifecycle

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.started_at = time.monotonic()
    app.state.db = create_engine(settings.database_url)
    app.state.http = httpx.AsyncClient(limits=..., timeout=...)
    app.state.scan_semaphore = asyncio.Semaphore(settings.scan_concurrency)
    app.state.scan_tasks = set()
    app.state.breaker = CircuitBreakerRegistry()
    log.info("startup", env=settings.environment, version=APP_VERSION)
    try:
        yield
    finally:
        for task in list(app.state.scan_tasks):
            task.cancel()
        await app.state.http.aclose()
        await app.state.db.dispose()
        log.info("shutdown")
```

Startup must **not** fail when the database is unreachable — the service still needs to answer
`/health` and return `503` from `/ready`. Migrations are not run at startup.

---

## 4. Configuration

`Settings` is a `pydantic-settings` model with `env_file=".env"`, `case_sensitive=True`, and
`extra="ignore"`. Validation happens at import; a missing required variable raises a single, readable
error that names the variable and the file. Full registry:
`../08-infrastructure/ENVIRONMENT_CONFIGURATION.md`.

```python
class Settings(BaseSettings):
    environment: Literal["development", "test", "production"] = "development"
    database_url: str
    jwt_secret: SecretStr
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    scan_concurrency: int = 4
    scan_budget_seconds: int = 60
    deep_scan_enabled: bool = False
    demo_mode: bool = False
    llm_api_key: SecretStr | None = None
    allowed_origins: list[str] = []
```

`DEMO_MODE` enables operator-only simulated endpoints. It is `false` in production and is asserted
by a startup check that logs a warning when true.

---

## 5. Middleware

Order matters; outermost first.

| # | Middleware | Purpose |
| --- | --- | --- |
| 1 | `RequestIdMiddleware` | Accept or mint `X-Request-Id`, bind to log context, echo on response |
| 2 | `TimingMiddleware` | `Server-Timing` header, slow-request log above 2 s |
| 3 | `SecurityHeadersMiddleware` | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, HSTS in prod |
| 4 | `BodySizeLimitMiddleware` | Reject > 256 kB before parsing |
| 5 | `CORSMiddleware` | Explicit origin allowlist; credentials only for the web origin |
| 6 | `OriginCheckMiddleware` | For cookie-authenticated mutations, require `Origin` in the allowlist |
| 7 | `ExceptionMiddleware` | Map `DomainError` → envelope; log unexpected errors with `request_id` |

CORS is configured with `allow_origins=settings.allowed_origins`,
`allow_credentials=True`, `allow_methods=["GET","POST","PATCH","DELETE","OPTIONS"]`,
`allow_headers=["Authorization","Content-Type","Idempotency-Key","X-Client","X-Request-Id"]`,
`max_age=600`. Wildcards are forbidden with credentials.

---

## 6. Dependencies

| Dependency | Provides | Failure |
| --- | --- | --- |
| `get_db` | `AsyncSession` per request | 503 `NOT_READY` |
| `current_user` | `User` from JWT or API key | 401 |
| `optional_user` | `User | None` (anonymous scans) | — |
| `require_role(*roles)` | Guard | 403 |
| `require_scope(scope)` | API key scope guard | 403 `INSUFFICIENT_SCOPE` |
| `require_org_member(role=None)` | Membership | 404 (existence hiding) |
| `rate_limit(group)` | Token bucket | 429 |
| `idempotency` | Replay protection | 409 |
| `get_settings` | Cached settings | startup error |

```python
async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise Unauthenticated()
    if creds.credentials.startswith(("tl_live_", "tl_ext_")):
        return await authenticate_api_key(db, creds.credentials)
    return await authenticate_jwt(db, creds.credentials)
```

---

## 7. Error handling

Domain exceptions are the only way routes signal failure.

```python
class DomainError(Exception):
    code: str = "INTERNAL_ERROR"
    status: int = 500
    message: str = "Unexpected error."

    def __init__(self, message: str | None = None, **details): ...

class TargetNotAllowed(DomainError):
    code, status = "TARGET_NOT_ALLOWED", 422
```

Handler behaviour:

- Known `DomainError` → envelope with its code/status; log at `warning` without a stack trace.
- `RequestValidationError` → `422 VALIDATION_FAILED` with `details[]` derived from Pydantic errors,
  field names preserved, no input echo of secrets.
- Unhandled `Exception` → `500 INTERNAL_ERROR`, log with stack trace **server-side only**.
- Never return `str(exc)` to the client.

---

## 8. Database session discipline

- One session per request, provided by `get_db`, closed in a `finally`.
- One transaction per request by default; explicit `commit()` at the service boundary.
- Network I/O never happens inside an open transaction. Scans read and write in short bursts.
- Pool: `pool_size=5`, `max_overflow=5`, `pool_pre_ping=True`, `pool_recycle=1800`.
- All queries use bound parameters. The only raw SQL is the reviewed graph CTE.

---

## 9. Background work, caching and scheduling

Three mechanisms, each with a narrow job:

| Mechanism | Used for | Authoritative? |
| --- | --- | --- |
| `asyncio` task + semaphore | Scan and investigation execution | No — state is in Postgres |
| Upstash Redis | Rate-limit buckets, idempotency keys, domain/verdict cache, AI budget counters | No — disposable |
| Upstash QStash | Cron: certificate sweep, reputation decay, stale-scan reconciliation, Supabase keep-alive | No — jobs are idempotent |

### 9.1 In-process tasks

Scan and investigation work runs as asyncio tasks inside the API process.

```python
def schedule_scan(app, scan_id: str) -> None:
    task = asyncio.create_task(run_scan(app, scan_id))
    app.state.scan_tasks.add(task)
    task.add_done_callback(app.state.scan_tasks.discard)
```

Rules:

1. Concurrency is capped by a semaphore (`SCAN_CONCURRENCY`, default 4).
2. Every task has a hard wall-clock budget (`SCAN_BUDGET_SECONDS`, default 60). The orchestrator
   checks a deadline between probes and marks `partial` when exceeded.
3. A task always writes a terminal status, including on exception (`failed` + `failure_code`).
4. On shutdown, tasks are cancelled; any scan left `running` older than 5 minutes is swept to
   `failed` by a startup reconciliation query.
5. Tasks are **not** retried automatically. The user re-submits (idempotency key makes this safe).

Why not Celery: see ADR-003. The cost is no retries and no cross-process visibility; the benefit is
one deploy, no broker, nothing to keep warm.

### 9.2 Redis (Upstash) usage

```python
class RateLimiter:
    async def hit(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        # INCR + EXPIRE via Upstash REST pipeline, one round trip
        ...
```

| Key pattern | TTL | Purpose |
| --- | --- | --- |
| `rl:<group>:<actor>` | window | Token bucket |
| `idem:<actor>:<key>` | 24 h | Idempotent replay body hash |
| `cache:domain:<eTLD+1>` | 1 h | DNS/RDAP/TLS block reuse |
| `cache:verdict:<urlhash>` | 10 min | Assessment reuse |
| `ai:budget:<user>:<day>` | 24 h | Investigation cap |
| `lock:scan:<id>` | 120 s | Prevents duplicate execution across workers |

Degradation rule: on Redis error, log once per 60 s, fall back to in-process counters (approximate
limits), and continue serving. **Never** fail a request because the cache is down.

### 9.3 QStash cron

| Schedule | Endpoint | Job |
| --- | --- | --- |
| Every 15 min | `POST /internal/jobs/cert-sweep` | Expiry buckets, fingerprint changes |
| Daily 02:00 | `POST /internal/jobs/reputation-decay` | ±2/week drift toward 0 |
| Every 5 min | `POST /internal/jobs/reconcile-scans` | Sweep `running` scans older than 5 min to `failed` |
| Weekly | `POST /internal/jobs/keepalive` | `SELECT 1` so Supabase does not pause |

All internal job endpoints require `Upstash-Signature` verification (the header QStash actually sends;
HS256 with the current/next signing key, `iss`, `sub` = URL host+path, `exp`/`nbf`, body SHA-256)
**and** are absent from the public OpenAPI document. They are idempotent and safe to retry. An operator
session may trigger any job by hand (HOSTED_SERVICES §5). A daily `POST /internal/jobs/retention`
purges pairing codes, expired idempotency keys, usage counters > 90 days and audit logs > 1 year.
Schedules are created by hand with `python -m app.scripts.register_schedules --api-base https://…`.

---

## 10. Logging

Structured JSON to stdout; the host collects it.

```json
{"ts":"2026-11-07T09:14:22.104Z","level":"info","event":"scan.completed",
 "request_id":"req_01J...","scan_id":"01JCM...","decision":"BLOCK","risk_score":87,
 "coverage_pct":85,"duration_ms":8421,"env":"production","version":"0.4.1"}
```

Rules:

- Never log full URLs with query strings that may contain tokens; log the registrable domain and a
  hash of the URL when the query is present.
- Never log headers, cookies, form values, evidence payloads or model prompts in full.
- Log one line per request at `info` with status and duration; `warn` for 4xx above 422; `error` for 5xx.
- Include `request_id` on every line via context binding.

---

## 11. OpenAPI generation

- `app.openapi()` is dumped to `apps/api/openapi.json` by `python -m app.scripts.dump_openapi`.
- CI runs the dump and fails on a diff, forcing the author to commit the regenerated contract.
- `packages/shared-types` regenerates from that file (`pnpm gen:types`).
- Tags group endpoints: `health`, `auth`, `scans`, `assess`, `organisations`, `reports`,
  `intelligence`, `certificates`, `investigations`, `developer`.

Every route declares `response_model`, `status_code`, `summary`, `description`, and the error
envelope via `responses={...}` so the generated SDK can distinguish codes.

---

## 12. Testing hooks

- `ENVIRONMENT=test` uses a transactional test database; each test runs in a rolled-back transaction.
- External calls are intercepted at the `fetcher` boundary, not by monkeypatching libraries, so the
  guard is always exercised.
- Fixtures for DNS/TLS/RDAP live in `tests/fixtures/collectors/` as recorded JSON.
- `--cov-fail-under=80` for `app/services` and `app/risk`; routes are covered by contract tests.

---

## 13. Performance notes

| Concern | Mitigation |
| --- | --- |
| Fan-out latency | `asyncio.gather` with per-probe timeouts |
| Slow DNS | 2 s timeout, parallel A/AAAA, single retry |
| Large HTML | 2 MB cap, streaming discard after cap |
| CPU hashing | `asyncio.to_thread` with a 2-slot executor |
| Graph queries | depth ≤ 3, node cap 500, 3 s statement timeout |
| Repeated domains | TTL cache per worker keyed by registrable domain |
| Cold start | Lazy import of Playwright; no model init at startup |

---

## 14. What this service refuses to do

1. Scan a target inside private, loopback, link-local, CGNAT, multicast, reserved or metadata ranges.
2. Follow a redirect into a blocked range.
3. Execute a downloaded file.
4. Store a credential, OTP or card number.
5. Let the model choose a verdict, a score, or a tool that is not on the allowlist.
6. Return a verdict without coverage.
7. Start without a validated configuration (except DB reachability).
