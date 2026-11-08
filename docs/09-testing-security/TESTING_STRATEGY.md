# TESTING_STRATEGY

> **Status:** DECIDED · **Group:** 09-testing-security · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** test levels, tools, fixtures, security tests, demo tests, acceptance gates.
> **Related:** [`SECURITY_THREAT_MODEL.md`](SECURITY_THREAT_MODEL.md) · [`../10-hackathon-demo/DEMO_RUNBOOK.md`](../10-hackathon-demo/DEMO_RUNBOOK.md)

---

## 1. Principles

1. **Test behaviour, not implementation.** Assert decisions, status codes, persistence effects.
2. **Every security control has an adversarial test.** A guard without a bypass test is unproven.
3. **No network in unit tests.** External calls are intercepted at the `fetcher` boundary.
4. **Fixtures are recorded, not live.** Collectors replay recorded DNS/TLS/RDAP/HTML.
5. **A failing test blocks merge.** No `skip` without a linked issue and an expiry date.
6. **Demo paths are tested like production paths.** The demo is not a special case in code.

---

## 2. Levels and tools

| Level | Tool | Scope | Runtime target |
| --- | --- | --- | --- |
| Unit (API) | pytest | rules, scoring, policy, normalisers, redaction, SSRF classifier | < 20 s total |
| Contract (API) | pytest + httpx ASGI | every endpoint: status, schema, auth failure | < 40 s |
| Integration (API) | pytest + Postgres | scan orchestration, persistence, graph traversal | < 60 s |
| Unit (web) | Vitest | formatters, guards, decision copy | < 10 s |
| Component (web) | Vitest + Testing Library | badges, coverage meter, empty/error states | < 20 s |
| Unit (extension) | Vitest | metadata extraction, cache TTL, decision mapping | < 10 s |
| Type tests (SDK) | tsd | public surface stability | < 10 s |
| E2E | Playwright | login → scan → report → graph | < 3 min |
| Security | pytest + Playwright | SSRF matrix, XSS, authz, injection fixtures | < 60 s |
| Manual | checklist | accessibility, demo rehearsal, cold start | — |

CI runs lint → typecheck → unit → contract → integration → security → build. E2E runs on `main` and
before a demo.

---

## 3. API unit tests

### 3.1 Risk engine (mandatory coverage)

| Test | Assertion |
| --- | --- |
| Each `R-*` rule | Positive fixture fires with expected code and severity; negative fixture does not |
| Group caps | 3 criticals in one group contribute exactly the group weight |
| Score determinism | Same findings twice → identical score, level, decision, reasons |
| Coverage gate | 30% + score 10 → `REVIEW`; 20% → `UNKNOWN`; 60% + score 10 → `ALLOW` |
| Override O-2 | Payee mismatch forces `BLOCK` at score 18 |
| Override O-1 precedence | Analyst block wins over O-2 in `overrides[]` |
| Override O-4 | Login destination mismatch forces `BLOCK` |
| Positive findings | `PAYEE_MATCH_CONFIRMED` does not lower the score |
| Intent gating | Credential rules do not fire for `browse`; group is `skipped` |
| Reasons | ≤ 5, no unfilled placeholders, no "safe" wording |
| Unknown values | Enum with an unknown value is rejected by validation, not defaulted |

### 3.2 Normalisers

URL (13 cases: uppercase host, trailing dot, default port, punycode, credentials, fragment, unicode
host, overlong host, weird schemes, embedded newline, IP literal, IPv6 literal, trailing whitespace);
UPI VPA; IBAN checksum; domain extraction with public suffix; certificate fingerprint formatting.

### 3.3 Redaction

Fixtures containing bearer tokens, `Set-Cookie`, `password=`, 16-digit numbers, `tl_live_` keys,
`upi://` URIs with tokens. Assert the redactor removes them and leaves the rest intact.

---

## 4. Contract tests

For **every** endpoint in `API_ENDPOINTS.md`:

| Case | Expected |
| --- | --- |
| Unauthenticated (where auth required) | 401 with `UNAUTHENTICATED` |
| Wrong scope | 403 `INSUFFICIENT_SCOPE` |
| Cross-tenant id | 404 (not 403) |
| Invalid body | 422 `VALIDATION_FAILED` with `details[].field` |
| Unknown field | 422 (because `extra="forbid"`) |
| Happy path | Documented status + response matches the schema |
| Error envelope | `error.code`, `error.message`, `error.request_id` present |
| `X-Request-Id` | Always present, echoed when valid |

A generated test iterates the OpenAPI document and asserts that every declared response model is
importable and that every documented status code appears in the route's `responses` — catching drift
between docs and code.

---

## 5. Integration tests

| Scenario | Assertion |
| --- | --- |
| Full scan of a recorded lookalike | `BLOCK`, expected codes, findings persisted with evidence, entities/edges created |
| Scan of a clean recorded site | `ALLOW`, coverage ≥ 50 |
| Probe failure mid-scan | `status=partial`, coverage reduced, decision not `ALLOW` if coverage < 50 |
| Probe budget exceeded | `status=partial`, `duration_ms` ≤ budget + 2 s |
| Domain verification (DNS fixture) | `verified`, audit row written |
| Domain verification mismatch | `422`, `observed_value` truncated |
| Report → review → propagation | reputation changes exactly once; second confirmation 409 |
| Graph traversal depth 2 | Correct node/edge set, `truncated=false` |
| Graph node cap | `truncated=true`, counts correct |
| Investigation without LLM key | `ai.generated=false`, narrative present, refs valid |
| Investigation with a stubbed model returning a bad ref | Claim dropped, `dropped_claims` non-empty |

Database tests run inside a rolled-back transaction; each test seeds only what it needs.

---

## 6. Security tests (adversarial)

### 6.1 SSRF matrix

Every case must be rejected with `422 TARGET_NOT_ALLOWED` **and** no outbound request (asserted with a
mocked transport that fails the test if called):

| Input | Class |
| --- | --- |
| `http://127.0.0.1/` | loopback |
| `http://127.0.0.1.nip.io/` | loopback via DNS |
| `http://localhost/` | internal name |
| `http://[::1]/` | IPv6 loopback |
| `http://10.0.0.5/`, `172.16.0.1`, `192.168.1.1` | private |
| `http://169.254.169.254/latest/meta-data/` | cloud metadata |
| `http://100.64.0.1/` | CGNAT |
| `http://224.0.0.1/`, `http://[ff02::1]/` | multicast |
| `http://0.0.0.0/`, `http://[::]/` | unspecified |
| `http://2130706433/` | decimal-encoded loopback |
| `http://0x7f000001/` | hex-encoded |
| `http://[::ffff:127.0.0.1]/` | IPv4-mapped |
| `http://169.254.169.254@evil.example/` | userinfo trick |
| `http://evil.example#@127.0.0.1/` | fragment trick |
| `file:///etc/passwd`, `gopher://`, `dict://`, `ftp://` | scheme |
| Redirect chain 302 → `http://127.0.0.1/` | redirect SSRF |
| DNS answers public then private on re-resolution | rebinding |
| Host with a CNAME to `metadata.google.internal` | internal target |

### 6.2 Other security tests

| Area | Test |
| --- | --- |
| Auth | JWT `alg=none` rejected; expired rejected; revoked key rejected; refresh reuse revokes family |
| Authorisation | Cross-tenant org read → 404; member cannot verify recipient; user cannot review report |
| CSRF | Cookie mutation with foreign `Origin` → 403 |
| XSS | Report justification containing `<script>` renders as text in the dashboard (component test) |
| Injection | Page text containing "ignore previous instructions" cannot change the decision |
| File fetch | Verification file > 4 kB truncated/rejected; non-HTTPS rejected |
| Rate limits | 6th scan in the window → 429 with `Retry-After` |
| Redaction | No token appears in stored evidence or logs (fixture log scan) |
| Extension | No `innerHTML` with API data; no `.value` read on password fields (grep + review gate) |

### 6.3 Data-protection tests

| Test | Assertion |
| --- | --- |
| Scan evidence | Contains no form values, cookies or headers |
| Account deletion | Scans anonymised or deleted; reporter nulled; keys revoked |
| Public profile | No member emails, no unverified domains, no evidence refs |
| Audit | Every mutation writes exactly one row |

---

## 7. Frontend tests

| Component | Cases |
| --- | --- |
| `VerdictBadge` | All five decisions; text + icon; never "Safe" |
| `CoverageMeter` | 0, 49, 50, 100; `aria-valuetext` |
| `FindingRow` | Observed/expected rendering, evidence count, expand |
| `ScanReport` | queued → running → completed; partial banner; failed panel |
| `Overview` | Each block independent failure; no fabricated data |
| `GraphCanvas` | Renders nodes/edges; list view parity; filter below threshold hides edges |
| Forms | Validation messages, server 422 mapping, disabled submit |

Route-level test: an unauthenticated visit to `/app/scan` redirects to `/login?next=/app/scan`.

---

## 8. Extension tests

| Test | Assertion |
| --- | --- |
| Metadata extraction | Forms, password presence, `upi://` payee, no values read |
| Decision mapping | Five decisions → five icon/banner states |
| Cache | Hit < 10 min; miss after; stale rendered as `UNKNOWN` |
| Fail-open | API 500 → allow + `UNKNOWN` state |
| Interception | `BLOCK` calls `preventDefault` on submit |
| Report payload | No HTML, no values, whitelisted fields only |
| Pairing | Code exchange stores token; 401 clears it |

---

## 9. SDK tests

- `tsd`: `assess` returns `Promise<Assessment>`; unknown decision is not assignable.
- Runtime with mocked `fetch`: success, each error class, retry timing, timeout abort, idempotency
  header, unknown enum tolerance.
- Bundle size gate: ≤ 12 kB gzip.

---

## 10. End-to-end (Playwright)

Seeded environment, three scenarios:

1. **Investigate**: login → scan the demo lookalike with `intent=payment` → assert `Blocked`, the payee
   mismatch text, coverage, and that the evidence drawer opens.
2. **Review**: analyst login → reports → confirm with reason → assert status change and audit entry via
   API.
3. **Certificate incident**: operator → run simulated incident → assert the badge, the affected domain
   list, and the `SIMULATED-` export filename.

Selectors use roles and accessible names, not CSS classes, so a visual refactor does not break them.

---

## 11. Demo tests (pre-presentation)

Run in order, timed, twice:

| # | Check | Pass |
| --- | --- | --- |
| 1 | `/ready` 200 after warm-up | < 60 s from cold |
| 2 | Demo lookalike loads over HTTPS | certificate valid, page renders |
| 3 | Extension blocks payment | overlay with observed/expected |
| 4 | Dashboard scan returns `BLOCK` | ≤ 20 s |
| 5 | Investigation completes | narrative with refs; AI or template labelled |
| 6 | Graph shows 3 sites, 1 campaign | confidence ≥ 0.6 |
| 7 | Report from profile A warns profile B | second check `WARN` |
| 8 | Simulated incident lists affected domains | badge visible |
| 9 | SDK snippet returns a verdict | `BLOCK` for the lookalike |
| 10 | Fallback: recording plays if the network dies | presenter has it open |

---

## 12. Performance tests

| Test | Target |
| --- | --- |
| `POST /assess` warm, cached domain | p50 ≤ 400 ms |
| `POST /scans` + full scan (recorded fixtures) | p50 ≤ 20 s, p99 ≤ 60 s |
| Graph depth 2, 300 nodes | ≤ 1.5 s |
| 50 concurrent `/assess` | no 5xx, p95 ≤ 2 s |
| Frontend initial JS | ≤ 180 kB gzip |

Load tests run locally with `hey`/`k6` against a seeded DB; results are recorded, not asserted in CI.

---

## 13. Fixtures and mocking

| Fixture | Location | Notes |
| --- | --- | --- |
| DNS answers | `tests/fixtures/dns/*.json` | Includes NXDOMAIN, CNAME chains |
| TLS chains | `tests/fixtures/tls/*.pem` | Valid, expired, weak key, SHA-1, mismatched SAN |
| RDAP | `tests/fixtures/rdap/*.json` | Young domain, normal domain, 404 |
| HTML | `tests/fixtures/html/*.html` | Lookalike (inert), clean site, JS-only form, iframe payment |
| LLM | `tests/fixtures/llm/*.json` | Good narrative, bad ref, invalid JSON, injection attempt |
| Demo seed | `app/scripts/seed_demo.py` | Idempotent, demo-only guard |

The `fetcher` accepts a transport injection point; tests replace it, so the SSRF guard always runs.

---

## 14. Quality gates

| Gate | Threshold |
| --- | --- |
| API coverage (`app/services`, `app/risk`) | ≥ 80% |
| Contract coverage | every documented endpoint |
| Rule coverage | every `R-*` has a test |
| Lint / typecheck | zero errors, zero warnings in app packages |
| Bundle size | web ≤ 180 kB initial; sdk ≤ 12 kB |
| Security suite | 100% pass |
| Docs drift | OpenAPI change requires a docs change |

---

## 15. What we deliberately do not test in the MVP

- Live Certificate Transparency ingestion (no implementation).
- Real payment-provider integration (none).
- Browser matrix beyond Chromium (extension targets Chrome/Edge).
- Load beyond 50 concurrent users (single instance; documented rather than simulated).
- Fuzzing of the HTML parser (upstream responsibility; we cap size and time).
