# PRODUCT_ROADMAP

> **Status:** DECIDED (MVP scope) / PROPOSED (later phases) · **Group:** 01-product · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** release phases, sequencing, release criteria, risks.
> **Related:** [`FEATURE_SPECIFICATIONS.md`](FEATURE_SPECIFICATIONS.md) · [`../10-hackathon-demo/DEMO_RUNBOOK.md`](../10-hackathon-demo/DEMO_RUNBOOK.md) · [`../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md`](../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md)

---

## 1. Phase overview

| Phase | Name | Duration (indicative) | Exit criterion |
| --- | --- | --- | --- |
| 0 | Contracts & skeleton | 1 day | Docs frozen; repo builds; `/health` deployed |
| 1 | Assessment core | 2 days | `POST /scans` produces real findings on 3 real URLs |
| 2 | Action integrity | 1.5 days | Payee/login mismatch blocks the demo lookalike |
| 3 | Dashboard | 2 days | Scan, report, graph, org screens usable |
| 4 | Extension + SDK | 1.5 days | Extension blocks demo payment; SDK returns typed verdict |
| 5 | Intelligence + AI | 2 days | Campaign cluster + grounded narrative |
| 6 | Hardening + demo | 1.5 days | Two clean rehearsals, fallbacks tested |

Phases overlap; the ordering reflects **what blocks what**, not a strict waterfall. Parallelisable
work is marked in §3.

---

## 2. Phase 0 — Contracts and skeleton

**Goal.** Freeze the shared surface so four people can work without colliding.

Deliverables:

- `docs/` complete for groups 00–02 (this documentation set).
- Monorepo skeleton: `apps/web`, `apps/api`, `apps/extension`, `packages/{sdk,shared-types}`.
- `render.yaml`, `.env.example`, `docker-compose.yml`, CI workflow.
- `GET /health`, `GET /ready`, `GET /api/v1/health` implemented and deployed.
- OpenAPI generation wired; `packages/shared-types` generated.
- Design tokens landed in `globals.css` + Tailwind config; two sample screens using them.

Exit criteria: deployed `/health` returns 200; `/ready` returns 503 with a reason when the DB is
unreachable; a PR containing a field rename fails the OpenAPI drift check.

**Blocking risks.** Render service creation, DB provisioning, DNS for the demo domains.

---

## 3. Phase 1 — Assessment core (TL-001…TL-005, TL-010)

| Work | Owner | Parallel with |
| --- | --- | --- |
| URL normalisation + SSRF guard + tests | Backend | DNS/RDAP module |
| DNS + RDAP collectors | Scanner | TLS collector |
| TLS collector + chain parsing | Scanner | DNS collector |
| Redirect analyser | Scanner | Page analyser |
| Page/form analyser (static) | Scanner | Risk engine |
| Risk engine v1 + rule tests | Risk owner | Collectors |
| Persistence: scans, findings, entities, relationships | Backend | UI shell |
| Scan polling UI + report screen shell | Frontend | Backend |

Exit criteria:

- Three real URLs (a known-good site, a parked domain, the demo lookalike) produce sensible findings.
- Every collector degrades to `UNAVAILABLE` cleanly when its dependency is blocked.
- A single scan never exceeds 60 s.
- The scan report screen renders real findings with evidence.

---

## 4. Phase 2 — Action integrity (TL-006…TL-009, TL-011)

| Work | Owner |
| --- | --- |
| Trust profile CRUD + audit | Backend |
| DNS TXT / file challenge verification | Backend |
| Recipient attestation flow | Backend + Frontend |
| Payee extraction + verification | Scanner + Backend |
| Login destination comparison | Scanner |
| Brand claim + logo hash similarity | Scanner |
| Org management screens | Frontend |
| Seed script with Northstar demo data | Backend |

Exit criteria:

- Verify the demo domain via a real TXT record in the demo DNS zone.
- `POST /verify-payment` returns `exact` for the registered payee and `none` for the lookalike's.
- `POST /assess` with `intent = payment` on the lookalike returns `BLOCK` with
  `PAYEE_NOT_IN_VERIFIED_PROFILE`.

---

## 5. Phase 3 — Dashboard (TL-023, TL-012 read paths)

Screens: overview, scan list, scan report, intelligence, campaigns, organisations, certificates,
reports, settings, developers. Design system applied; empty/loading/error states for every list.
Keyboard navigation and focus rings per `../04-frontend/ACCESSIBILITY_RESPONSIVENESS.md`.

Exit criteria: a new user can sign up, run a scan, open the report, and reach the graph in under
90 seconds without instructions.

---

## 6. Phase 4 — Extension and SDK (TL-015…TL-018)

| Work | Owner |
| --- | --- |
| MV3 scaffold, service worker, cache | Extension |
| Content script form/payment observation | Extension |
| Overlay + popup UI (token-driven) | Extension + Frontend |
| Device pairing flow | Backend + Extension |
| `trustlens-sdk` + typed errors | SDK |
| API key management UI | Frontend |
| Developer docs page with live examples | Frontend + SDK |

Exit criteria: the demo payment is intercepted in a clean Chrome profile; the SDK example in the
docs runs as written against the deployed API.

---

## 7. Phase 5 — Intelligence and AI (TL-013, TL-014, TL-019, TL-020)

| Work | Owner |
| --- | --- |
| Graph traversal endpoint + caps | Backend |
| Cytoscape view, filters, edge drawer | Frontend |
| Campaign clustering + persistence | Intelligence |
| Report review + reputation | Backend + Intelligence |
| Investigation orchestrator + tool steps | AI |
| Prompt + schema + validation + template fallback | AI |
| Certificate inventory + expiry + issuer mapping | Backend |
| Simulated incident endpoint + UI | Backend + Frontend |

Exit criteria: three seeded lookalikes cluster at confidence ≥ 0.6; an investigation produces ≥ 5
referenced claims; the simulated incident lists the correct affected domains.

---

## 8. Phase 6 — Hardening and demo

- SSRF suite green, including redirect-hop and IPv6 cases.
- Rate limits exercised; 429 copy reviewed.
- Cold-start behaviour measured and documented.
- Two full rehearsals with the timer; fallbacks triggered deliberately.
- `DEMO_RUNBOOK.md` updated to match what actually works.

Exit criteria: the demo runs clean twice in a row, and once with the network deliberately degraded.

---

## 9. Post-hackathon (v0.2 → v1.0)

| Version | Theme | Contents |
| --- | --- | --- |
| 0.2 | Depth | Playwright deep scans on demand; DOM-similarity clustering; certificate change alerts via email/interfaces |
| 0.3 | Trust registry | Public organisation directory; badge/embed widget; appeal workflow; verification re-attestation |
| 0.4 | Distribution | Chrome Web Store listing; SDK for Python; webhook delivery for confirmed threats |
| 0.5 | Operations | CT log ingestion (rate-limited), issuer advisory ingestion, analyst queues, SLA metrics |
| 1.0 | Platform | Multi-tenant billing, SSO, SIEM export, MCP server, regional deployment |

Each version requires: documentation updated first, contract tests, migration plan, rollback plan.

---

## 10. Future / explicitly deferred

| Item | Why deferred | Revisit when |
| --- | --- | --- |
| MCP server for AI agents | No consumer yet; needs stable tool schema | After SDK v1 |
| Trained phishing classifier | Needs labelled data we do not own | 10k+ confirmed labels |
| Neo4j | SQL CTE sufficient at depth ≤ 3 | Graph queries exceed 2 s at depth 3 |
| Real-time CT streaming | Cost + volume | Paid tier or partner feed |
| Mobile SDK | No demand validated | After 3 SDK integrations |
| Payment provider integrations | No PSP partnership | First fintech pilot |
| Multi-region | Single region is fine at this scale | Latency complaints outside India |

---

## 11. Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Free-tier cold start on demo day | Demo stalls | High | Static frontend; warm-up routine; loading copy; local fallback recording |
| Playwright memory on 512 MB | OOM kills API | Medium | Disabled by default; semaphore 1; hard timeouts |
| LLM provider outage | No narrative | Medium | Template report path, exercised in tests |
| Demo domain not reachable | No walkthrough | Low | Two DNS providers; local hosts fallback; screenshots as last resort (labelled) |
| SSRF bypass | Reputational/legal | Low | Dedicated test suite; allowlist resolution; no user-controlled proxies |
| False positive on a real org | Trust damage | Medium | Coverage-gated decisions; appeal flow; conservative payee rules |
| Report brigading | Wrong blocks | Medium | Distinct-reporter threshold; analyst confirmation; rate limits |
| Scope creep into active scanning | Legal exposure | Medium | Docs explicitly exclude; PR checklist asks |
| Solo-owner bottleneck on contracts | Integration breakage | Medium | Contracts frozen in Phase 0; drift check in CI |

---

## 12. Release criteria (every release)

1. All P0 acceptance criteria for the phase met.
2. `lint`, `typecheck`, unit tests, contract tests green on a clean clone.
3. Migrations forward-tested on a copy of the current schema.
4. `/ready` reflects real dependency state.
5. Documentation updated for every contract change.
6. Demo path re-rehearsed if the release touches assessment, extension or investigation.
7. No new external dependency without a note in `TECH_STACK.md`.
