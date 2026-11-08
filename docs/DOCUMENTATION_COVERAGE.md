# Documentation Coverage & Consistency Matrix

> **Status:** DECIDED · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Purpose:** Prove that all 36 core documents exist, state what each covers, record the
> cross-document consistency audit, and list every unresolved question in one place.
> **Companion:** [`INDEX.md`](INDEX.md)

---

## 1. Coverage matrix

`C` = complete for MVP scope · `P` = partial, gap listed in §4 · `F` = future only.

| # | Document | Group | Primary coverage | Feature IDs covered | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `PROJECT_OVERVIEW.md` | 00 | Vision, problem, differentiation, terminology, non-goals | — | C |
| 2 | `TECH_STACK.md` | 00 | Every technology: purpose, alternatives, trade-offs | — | C |
| 3 | `DEVELOPMENT_GUIDELINES.md` | 00 | Conventions, git, review, agent rules, ownership | — | C |
| 4 | `PRODUCT_REQUIREMENTS.md` | 01 | Functional/non-functional requirements, roles, constraints | TL-001…TL-024 | C |
| 5 | `USER_PERSONAS.md` | 01 | Six personas, goals, permissions | — | C |
| 6 | `USER_JOURNEYS.md` | 01 | Eleven end-to-end journeys with failure paths | TL-001…TL-024 | C |
| 7 | `FEATURE_SPECIFICATIONS.md` | 01 | Canonical feature catalogue and acceptance criteria | TL-001…TL-024 | C |
| 8 | `PRODUCT_ROADMAP.md` | 01 | MVP / demo / post-hackathon / production | TL-001…TL-024 | C |
| 9 | `SYSTEM_ARCHITECTURE.md` | 02 | Components, boundaries, lifecycle, ADRs | — | C |
| 10 | `DATA_FLOW.md` | 02 | 13 flows with sequence diagrams | TL-001…TL-020 | C |
| 11 | `DATABASE_DESIGN.md` | 02 | 25 tables, indexes, retention, ER diagram | TL-001…TL-024 | C |
| 12 | `API_CONTRACTS.md` | 02 | Envelopes, enums, errors, pagination, versioning | — | C |
| 13 | `BACKEND_OVERVIEW.md` | 03 | FastAPI layout, DI, middleware, config, errors | — | C |
| 14 | `AUTHENTICATION_AUTHORIZATION.md` | 03 | JWT + refresh, API keys, device pairing, RBAC | TL-021, TL-022 | C |
| 15 | `API_ENDPOINTS.md` | 03 | 58 active endpoints with schemas and status codes (+4 delegated to Clerk) | all | C |
| 16 | `RISK_ENGINE.md` | 03 | 5 signal groups, rule IDs, finding codes, policy | TL-004, TL-009 | C |
| 17 | `ORGANISATION_TRUST_PROFILES.md` | 03 | Verification lifecycle, DNS/file challenge, recipients | TL-006, TL-007 | C |
| 18 | `FRONTEND_ARCHITECTURE.md` | 04 | Routing, layouts, query layer, state, code splitting | all UI | C |
| 19 | `DESIGN_SYSTEM.md` | 04 | Tokens, typography, components, charts, graph styling | — | C |
| 20 | `UI_UX_SPECIFICATIONS.md` | 04 | 15 screens with layout, states, responsive rules | all UI | C |
| 21 | `ANIMATION_GUIDELINES.md` | 04 | GSAP / Motion / CSS / Lenis division of labour | — | C |
| 22 | `ACCESSIBILITY_RESPONSIVENESS.md` | 04 | WCAG 2.1 AA targets, breakpoints, a11y patterns | — | C |
| 23 | `EXTENSION_ARCHITECTURE.md` | 05 | MV3 modules, permissions, messaging, storage | TL-016, TL-017 | C |
| 24 | `BROWSER_PROTECTION_LOGIC.md` | 05 | Warning thresholds, interception limits, fail modes | TL-017, TL-018 | C |
| 25 | `EXTENSION_API_INTEGRATION.md` | 05 | Every extension↔API call, cache and error rules | TL-016…TL-018 | C |
| 26 | `SDK_SPECIFICATION.md` | 06 | Public surface, types, errors, retries, versioning | TL-015 | C |
| 27 | `SDK_INTEGRATION_GUIDE.md` | 06 | Node/Express/Next/FastAPI examples | TL-015 | C |
| 28 | `THREAT_INTELLIGENCE_ENGINE.md` | 07 | Ingestion, normalisation, reports, confidence, abuse | TL-012, TL-019 | C |
| 29 | `AI_INVESTIGATION_ENGINE.md` | 07 | Orchestration, tools, prompts, schemas, injection defence | TL-014 | C |
| 30 | `THREAT_GRAPH.md` | 07 | 11 node types, 19 edge types, confidence, traversal | TL-013 | C |
| 31 | `DEPLOYMENT_ARCHITECTURE.md` | 08 | Render static + web service + managed Postgres | — | C |
| 32 | `ENVIRONMENT_CONFIGURATION.md` | 08 | 38 variables, validation, secret handling | — | C |
| 33 | `MONITORING_HEALTHCHECKS.md` | 08 | `/health`, `/ready`, request IDs, logs, metrics | — | C |
| 34 | `TESTING_STRATEGY.md` | 09 | Unit/integration/contract/E2E/security/demo tests | all | C |
| 35 | `SECURITY_THREAT_MODEL.md` | 09 | STRIDE, SSRF, XSS, prompt injection, residual risk | — | C |
| 36 | `DEMO_RUNBOOK.md` | 10 | 6-minute script, seed data, fallbacks, reset | TL-004…TL-020 | C |

### 1.1 Supporting documents (not part of the 36)

| Document | Purpose |
| --- | --- |
| `02-architecture/HOSTED_SERVICES.md` | Every hosted free-tier service, its limits, failure behaviour and migration path |
| `MASTER_PROMPT.md` | Paste-ready start brief: verified inventory, repo map, machine state, bring-up, scenario matrix, drift register |
| `BUILD_PROMPT.md` | Graded build brief: rubric mapping, gap register, and specs for the Web3 registry, message analysis, external intelligence, certificate depth and header posture |
| `handover/HANDOVER.md` | State at transfer, first-hour checklist, hosted services, traps, deployment runbook |
| `handover/PROGRESS_LOG.md` | Build chronology, decisions made during the build, bugs fixed |
| `handover/CONVERSATION_LOG.md` | Redacted build conversation (reference by search, not sequential reading) |
| `AGENTS.md` | Operating rules for AI coding agents working in this repo |
| `CLAUDE.md` | Claude-specific project memory: traps, conventions, commands |
| `skills/impeccable-frontend/SKILL.md` | Frontend craft standard: layout, type, colour, five-state rule, anti-slop checklist |
| `skills/design-system-guardrails/SKILL.md` | Token law, component contracts, UI review gates |

---

## 2. Canonical identifiers (consistency anchors)

These are repeated across many documents. They are defined once and referenced everywhere.

### 2.1 Decisions frozen for v1

| Anchor | Value | Owner doc |
| --- | --- | --- |
| API prefix | `/api/v1` | API_CONTRACTS §3 |
| Primary keys | ULID, stored as `CHAR(26)` | DATABASE_DESIGN §3 |
| Decision enum | `BLOCK \| WARN \| ALLOW \| REVIEW \| UNKNOWN` | API_CONTRACTS §5.2 |
| Risk levels | `CRITICAL \| HIGH \| MEDIUM \| LOW \| UNKNOWN` | API_CONTRACTS §5.2 |
| Risk score | integer `0–100` | RISK_ENGINE §5 |
| Signal groups | `reputation, identity, credential_destination, payment_destination, infrastructure` | RISK_ENGINE §4 |
| Signal weights | 30 / 25 / 20 / 15 / 10 | RISK_ENGINE §5.2 |
| Finding code format | `UPPER_SNAKE_CASE` | RISK_ENGINE §7 |
| Auth (web) | JWT access 15 min + rotating refresh 30 d, httpOnly cookie | AUTH §4 |
| Auth (machine) | API key `tl_live_…` (SDK/server) or `tl_ext_…` (extension device) | AUTH §6 |
| Backend | Single FastAPI service, one deployable | SYSTEM_ARCHITECTURE §4 |
| Database | Managed PostgreSQL 16, SQLAlchemy 2 async + Alembic | TECH_STACK §4.3 |
| Graph storage | Relational `entities` + `relationships` (no Neo4j) | THREAT_GRAPH §9 |
| Design background | `#F6F5F1` light / `#090909` dark | DESIGN_SYSTEM §2.1 |
| Demo organisation | Northstar University, `northstar-demo.example` | DEMO_RUNBOOK §3 |

### 2.2 Feature ID index

`TL-001` URL assessment · `TL-002` DNS intelligence · `TL-003` TLS & chain inspection ·
`TL-004` risk scoring & decision · `TL-005` redirect analysis · `TL-006` organisation trust
profiles · `TL-007` domain ownership verification · `TL-008` payment recipient verification ·
`TL-009` action integrity verification · `TL-010` page & form analysis · `TL-011` brand
impersonation signals · `TL-012` threat reporting · `TL-013` threat graph & campaigns ·
`TL-014` AI investigation · `TL-015` developer SDK & API keys · `TL-016` extension site status ·
`TL-017` extension action interception · `TL-018` extension reporting · `TL-019` reputation &
community propagation · `TL-020` certificate monitoring & CA incidents · `TL-021` accounts &
sessions · `TL-022` organisations & members · `TL-023` dashboard overview · `TL-024` audit &
usage logging.

Full text lives in `FEATURE_SPECIFICATIONS.md`.

---

## 3. Consistency audit results

Audited 2026-11-07 across all 38 Markdown files.

| Check | Method | Result |
| --- | --- | --- |
| Endpoint set identical in API_CONTRACTS, API_ENDPOINTS, frontend, extension, SDK | Cross-read every path string | Pass — 46 paths, one definition, linked elsewhere |
| No payload defined twice with different fields | Compare `assess`, `verify-payment`, `reports` schemas | Pass — schemas live in API_ENDPOINTS, referenced by name |
| Table names identical in DATABASE_DESIGN and all references | Grep table names | Pass — 25 tables, snake_case plural |
| Enum values identical everywhere | Grep `BLOCK`, `WARN`, `ALLOW`, `REVIEW`, `UNKNOWN` | Pass |
| Feature IDs referenced consistently | Grep `TL-0` | Pass |
| Signal weights identical (30/25/20/15/10) | RISK_ENGINE vs DEMO_RUNBOOK vs PRODUCT_REQUIREMENTS | Pass |
| Terminology: "ALLOW" never described as "safe" | Grep "safe" | Pass — REVIEW §4 of PROJECT_OVERVIEW forbids it |
| Health endpoints: `/health`, `/ready`, `/api/v1/health` | DEPLOYMENT vs MONITORING vs API_ENDPOINTS | Pass |
| No simulated incident presented as real | DEMO_RUNBOOK vs THREAT_INTELLIGENCE_ENGINE | Pass — `simulated: true` required |
| No files created outside `docs/` | Filesystem listing | Pass |
| Mermaid blocks syntactically valid | Manual review of 24 diagrams | Pass |
| Internal links resolve | Manual path check | Pass |

---

## 4. Known gaps (deliberate, scoped)

| Area | Gap | Reason | Tracked in |
| --- | --- | --- | --- |
| Certificate Transparency | No live CT log poller in MVP; schema and interface defined | Cost + rate limits | TL-020, ROADMAP §5 |
| Visual brand similarity | Deterministic perceptual-hash + logo-hash only; no trained embedding model | Scope | TL-011 |
| Payment verification | UPI VPA / IBAN syntax + profile matching only; no PSP API integration | No PSP access | TL-008 |
| Active vulnerability scanning | Out of scope entirely for arbitrary sites | Safety | SECURITY_THREAT_MODEL §6 |
| Background workers | No Celery/BullMQ; in-process tasks + QStash cron; Redis is cache/limits only | Cost + ops | BACKEND_OVERVIEW §9 |
| MCP server | Designed as FUTURE, not implemented | Scope | ROADMAP §6 |
| Email delivery | Interface defined; MVP logs invites instead of sending | No provider | OPEN QUESTION Q-4 |

---

## 5. Open questions

| ID | Question | Owner | Default until decided |
| --- | --- | --- | --- |
| Q-1 | Do we allow unauthenticated public scanning, and with what rate limit? | Product | Allow 5 scans/hour/IP, extension-grade depth only |
| Q-2 | Should the extension fail open or closed on API timeout? | Security | Fail open with a visible "not checked" state |
| Q-3 | Retention period for raw page snapshots | Security/Legal | 30 days, then evidence-only |
| Q-4 | Transactional email provider | Infra | Log invite links to server log in MVP |
| Q-5 | Do analysts need a separate review queue role, or is `analyst` enough? | Product | `analyst` role only |
| Q-6 | Multi-tenant billing | Product | FUTURE, no billing code |
| Q-7 | Do we persist full redirect bodies or headers only? | Security | Headers + URL + status only |
| Q-8 | Is a hosted status page needed for the demo? | Infra | No; `/ready` is enough |

---

## 6. Change control

Any change to an anchor in §2 requires:

1. An ADR entry appended to `SYSTEM_ARCHITECTURE.md` §13.
2. A single PR that updates **every** document containing the anchor.
3. A note in the PR description listing the documents touched and the grep you ran to find them
   (for example `rg "30 / 25 / 20 / 15 / 10"`).

Documentation drift is treated as a defect of the same severity as a failing test.


## Addendum — problem-statement build (2026-11-09)

| Area | Owning document | Code | Tests |
| --- | --- | --- | --- |
| Web3 report registry (ADR-018) | `02-architecture/WEB3_REGISTRY.md` | `packages/contracts`, `app/services/{anchors,chain}.py`, `app/api/routes/anchors.py` | contract 9, `test_web3.py`, `test_anchors_db.py`, `verify.test.tsx` |
| Message analysis, O-8…O-10 | `03-backend/MESSAGE_ANALYSIS.md`, `RISK_ENGINE.md` §7.7, §8.1a | `app/services/message_analysis.py`, `app/api/routes/messages.py`, `app/agents/message_narrative.py` | `test_messages.py`, `test_messages_db.py`, `messages.test.tsx` |
| External intelligence | `02-architecture/THREAT_INTELLIGENCE_SOURCES.md` | `app/intelligence/feeds.py` | `test_cert_intel_posture.py` |
| Certificate depth, report, header posture | `03-backend/CERTIFICATE_ANALYSIS.md`, `RISK_ENGINE.md` §7.5, §7.8, §8.5a–b | `app/services/certificates.py`, `app/risk/posture.py` | `test_cert_intel_posture.py`, `trust-reports.test.tsx` |
| Risk classes | `RISK_ENGINE.md` §8.7 | `app/risk/classes.py`, SDK `normaliseRiskClass` | `test_messages.py`, SDK test |
| Evidence | `evidence/` (generated) | `app/scripts/{evidence_run,chain_evidence}.py`, contracts `replay`/`verify-report` | the scripts themselves |

Consistency notes: endpoint count is now 69 active (71 numbered rows, three delegated to Clerk);
Alembic head `c5a0intel0001`; engine `1.1.0`. `MASTER_PROMPT.md` §14 drift rows are all closed.
