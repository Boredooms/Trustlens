# PRODUCT_REQUIREMENTS

> **Status:** DECIDED · **Group:** 01-product · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** functional requirements (`FR-*`), non-functional requirements (`NFR-*`), roles, business rules, MVP acceptance.
> **Related:** [`FEATURE_SPECIFICATIONS.md`](FEATURE_SPECIFICATIONS.md) · [`../03-backend/RISK_ENGINE.md`](../03-backend/RISK_ENGINE.md) · [`../09-testing-security/SECURITY_THREAT_MODEL.md`](../09-testing-security/SECURITY_THREAT_MODEL.md)

---

## 1. Scope

This document states **what the system must do** and **how well**, independent of implementation.
Each requirement is testable. Features map to requirements; the catalogue lives in
`FEATURE_SPECIFICATIONS.md`.

Requirement ID scheme:

- `FR-###` functional requirement.
- `NFR-###` non-functional requirement.
- `BR-###` business rule (a constraint that applies across features).
- Priority: **P0** = demo fails without it, **P1** = required for a credible product, **P2** = should
  have, **P3** = future.

---

## 2. Actors and roles

| Role | Description | Authentication |
| --- | --- | --- |
| `anonymous` | Visitor; may use the public checker within limits | none |
| `user` | Registered account; owns scans, reports, API keys | session |
| `analyst` | Reviews reports, confirms/dismisses, edits entity verdicts | session + role |
| `org_admin` | Manages one organisation's Trust Profile and members | session + membership |
| `org_member` | Read access to the organisation and its alerts | session + membership |
| `service` | Machine client using an API key (SDK, server integration) | API key |
| `extension_device` | Paired browser extension instance | device token |
| `operator` | TrustLens staff; may run the demo seed and simulated incidents | session + `operator` flag |

Authorisation model and permission matrix: `../03-backend/AUTHENTICATION_AUTHORIZATION.md` §5.

---

## 3. Functional requirements

### 3.1 Assessment

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-001 | The system shall accept a URL, validate its syntax and scheme, and reject non-HTTP(S) schemes with a specific error code. | P0 |
| FR-002 | The system shall normalise the URL (lowercase host, strip default ports, punycode the host, drop fragments, preserve query) before any analysis. | P0 |
| FR-003 | The system shall collect DNS records (A, AAAA, CNAME, NS, MX, TXT) for the registrable domain and report each record with a timestamp. | P0 |
| FR-004 | The system shall collect registration data via RDAP (registrar, creation date, last change, status) where available. | P1 |
| FR-005 | The system shall retrieve the TLS certificate chain, validate it with a standard verifier, and record subject, SANs, issuer, validity window, key type/size, signature algorithm, and SHA-256 fingerprints. | P0 |
| FR-006 | The system shall follow the HTTP redirect chain manually, validating each hop against the SSRF policy, and record URL, status and location per hop. | P0 |
| FR-007 | The system shall fetch the final document within size and time limits and analyse static DOM for forms, form actions, password inputs, external scripts, iframes and payment identifiers. | P0 |
| FR-008 | When deep scanning is enabled, the system shall render the page in a sandboxed headless browser and record JS-injected forms and client-side redirects. | P2 |
| FR-009 | The system shall compute domain-age, entropy and brand-token similarity signals against registered organisation domains. | P1 |
| FR-010 | The system shall match a page's claimed brand (title, logo hash, favicon hash, brand tokens) against known organisation profiles and report similarity with a confidence. | P1 |
| FR-011 | The system shall retrieve prior assessments for the same registrable domain and reuse non-volatile results within their TTL. | P1 |
| FR-012 | The system shall return findings, a score, a risk level, a decision, and a coverage report for every completed assessment. | P0 |
| FR-013 | The system shall never treat a failed check as a passing check. | P0 |
| FR-014 | The system shall persist every assessment with its evidence and make it retrievable by ID. | P0 |

### 3.2 Action integrity

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-020 | The system shall accept an `intent` (`browse`, `login`, `payment`, `download`, `data_submission`) that selects the applicable rule set. | P0 |
| FR-021 | For `login`, the system shall compare the observed form action origin (and any script-driven submission target it can observe statically) with the organisation's approved login endpoints. | P0 |
| FR-022 | For `payment`, the system shall extract candidate payment recipients (UPI VPA, IBAN, card-form presence, external payment links) and compare them with verified recipients. | P0 |
| FR-023 | The system shall report a mismatch as a distinct finding code with the observed and expected values. | P0 |
| FR-024 | The system shall verify a payment recipient on demand (`verify-payment`) independently of a full scan. | P0 |
| FR-025 | The system shall verify an organisation identity claim on demand (`verify-identity`) for a domain. | P0 |
| FR-026 | If no Trust Profile exists for the claimed organisation, the system shall report `IDENTITY_CLAIM_UNVERIFIABLE` rather than assuming legitimacy or fraud. | P0 |
| FR-027 | A verified action mismatch shall be sufficient for a `BLOCK` decision without additional evidence. | P0 |

### 3.3 Organisation trust

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-030 | An `org_admin` shall be able to create an organisation and add candidate domains. | P0 |
| FR-031 | Domain verification shall require proof of control: a DNS TXT record or an HTTPS-hosted file at a well-known path. | P0 |
| FR-032 | Unverified domains shall never be used to authorise an action. | P0 |
| FR-033 | An `org_admin` shall be able to add payment recipients; recipients require a separate attestation step before becoming `verified`. | P0 |
| FR-034 | The system shall record every profile change in an immutable audit log with actor, time, and before/after values. | P0 |
| FR-035 | The system shall support revoking a domain or recipient, after which it is no longer authoritative. | P1 |
| FR-036 | The system shall expose the public portion of a profile (domains, login hostnames, recipient handles) for verification clients. | P0 |

### 3.4 Reporting and intelligence

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-040 | A `user` or extension device shall be able to submit a threat report for a URL with optional justification and automatic technical evidence. | P0 |
| FR-041 | A single unconfirmed report shall never produce a global block. | P0 |
| FR-042 | Reports shall be deduplicated per (reporter, normalised URL) within 24 h. | P1 |
| FR-043 | An `analyst` shall be able to confirm or dismiss a report; only confirmed reports raise entity reputation. | P0 |
| FR-044 | Confirmed reports shall create or reinforce graph relationships between the reported URL/domain and its infrastructure. | P0 |
| FR-045 | The system shall cluster entities into campaigns using shared-infrastructure edges and report a cluster confidence. | P1 |
| FR-046 | The system shall expose a graph query for an entity to a configurable depth (1–3) with node/edge caps. | P0 |
| FR-047 | The system shall not display a campaign as "confirmed" when its confidence is below the documented threshold. | P1 |

### 3.5 Investigation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-050 | The system shall create an investigation from an existing scan, run the deterministic tool set, and store each step with its inputs and outputs. | P0 |
| FR-051 | The AI narrative shall only reference finding IDs and entity IDs supplied in the tool results. | P0 |
| FR-052 | Every claim in the narrative shall be traceable to at least one stored evidence reference. | P0 |
| FR-053 | When no LLM is configured or the call fails, the system shall produce a deterministic template report and mark it `ai.generated = false`. | P0 |
| FR-054 | Investigations shall be rate-limited per user and per day. | P1 |

### 3.6 Certificates

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-060 | The system shall record a certificate inventory per monitored domain at each scan. | P0 |
| FR-061 | The system shall flag expiry within 30/14/7 days and certificate changes (fingerprint) since the previous observation. | P1 |
| FR-062 | The system shall map monitored domains to issuing intermediate and root CAs. | P0 |
| FR-063 | The system shall support a **simulated** CA incident affecting a named issuer and list affected monitored domains. | P0 |
| FR-064 | Simulated incidents and their impacts shall be visibly labelled as simulated everywhere they appear. | P0 |

### 3.7 Accounts, access, developer surface

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-070 | Users shall register and log in with email + password; sessions use a short-lived access token and rotating refresh token. | P0 |
| FR-071 | Users shall create, list and revoke API keys with scopes and a visible prefix. | P0 |
| FR-072 | API keys shall be shown in full exactly once, at creation. | P0 |
| FR-073 | The system shall expose an OpenAPI document and serve a typed SDK generated from it. | P0 |
| FR-074 | The extension shall pair to an account using a short-lived code and receive a device token. | P0 |
| FR-075 | The system shall rate-limit per identity and per IP and return `429` with `Retry-After`. | P1 |
| FR-076 | The system shall record audit events for auth, key management, profile changes and analyst actions. | P0 |

### 3.8 Dashboard

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-080 | The dashboard shall present a scan input, recent scans, high-risk findings, certificate alerts and campaign discoveries. | P0 |
| FR-081 | Every scan report shall show findings grouped by signal group with expandable evidence. | P0 |
| FR-082 | The graph view shall support filtering by node type and edge confidence. | P1 |
| FR-083 | All lists shall have defined empty, loading and error states. | P0 |
| FR-084 | The UI shall display coverage alongside every decision. | P0 |

---

## 4. Non-functional requirements

### 4.1 Performance

| ID | Requirement |
| --- | --- |
| NFR-001 | `POST /api/v1/scans` returns `202` with an ID in ≤ 1.5 s at p95, excluding cold start. |
| NFR-002 | A scan with the default probe budget completes in ≤ 20 s p50 and ≤ 60 s p99 (hard budget). |
| NFR-003 | `POST /api/v1/assess` on a cached domain completes in ≤ 400 ms p50, ≤ 1.5 s p95. |
| NFR-004 | Graph queries at depth 2 return in ≤ 1.5 s for ≤ 300 nodes. |
| NFR-005 | Initial dashboard JS payload ≤ 180 kB gzip; graph route ≤ 420 kB gzip total. |
| NFR-006 | Extension adds ≤ 50 ms to page load on a warm cache; ≤ 400 ms on a cold check. |

### 4.2 Reliability and degradation

| ID | Requirement |
| --- | --- |
| NFR-010 | A failure of any single probe shall not fail the scan; it shall reduce coverage. |
| NFR-011 | The API shall serve `/health` even when the database is unavailable; `/ready` shall return `503` with reasons. |
| NFR-012 | All external calls shall have explicit timeouts and no unbounded retries. |
| NFR-013 | Every 5xx response shall include a request ID that appears in server logs. |
| NFR-014 | The system shall survive a restart without losing committed scans, reports or profiles. |

### 4.3 Security

| ID | Requirement |
| --- | --- |
| NFR-020 | The scanner shall not connect to loopback, private, link-local, CGNAT, multicast, reserved or cloud-metadata addresses, in IPv4 or IPv6, including after DNS re-resolution and on every redirect hop. |
| NFR-021 | All state-changing endpoints shall require authentication except explicitly public ones. |
| NFR-022 | All input shall be validated at the boundary; unknown fields are rejected. |
| NFR-023 | No secret shall appear in client bundles, extension code, logs or error messages. |
| NFR-024 | Page content and user-supplied text shall be treated as untrusted in the UI (no raw HTML injection) and in AI prompts (data, never instructions). |
| NFR-025 | Password storage shall use bcrypt cost ≥ 12 (or argon2id) with per-user salt. |
| NFR-026 | Rate limits shall apply to auth, scans, reports, investigations and API keys. |
| NFR-027 | The system shall not collect passwords, OTPs, card numbers, cookies or tokens, and shall redact such values if they appear in captured evidence. |

### 4.4 Privacy and data

| ID | Requirement |
| --- | --- |
| NFR-030 | Raw page snapshots, when stored, shall be retained ≤ 30 days by default, then deleted; derived findings persist. |
| NFR-031 | Reporters shall be pseudonymised in any shared intelligence output; analyst identity remains in the audit log only. |
| NFR-032 | Users shall be able to delete their account; owned scans are deleted or anonymised within 30 days. |
| NFR-033 | The extension shall not transmit browsing history; it transmits only URLs the user visits when protection is enabled, and only the current page's technical signals on demand. |

### 4.5 Accessibility and UX

| ID | Requirement |
| --- | --- |
| NFR-040 | WCAG 2.1 AA for all authenticated and public screens: contrast ≥ 4.5:1 for text, keyboard reachable, visible focus, semantic landmarks. |
| NFR-041 | `prefers-reduced-motion` shall disable non-essential motion; no animation is required to understand state. |
| NFR-042 | Status shall never be conveyed by colour alone; every verdict carries text and an icon. |
| NFR-043 | All primary flows shall be usable at 360 px width. |

### 4.6 Maintainability

| ID | Requirement |
| --- | --- |
| NFR-050 | Every endpoint in `API_ENDPOINTS.md` shall have a contract test. |
| NFR-051 | Every `R-*` risk rule shall have at least one unit test with a fixture. |
| NFR-052 | OpenAPI document shall be generated in CI and committed; TS types regenerate from it. |
| NFR-053 | The repository shall pass lint, typecheck and unit tests on a clean clone with documented commands. |
| NFR-054 | No module may import another module's internal modules; only its public surface. |

---

## 5. Business rules

| ID | Rule |
| --- | --- |
| BR-001 | A decision is only as strong as its coverage. Decisions below 50% collected weight cannot be `ALLOW`. |
| BR-002 | `ALLOW` means "no known threat within executed checks" and must never be rendered as "safe", "trusted" or "verified". |
| BR-003 | Only verified profile data authorises an action. Self-declared data is evidence, not authority. |
| BR-004 | A verified payee mismatch overrides every positive signal. |
| BR-005 | One unconfirmed report cannot block; N independent reporters or one analyst confirmation are required to affect reputation. |
| BR-006 | A confirmed block on a domain must be reviewable and reversible by an analyst, with the reason recorded. |
| BR-007 | Organisation profiles and their verification evidence are tenant-scoped; one tenant cannot read another's unverified claims. |
| BR-008 | Public profile data (verified domains, login hostnames, recipient handles) is world-readable by design; nothing else is. |
| BR-009 | Simulated data is always labelled, never mixed into production reputation, and excluded from any public claim. |
| BR-010 | The platform never asserts that a CA is compromised; it reports dependency and impact for a named incident, simulated or advisory-based. |

---

## 6. MVP acceptance criteria

The MVP is accepted when all of the following hold, verified in a single rehearsed run:

1. Submitting the demo lookalike URL returns `decision = BLOCK`, `riskLevel = CRITICAL`, with at
   least `DOMAIN_NOT_REGISTERED_BY_BRAND`, `CREDENTIAL_DESTINATION_MISMATCH` and
   `PAYEE_NOT_IN_VERIFIED_PROFILE` findings, each with evidence.
2. The same URL with `intent = browse` may return `WARN` — the decision is intent-dependent, and the
   difference is explainable in the UI.
3. The genuine Northstar demo site returns `ALLOW` with coverage ≥ 80% and no blocking findings.
4. The extension blocks the payment action and shows the payee mismatch with observed/expected values.
5. The AI investigation renders ≥ 5 claims, each with a finding reference, and no claim lacks a
   source.
6. The graph shows the lookalike portal, the scholarship lookalike and the payment page in one
   campaign cluster with visible shared edges (nameserver, certificate issuer, payee).
7. A report submitted from profile A produces a `WARN` in profile B on the next check.
8. The certificate screen lists 3 monitored domains, flags one expiring within 30 days, and shows
   the simulated incident affecting the correct issuer with the affected domain list.
9. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `ruff`, `mypy`, `pytest` all pass on a clean clone.
10. `/health` returns 200 with DB down; `/ready` returns 503 with `database` reason.

---

## 7. Out of scope for MVP (requirement-level)

| Area | Status | Note |
| --- | --- | --- |
| Active vulnerability scanning | Excluded | Would require authorisation and isolation we do not have |
| Live Certificate Transparency polling | FUTURE | Schema + interface defined; no poller |
| PSP/bank API integration for payee verification | FUTURE | MVP compares against profile + syntax |
| Billing/subscriptions | FUTURE | No payment code |
| SSO / SAML | FUTURE | Email + password only |
| Multi-region deployment | FUTURE | Single region |
| Native mobile apps | FUTURE | Responsive web only |
| MCP server | FUTURE | Optional stretch |
| Email delivery | PARTIAL | Invite links logged in dev; provider is OPEN QUESTION Q-4 |

---

## 8. Traceability

| Requirement group | Features | Documents |
| --- | --- | --- |
| FR-001…FR-014 | TL-001…TL-005, TL-010, TL-011 | RISK_ENGINE, DATA_FLOW |
| FR-020…FR-027 | TL-009, TL-008 | RISK_ENGINE §7, ORG_TRUST_PROFILES |
| FR-030…FR-036 | TL-006, TL-007 | ORGANISATION_TRUST_PROFILES |
| FR-040…FR-047 | TL-012, TL-013, TL-019 | THREAT_INTELLIGENCE_ENGINE, THREAT_GRAPH |
| FR-050…FR-054 | TL-014 | AI_INVESTIGATION_ENGINE |
| FR-060…FR-064 | TL-020 | RISK_ENGINE §10, DEMO_RUNBOOK §9 |
| FR-070…FR-076 | TL-015, TL-021, TL-024 | AUTHENTICATION_AUTHORIZATION, SDK_SPECIFICATION |
| FR-080…FR-084 | TL-023 | UI_UX_SPECIFICATIONS |

Every requirement has at least one feature and at least one test path. A requirement without a
test is considered unimplemented.
