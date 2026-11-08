# PROJECT_OVERVIEW

> **Status:** DECIDED · **Group:** 00-project-foundation · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** vision, problem statement, scope, non-goals, terminology, success criteria.
> **Related:** [`TECH_STACK.md`](TECH_STACK.md) · [`../01-product/PRODUCT_REQUIREMENTS.md`](../01-product/PRODUCT_REQUIREMENTS.md) · [`../02-architecture/SYSTEM_ARCHITECTURE.md`](../02-architecture/SYSTEM_ARCHITECTURE.md)

---

## 1. Purpose of this document

This is the first document every contributor reads. It explains **what TrustLens is**, **why it
exists**, **what it deliberately is not**, and **which words mean what**. It does not contain
implementation details; those belong to the architecture and backend groups.

If you disagree with a paragraph here, you are disagreeing with the product, not with a detail.
Raise it with an ADR (see `SYSTEM_ARCHITECTURE.md` §13) rather than quietly building something else.

---

## 2. The problem

### 2.1 The padlock is not an identity

A TLS certificate proves that traffic is encrypted and that *somebody* controls a private key for
the name being visited. It says nothing about **who** is behind that name. `apply.northstar-
admissions.example` can hold a perfectly valid certificate, issued by a trusted CA, for its own
name, and still be operated by a fraudster.

Users have been trained to read the padlock as a trust signal. Attackers exploit that training.

### 2.2 The attack that existing scanners miss

Consider an attack seen repeatedly in education and recruitment fraud:

1. A lookalike domain is registered: `apply.northstar-university-admissions.example`.
2. The site copies the real university's branding, hero copy, and application flow.
3. A valid DV certificate is issued automatically minutes after registration — HTTPS "works".
4. A registration form collects name, email, phone, and a password.
5. Submission posts credentials to an unrelated host the attacker controls.
6. An "application fee" step asks for a UPI transfer to a personal VPA.
7. Two other sites — a fake scholarship portal and a fake placement portal — share the same
   nameservers, the same hosting block, and the same payment recipient.

Every individual indicator is ambiguous. The padlock is green. The certificate is valid. The
domain is not on any blocklist because it is four days old. A URL-reputation scanner returns
"no known threat" — which users read as "safe". The campaign is only visible when you connect
**identity**, **infrastructure**, **cryptographic trust** and **the action being requested**.

### 2.3 Failure of the four usual silos

| Layer | What is checked today | What is missed |
| --- | --- | --- |
| Identity | Domain string, sometimes WHOIS age | Whether the domain is *authorised* by the organisation it imitates |
| Infrastructure | IP reputation, blocklists | Shared hosting/nameserver/certificate relationships across a campaign |
| Cryptographic trust | Certificate validity and expiry | Whether the issuer chain itself is still trustworthy, and which assets depend on it |
| Application behaviour | Sometimes form/DOM heuristics | Where credentials and money are actually sent, versus where they should go |

TrustLens is built on the claim that these four layers must be **joined per interaction**, not
assessed independently.

---

## 3. The solution

**TrustLens verifies whether a website is authorised to perform the action it is asking the user
to perform, and explains the evidence.**

Three connected capabilities:

1. **Verify identity and authorisation.** Organisations publish a *Trust Profile*: official
   domains, login endpoints, payment recipients, approved subdomains. A site claiming to be that
   organisation is compared against the profile.
2. **Verify the action.** For a login, payment, or data-submission action, TrustLens compares the
   *actual destination* (form action, redirect target, payee) against the profile — not the
   page's visual identity.
3. **Verify the surrounding infrastructure and explain it.** DNS, RDAP age, TLS chain, redirect
   chain, hosting relationships and community reports are correlated into a graph; a
   deterministic engine produces the verdict, and an AI investigator explains it in prose with
   citations to structured evidence.

### 3.1 The one-sentence differentiator

> A valid certificate answers "is this connection encrypted?". TrustLens answers "is this website
> authorised to ask for this password, this payment, or this data?".

### 3.2 Where the verdict comes from

**DECIDED — non-negotiable engineering rule.** The blocking decision is produced by a
deterministic, testable rule engine over collected evidence (`RISK_ENGINE.md`). The language model
never sets a verdict, never invents a finding, and never marks a site as safe. It receives
structured findings and writes an explanation. See `AI_INVESTIGATION_ENGINE.md` §7.

---

## 4. Terminology (normative)

These words have exactly one meaning in TrustLens. Using them loosely is a documentation defect.

| Term | Definition |
| --- | --- |
| **Assessment** | One evaluation of a URL (optionally scoped to an organisation and an intent), producing findings, a score and a decision. |
| **Scan** | The persisted record of an assessment, addressable by ID. "Scan" and "assessment" refer to the same object; the API resource is `/scans`. |
| **Intent** | What the user is about to do: `browse`, `login`, `payment`, `download`, `data_submission`. Changes which rules apply. |
| **Finding** | A single, evidence-backed observation with a stable code (e.g. `PAYEE_NOT_IN_VERIFIED_PROFILE`), a severity, a signal group, and a source. |
| **Evidence** | The raw, timestamped artefact a finding cites (DNS answer, certificate PEM digest, form action string, report ID). |
| **Signal group** | One of five scoring buckets: `reputation`, `identity`, `credential_destination`, `payment_destination`, `infrastructure`. |
| **Risk score** | Integer 0–100 from the weighted rule engine. An engineering heuristic, **not** a probability. |
| **Risk level** | Band derived from the score: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`. |
| **Decision** | The action recommended to a client: `BLOCK`, `WARN`, `ALLOW`, `REVIEW`, `UNKNOWN`. |
| **ALLOW** | "No known threat was found **within the checks that actually ran**." It is *not* a claim that the site is safe, and UI copy must never render it as "Safe" or "Verified". |
| **UNKNOWN** | Evidence was insufficient or a critical check failed. Distinct from `ALLOW`. |
| **REVIEW** | Signals conflict or coverage is too low for an automated decision; a human or a deeper scan should look. |
| **Coverage** | Which signal groups actually produced results. Reported alongside every decision; a decision without coverage is meaningless. |
| **Confidence** | 0.0–1.0 certainty in a *finding or edge*, separate from severity. A high-severity finding can be low-confidence. |
| **Trust Profile** | An organisation's verified record: domains, login endpoints, payment recipients, support contacts. |
| **Verified** | Backed by a completed verification step (DNS TXT, file challenge, recipient attestation) recorded in the audit trail. |
| **Claimed identity** | What a page asserts about itself (logo, title, "Official portal of X"). Untrusted until matched to a profile. |
| **Threat report** | A user- or analyst-submitted claim about a URL, with evidence, that enters review. Not a verdict. |
| **Campaign** | A cluster of entities the correlation engine believes belongs to one operation, with a confidence score. |
| **Entity** | A graph node: domain, URL, IP, ASN, nameserver, certificate, organisation, brand, payment recipient, campaign. |
| **Relationship** | A typed, evidenced, confidence-scored graph edge (e.g. `RESOLVES_TO`, `SHARES_NAMESERVER_WITH`). |
| **Investigation** | An AI-assisted, evidence-cited narrative report over an existing scan/graph. Additive; never authoritative. |
| **Simulated** | Demo-only data explicitly flagged `simulated: true`, including the CA incident scenario. |

---

## 5. Product surfaces

| Surface | Path in monorepo | Primary job | Primary users |
| --- | --- | --- | --- |
| Public website | `apps/web` (public routes) | Explain the product, run a public check, convert to signup | Everyone |
| Application dashboard | `apps/web` (`/app/*`) | Investigate, manage profiles, review reports, monitor certificates | Analysts, org admins |
| Browser extension | `apps/extension` | Protect at the moment of interaction; warn; report | End users |
| Developer SDK | `packages/sdk` | Embed trust checks in other products | Developers |
| HTTP API | `apps/api` | The single source of every verdict | All surfaces |
| MCP server | — | FUTURE: expose checks to external AI agents | AI builders |

There is exactly **one** verdict-producing backend. The extension, dashboard, SDK and public
checker all call the same endpoints and receive the same schema. This is the central architectural
constraint that keeps the demo coherent (`SYSTEM_ARCHITECTURE.md` §3, ADR-001).

---

## 6. Target users

| User | Core need | Surface |
| --- | --- | --- |
| Individual internet user / student | "Is this admissions or payment page real?" | Extension, public checker |
| Developer | "Block fraudulent links and payees in my app" | SDK/API |
| Organisation administrator (university, fintech, marketplace) | "Publish and protect our official domains and payees" | Dashboard |
| Security analyst | "Investigate this URL and its infrastructure" | Dashboard |
| Threat investigator / researcher | "Find the campaign behind these sites" | Dashboard + graph |
| Platform operator (us) | "Keep the thing up, safe and honest" | Infra + audit logs |

Personas with goals, frustrations and permissions: `../01-product/USER_PERSONAS.md`.

---

## 7. MVP boundaries

### 7.1 In scope (MVP)

- URL assessment with DNS, RDAP, TLS/chain, redirects, headers and page/form analysis (TL-001…TL-005, TL-010).
- Deterministic risk engine with five signal groups, finding codes, coverage reporting (TL-004).
- Organisation Trust Profiles with DNS-TXT and file-challenge domain verification (TL-006, TL-007).
- Payment recipient verification against a verified profile (TL-008).
- Action Integrity Verification for login and payment intents (TL-009).
- Heuristic brand-impersonation signals: token similarity, logo perceptual hash, favicon hash (TL-011).
- Threat reporting with evidence, analyst review, and confidence-gated propagation (TL-012, TL-019).
- Threat graph over relational tables + Cytoscape visualisation, campaign clustering (TL-013).
- AI investigation producing an evidence-cited report (TL-014).
- Chrome MV3 extension: site status, action warnings, report button (TL-016…TL-018).
- TypeScript SDK with `assess`, `verifyIdentity`, `verifyPayment`, `inspectRedirect`, `reportThreat` (TL-015).
- Certificate inventory, expiry monitoring, issuer dependency mapping, **simulated** CA incident (TL-020).
- Accounts, org membership, API keys, audit log (TL-021, TL-022, TL-024).
- Dashboard overview, scan report, graph, campaigns, organisations, certificates, reports, settings (TL-023).

### 7.2 Explicit non-goals (MVP)

| Non-goal | Why |
| --- | --- |
| Being an antivirus or endpoint agent | Different problem, different data |
| Active vulnerability scanning of third-party sites | Unsafe without authorisation; legally fraught |
| Guaranteeing a site is safe | Impossible; we report coverage, not certainty |
| A trained phishing classifier as the core product | Weak moat, needs data we do not have |
| Blockchain-based reporting | Adds cost, no benefit |
| Neo4j / Kafka / Celery / Kubernetes | Operational cost with no MVP payoff |
| Mobile app, WhatsApp bot | Split focus; extension + SDK first |
| Payments processing | We verify recipients; we never move money |
| Real CA compromise adjudication | We model dependency and incident impact; we do not declare CAs distrusted |

### 7.3 Explicitly rejected ideas

Recorded so they are not re-proposed every sprint:

1. **A chatbot that explains phishing.** Not differentiated; the investigator is grounded in evidence instead.
2. **A multi-agent swarm.** One orchestrator with tools is debuggable; a swarm is not.
3. **A green "SAFE" badge.** Replaced by `ALLOW` + coverage statement.
4. **Crowd voting on whether a URL is bad.** Replaced by evidence-weighted, review-gated reports.
5. **Storing submitted passwords/OTPs to "analyse" them.** Never. We record the *destination*, not the secret.

---

## 8. Constraints

| Constraint | Consequence |
| --- | --- |
| Hackathon timeline (days, not months) | One backend, one database, no queue infrastructure; synchronous-ish scans with polling |
| Free-tier hosting | Backend cold starts; no persistent local disk; frontend must be static |
| No commercial threat-feed budget | Reputation is derived from our own data + optional free/owned sources, and must degrade honestly to `UNAVAILABLE` |
| No paid AI requirement to demo | AI investigation must degrade to a template-rendered report when no key is configured |
| Legal/ethical | Only scan URLs submitted by users or owned by us; never touch private ranges; demo forms inert |
| Team of 4–5 | Clear module ownership; shared contracts frozen early |

Details: `TECH_STACK.md` §9 and `../08-infrastructure/DEPLOYMENT_ARCHITECTURE.md`.

---

## 9. Success criteria

### 9.1 Product success (demo)

1. A judge opens a convincing lookalike portal over HTTPS, and TrustLens warns **before** the
   payment action completes, naming the specific mismatch (payee not in profile).
2. The same URL investigated by the AI produces a report where every claim links to a finding.
3. Three seeded lookalike sites appear as one campaign in the graph.
4. A report submitted from one browser profile produces a warning in a second profile.
5. A **clearly labelled simulated** CA incident lists the monitored domains that depend on the
   affected issuer.

### 9.2 Engineering success

| Metric | Target |
| --- | --- |
| `POST /api/v1/scans` p50 (cached domain, 3 probe budget) | ≤ 8 s |
| `POST /api/v1/assess` on cached entity | ≤ 400 ms |
| Extension verdict cache TTL | 10 min per URL, 24 h per organisation profile |
| Contract tests covering documented endpoints | 100% of endpoints in `API_ENDPOINTS.md` |
| Tests covering risk rules | 100% of `R-*` rule IDs have at least one unit test |
| Cold start recovery | `/ready` returns 200 within 60 s of first request |
| SSRF test suite | All private/metadata targets rejected (see `09-testing-security`) |

### 9.3 Anti-metrics (we will not optimise these)

- Number of URLs "cleared".
- Model confidence as a marketing number.
- Number of blocks, if achieved by lowering thresholds and increasing false positives.

---

## 10. Long-term vision (FUTURE)

1. **Trust infrastructure for AI agents.** An MCP server exposing `verify_website`,
   `verify_organisation`, `verify_payment_recipient`, `investigate_threat` so browser agents can
   check before they act.
2. **Verified organisation registry at scale.** The durable asset: a registry of organisations,
   their authorised domains and their authorised payees.
3. **Campaign intelligence network.** Cross-organisation, cross-tenant correlation with
   evidence-backed sharing.
4. **Certificate trust operations.** Dependency mapping and impact reporting for issuer incidents.

The moat is the registry + graph + distribution, not the model.

---

## 11. Key decisions and their consequences

| Decision | Consequence |
| --- | --- |
| One FastAPI backend instead of Node + Python services | One deploy, one contract, one cold start; Python owns scanning and orchestration |
| Deterministic verdict, AI explanation | Testable, explainable, demo-safe; AI cannot be blamed for a wrong block |
| Relational graph instead of Neo4j | Cheaper, simpler, good enough to depth 3; heavier recursive SQL |
| `ALLOW` ≠ safe; coverage always shown | Honest product; more UI copy to write; judges must be told explicitly |
| Extension observes, server decides | No secret-sauce in the client; needs network; fail-open behaviour documented |
| In-process bounded async tasks, no Celery | Simple deploy; scans capped at 60 s; no retry queue beyond one attempt |

---

## 12. Glossary of external references

| Thing | Why it matters to us |
| --- | --- |
| Certificate Transparency (RFC 6962) | Issuance history for a domain; basis of TL-020 monitoring design |
| RDAP (RFC 9083) | Registration age and registrar data without WHOIS scraping |
| UPI VPA | Indian payment address format `localpart@handle`; our demo payment identifier |
| SSRF / DNS rebinding | The two ways our own scanner could be turned into an attack tool |
| Manifest V3 | Chrome extension platform; service worker + declarative permissions |
| WCAG 2.1 AA | Accessibility target for all UI |

---

## 13. Related documents

- Stack and trade-offs → [`TECH_STACK.md`](TECH_STACK.md)
- Requirements with IDs → [`../01-product/PRODUCT_REQUIREMENTS.md`](../01-product/PRODUCT_REQUIREMENTS.md)
- Feature catalogue → [`../01-product/FEATURE_SPECIFICATIONS.md`](../01-product/FEATURE_SPECIFICATIONS.md)
- How it is built → [`../02-architecture/SYSTEM_ARCHITECTURE.md`](../02-architecture/SYSTEM_ARCHITECTURE.md)
- Why verdicts are trustworthy → [`../03-backend/RISK_ENGINE.md`](../03-backend/RISK_ENGINE.md)
- Ethical limits → [`../09-testing-security/SECURITY_THREAT_MODEL.md`](../09-testing-security/SECURITY_THREAT_MODEL.md)
