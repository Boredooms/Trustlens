# FEATURE_SPECIFICATIONS

> **Status:** DECIDED · **Group:** 01-product · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** feature IDs (`TL-###`), scope, acceptance criteria. Other documents reference these IDs; they never redefine them.
> **Related:** [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) · [`../03-backend/RISK_ENGINE.md`](../03-backend/RISK_ENGINE.md) · [`../02-architecture/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. Catalogue

Priority: **P0** = demo-blocking · **P1** = required for credibility · **P2** = should have · **P3** = future.

| ID | Feature | Priority | Primary surface | Depends on |
| --- | --- | --- | --- | --- |
| TL-001 | URL assessment | P0 | API | TL-002…TL-005, TL-010 |
| TL-002 | DNS & registration intelligence | P0 | API | — |
| TL-003 | TLS certificate & chain inspection | P0 | API | — |
| TL-004 | Risk scoring & decision | P0 | API | TL-001 |
| TL-005 | Redirect chain analysis | P0 | API | TL-002 |
| TL-006 | Organisation Trust Profiles | P0 | Dashboard, API | TL-007 |
| TL-007 | Domain ownership verification | P0 | Dashboard, API | TL-006 |
| TL-008 | Payment recipient verification | P0 | API, Dashboard | TL-006 |
| TL-009 | Action Integrity Verification | P0 | API, Extension | TL-006, TL-008, TL-010 |
| TL-010 | Page, form and script analysis | P0 | API | TL-001 |
| TL-011 | Brand impersonation signals | P1 | API | TL-006, TL-010 |
| TL-012 | Threat reporting & review | P0 | Dashboard, Extension | TL-001 |
| TL-013 | Threat graph & campaign clustering | P0 | Dashboard, API | TL-012 |
| TL-014 | AI investigation report | P0 | Dashboard, API | TL-001, TL-013 |
| TL-015 | Developer SDK & API keys | P0 | SDK, Dashboard | TL-001, TL-009 |
| TL-016 | Extension site status | P0 | Extension | TL-001 |
| TL-017 | Extension action interception | P0 | Extension | TL-009 |
| TL-018 | Extension reporting | P1 | Extension | TL-012 |
| TL-019 | Reputation & community propagation | P1 | API | TL-012 |
| TL-020 | Certificate monitoring & CA incidents | P1 | Dashboard | TL-003 |
| TL-021 | Accounts & sessions | P0 | Web, API | — |
| TL-022 | Organisations & membership | P0 | Dashboard | TL-021 |
| TL-023 | Dashboard overview | P0 | Dashboard | TL-001, TL-012, TL-020 |
| TL-024 | Audit & usage logging | P0 | API | TL-021 |

---

## 2. Specification format

Each feature states: purpose, inputs, processing, outputs, failures, acceptance criteria. Exact
request/response schemas are in `../03-backend/API_ENDPOINTS.md`; signal weights and finding codes
are in `../03-backend/RISK_ENGINE.md`. This document does not duplicate those tables — it defines
behaviour.

---

## 3. TL-001 — URL assessment

**Purpose.** Produce a complete, evidence-backed assessment of a URL for a given intent and
optional organisation, and persist it.

**Inputs.** `url` (required), `intent` (`browse` default), `organisation_id` (optional),
`deep` (optional bool, requires flag), `idempotency_key`.

**Processing.**

1. Parse and normalise the URL; reject non-HTTP(S), credentials in URL, and hosts failing the SSRF
   policy.
2. Resolve the registrable domain (eTLD+1 via public suffix list).
3. Reuse fresh cached domain-level results (TTL 1 h DNS/RDAP, 6 h TLS, 24 h reputation); record
   which parts were cached.
4. Run probes concurrently under a global 60 s budget: DNS (TL-002), RDAP (TL-002), TLS (TL-003),
   redirects (TL-005), page (TL-010), reputation (TL-019).
5. Run identity and action rules if `organisation_id` is supplied or a brand claim is detected.
6. Score and decide (TL-004). Persist scan, findings, evidence, entities and edges.
7. Return `202` with a scan id; results available at `GET /scans/{id}`.

**Outputs.** Scan resource with `status`, `decision`, `risk_level`, `risk_score`, `coverage`,
`findings[]`, `evidence[]`, `entities[]`, `timings`.

**Failures.**

| Condition | Result |
| --- | --- |
| Invalid URL | `422 INVALID_URL` |
| Blocked target (SSRF) | `422 TARGET_NOT_ALLOWED` |
| All probes fail | scan `completed`, `decision = UNKNOWN`, finding `ALL_CHECKS_UNAVAILABLE` |
| Budget exhausted | scan `partial`, coverage reflects what ran |
| Duplicate submission (same key) | original scan returned, `200` semantics |

**Acceptance.**

- A scan always terminates in `completed`, `partial` or `failed` — never stays `queued` forever.
- Every finding has `code`, `signal_group`, `severity`, `confidence`, `evidence_refs[]`.
- Re-running the same URL within TTL is measurably faster and marked `cached: true` on reused groups.
- HTTPS validity alone never yields `ALLOW` when identity checks were requested and failed.

---

## 4. TL-002 — DNS & registration intelligence

**Purpose.** Establish what the domain is, when it appeared, and what it sits behind.

**Inputs.** Registrable domain.

**Processing.** Query A, AAAA, CNAME, NS, MX, TXT (including SPF/DMARC presence) via a resolver with
2 s timeout and one retry; query RDAP for registrar, creation/expiry/updated dates and status flags.
Compute: domain age, registrar, nameserver set (normalised, lowercase, trailing dot stripped), MX
provider family, TXT challenge presence. Record raw answers with TTL and timestamp.

**Outputs.** `dns` block with typed records; `registration` block with age in days and status;
entities for domain, IPs, nameservers, ASN (when resolvable offline via a bundled ASN table).

**Failures.** NXDOMAIN → `DOMAIN_NXDOMAIN` (severity high for any intent). RDAP unavailable →
`registration = null`, `coverage.registration = UNAVAILABLE`. Resolver error → retry once, then
`UNAVAILABLE` (never `SKIPPED` when the domain *did* resolve).

**Acceptance.** Every record includes `observed_at`. Age is computed from RDAP `creation`, never
from certificate `not_before`. A domain younger than 30 days produces `DOMAIN_RECENTLY_REGISTERED`
with the exact age.

---

## 5. TL-003 — TLS certificate & chain inspection

**Purpose.** Describe the cryptographic trust situation of the endpoint accurately, including
whether the chain can be verified and what it depends on.

**Inputs.** Hostname, optional port (default 443).

**Processing.** Open TLS with SNI, 5 s timeout; capture the presented chain; verify with the system
trust store **and** record the verification result separately from presentation; parse each
certificate (subject, issuer, SANs, validity, key type/size, signature algorithm, SHA-256
fingerprint, whether self-signed); detect chain length, missing intermediates, and hostname
mismatch; resolve issuer → intermediate → root; look up known issuer state in
`ca_issuer_status` (including advisories and simulated incidents).

**Outputs.** `tls` block: `presented`, `verified`, `verification_error`, `chain[]`, `issuer`,
`root_issuer`, `days_to_expiry`, `san_match`, `fingerprints`, `weak_key` (bool), `weak_signature`
(bool), `ct_logged` (nullable).

**Failures.** TLS handshake fails → `TLS_HANDSHAKE_FAILED` (high severity for `login`/`payment`
intents). Expired → `CERT_EXPIRED`. Hostname mismatch → `CERT_HOSTNAME_MISMATCH`. Chain
unverifiable → `CERT_CHAIN_UNVERIFIED`. All are findings, not scan failures.

**Acceptance.** The engine never equates "certificate valid" with "trustworthy site"; a valid cert
contributes zero risk reduction. Weak key (RSA < 2048, ECC < 224) and SHA-1 signatures are flagged.
The certificate's issuer is recorded as a graph edge to a `certificate_authority` entity.

**Scope note.** Detecting that a *CA's own key generation* was flawed is not possible from a leaf
certificate. TrustLens models this through issuer-status advisories and dependency mapping (TL-020),
and states that limitation in the UI.

---

## 6. TL-004 — Risk scoring & decision

**Purpose.** Convert findings into a score, a risk level, a decision and a coverage report, using
deterministic, testable rules.

**Inputs.** Findings, coverage per signal group, intent, organisation context.

**Processing.** Group findings by signal group; apply rule weights (30/25/20/15/10) with per-group
caps; apply hard override rules; compute coverage percentage; apply the decision table. Full
algorithm, rule IDs and policy table: `../03-backend/RISK_ENGINE.md` §5–§8.

**Outputs.** `risk_score` (0–100), `risk_level`, `decision`, `coverage`, `reasons[]` (ordered,
human-readable), `overrides[]` (which hard rules fired).

**Failures.** No findings but coverage < 50% → `REVIEW`/`UNKNOWN`, never `ALLOW`. Contradictory
hard overrides (e.g. verified identity + verified payee mismatch) → mismatch wins (BR-004).

**Acceptance.**

- Every `R-*` rule has a unit test.
- Score is reproducible: same findings + same intent → same score.
- The response always includes coverage, and the UI always renders it.
- The AI layer cannot influence the result (asserted by an integration test).

---

## 7. TL-005 — Redirect chain analysis

**Purpose.** Reveal where the user is actually being sent, since the visible URL may differ from the
destination that collects credentials or payment.

**Inputs.** URL.

**Processing.** Request with `follow_redirects=False`; for each hop: validate the destination
against the SSRF policy, re-resolve DNS, record `(url, status, location, server, elapsed)`; stop at
max 10 hops or on loop detection; note cross-origin hops and hops to a different registrable domain
(especially before a login or payment action).

**Outputs.** `redirects.hops[]`, `redirects.cross_domain` (bool), `redirects.final_url`,
`redirects.loop_detected`.

**Failures.** Too many hops → `REDIRECT_CHAIN_TOO_LONG`. Blocked hop → chain stops, finding
`REDIRECT_TO_BLOCKED_TARGET` with the offending URL (this is a security-relevant signal, not a crash).

**Acceptance.** No request is ever made to a destination that failed the guard. Meta-refresh and
JS redirects observed in the page are recorded separately as `client_side_redirects` — never merged
into the HTTP chain.

---

## 8. TL-006 — Organisation Trust Profiles

**Purpose.** Give organisations an authoritative, verifiable record of the domains, login endpoints
and payment recipients they own, which is the reference used by identity and action checks.

**Inputs.** Profile fields (name, legal name, country, sector, support email, logo), domain list,
login endpoint list, recipient list.

**Processing.** Create profile as `draft`; domains require verification (TL-007); recipients require
attestation; publishing requires at least one verified domain; all changes audited with before/after.

**Outputs.** Profile with `status` (`draft`, `active`, `suspended`), verified/unverified collections,
and a public projection (`GET /organisations/{id}/public-profile`).

**Failures.** Duplicate legal name → allowed (names are not unique) but flagged for analyst review.
Domain claimed by another org → `409 DOMAIN_ALREADY_CLAIMED`. Publishing with zero verified domains →
`409 NO_VERIFIED_DOMAIN`.

**Acceptance.** Only `verified` domains and `verified` recipients authorise anything. A profile's
public projection exposes no emails of members, no evidence artefacts, no internal notes.

---

## 9. TL-007 — Domain ownership verification

**Purpose.** Prove control of a domain before trusting it as an organisation's identity.

**Inputs.** Domain, method (`dns_txt` | `http_file`).

**Processing.** Generate a 32-byte random token, store hash with expiry (7 days). DNS method: query
`TXT _trustlens-challenge.<domain>` and compare exact token. File method: fetch
`https://<domain>/.well-known/trustlens-verify.txt` with the SSRF guard, size cap 4 kB, compare
trimmed body. On success, mark verified, record evidence (record value or file hash + timestamp),
write audit row, and attach `domain` → `organisation` edge with confidence 1.0.

**Outputs.** `verification` record with `status`, `method`, `verified_at`, `expires_at`, `attempts`.

**Failures.** Token mismatch → `VERIFICATION_TOKEN_MISMATCH` with observed value truncated to 16
chars. Fetch failure → `VERIFICATION_FETCH_FAILED`. Too many attempts → `429` after 5/hour.

**Acceptance.** Re-verification is required after 180 days or on registrar change detection.
Verification evidence is stored; the raw token is never returned after creation.

---

## 10. TL-008 — Payment recipient verification

**Purpose.** Answer "is this payee officially associated with this organisation?" — the single most
understandable security feature in the product.

**Inputs.** `recipient_type` (`upi_vpa` | `iban` | `bank_account` | `wallet_address` | `payment_link`),
`value`, `organisation_id`, optional `observed_on_url`.

**Processing.** Normalise (lowercase VPA handle, IBAN whitespace strip + mod-97 check, uppercase
country code); validate syntax and checksum; look up the organisation's recipients; return match
status. If the organisation has no verified recipients, return
`organisation_has_no_verified_recipients: true` — an honest "cannot verify", distinct from "mismatch".
Cross-check the recipient entity against reported scams (graph lookup).

**Outputs.** `match` (`exact` | `none` | `unverifiable`), `recipient_status`
(`verified` | `pending_attestation` | `revoked` | `unknown`), `related_reports[]`, `confidence`.

**Failures.** Invalid syntax → `422 INVALID_RECIPIENT` with the failing rule. Unknown org →
`404 ORGANISATION_NOT_FOUND`.

**Acceptance.** A verified mismatch is a hard-override finding (`PAYEE_NOT_IN_VERIFIED_PROFILE`) that
forces `BLOCK` for `payment` intent. An unverifiable org never produces a block; it produces
`PAYEE_UNVERIFIABLE` at warn severity. Payee values are displayed masked except the handle part
needed for recognition.

---

## 11. TL-009 — Action Integrity Verification

**Purpose.** The differentiator: decide whether the site is authorised to perform the specific
action being attempted, not merely whether it looks legitimate.

**Inputs.** `url`, `intent`, `organisation_id` (or detected brand claim), and optionally:
`form_action`, `payee`, `payment_amount`, `destination_host`.

**Processing.**

1. Resolve claimed identity: explicit `organisation_id`, else brand-claim detection from page
   (TL-011), else none.
2. For `login`: compare observed form action origin and any statically visible submit target with
   approved login endpoints; flag third-party collection, HTTP (non-TLS) targets, and
   cross-registrable-domain targets.
3. For `payment`: extract payee candidates (UPI links, `upi://` URIs, IBAN text, payment iframe
   hosts), verify each (TL-008), and compare destination hosts with approved payment hosts.
4. For `data_submission`: flag forms collecting sensitive fields posting cross-origin.
5. Emit findings; hand to TL-004 for the decision.

**Outputs.** `action` block: `intent`, `claimed_organisation`, `observed_destination`,
`expected_destinations[]`, `payee`, `match`, and the resulting findings.

**Failures.** No claimed identity → `IDENTITY_CLAIM_UNVERIFIABLE`, decision at most `WARN`. No
observable form (JS-only, closed shadow DOM) → `ACTION_NOT_OBSERVABLE`, `WARN` with explanation.
Extension cannot see inside cross-origin iframes → surfaced as a coverage gap, not a pass.

**Acceptance.** A verified credential-destination mismatch produces `BLOCK` for `login` intent. The
UI can always show observed vs expected. The extension overlay names the specific mismatch in ≤ 15
words.

---

## 12. TL-010 — Page, form and script analysis

**Purpose.** Extract the behavioural surface of the page without executing it by default.

**Inputs.** Final URL, HTML (≤ 2 MB), optional rendered DOM.

**Processing.** Parse with a fast HTML parser; extract forms (action, method, input names/types,
password fields, hidden fields), links, iframes, scripts (external origins, inline hash), meta
refresh, `upi://` links, phone numbers, and title/og text. Detect password field presence,
`autocomplete="current-password"`, and whether the action is empty (submits to self — common in
single-page phishing kits). Compute a DOM-structure fingerprint (tag path histogram hash) for
similarity. Never execute scripts in static mode; never store field *values*.

**Outputs.** `page` block: `title`, `brand_claims[]`, `forms[]`, `password_fields`, `scripts[]`,
`iframes[]`, `payment_links[]`, `dom_fingerprint`, `dom_source` (`static` | `playwright`).

**Failures.** Fetch blocked by bot protection → `PAGE_FETCH_BLOCKED`, coverage `UNAVAILABLE`. Oversize
→ truncated with `page_truncated: true`. Renderer disabled → `dom_source = "static"`, coverage
`PAGE_RENDER = SKIPPED`.

**Acceptance.** Password field *values* are never read or stored; only presence and metadata.
Inert demo forms produce the same structure as the real attack so the demo is honest.

---

## 13. TL-011 — Brand impersonation signals

**Purpose.** Detect that a site claims to be an organisation it is not, using cheap deterministic
signals plus a transparent similarity score.

**Inputs.** Page title/og/brand tokens, logo images (≤ 3), favicon, domain string, organisation
profile brand data.

**Processing.** Tokenise title and headings; compare against organisation name/aliases using
normalised Levenshtein and token overlap. Compute domain-label similarity (strip TLD, remove
hyphens/digits, compare to brand and brand+keyword patterns like `-login`, `-apply`, `-fees`).
Compute perceptual hash (pHash 64-bit) of logo candidates and favicon; compare with stored hashes
using Hamming distance. If a domain resembles the brand but is not a verified domain → mismatch.

**Outputs.** `brand` block: `claims[]` with `organisation_id`, `token_similarity`, `logo_distance`,
`domain_similarity`, `is_verified_domain`, and findings `BRAND_CLAIM_ON_UNVERIFIED_DOMAIN`,
`LOGO_NEAR_DUPLICATE`, `TYPOSQUATTING_PATTERN`.

**Failures.** No image extraction → logo distance null, coverage `UNAVAILABLE`. No organisation
matches → no claim; do not invent one.

**Acceptance.** Similarity values are always reported with the method name; there is no "AI says
fake" black box. A logo distance below 6/64 with an unverified domain is strong evidence; a token
match alone is weak.

---

## 14. TL-012 — Threat reporting & review

**Purpose.** Let users contribute evidence-backed reports, and let analysts turn some of them into
shared intelligence.

**Inputs.** `url`, `justification` (≤ 500 chars), optional `intent`, optional `observed_payee`.

**Processing.** Normalise and dedupe (same reporter + same URL within 24 h → `409`). Auto-attach the
latest scan if fresh, else queue a lightweight scan. Classify reporter channel (`web`, `extension`,
`sdk`, `analyst`). Status machine: `pending` → `reviewing` → `confirmed` | `dismissed`.
Confirmation requires a reason and sufficient coverage.

**Outputs.** Report resource with status, evidence refs, linked scan, reporter (pseudonymised in
shared views).

**Failures.** Rate limit → `429` with remaining quota. Report on own verified domain → accepted but
flagged `owner_report` (prevents accidental self-harm).

**Acceptance.** One `pending` report changes no reputation. Confirmation is audited. Dismissal
requires a reason and reverses any provisional effect.

---

## 15. TL-013 — Threat graph & campaign clustering

**Purpose.** Show how threats connect, and group them into campaigns with explicit confidence.

**Inputs.** Entity, depth (1–3), filters.

**Processing.** Traverse `relationships` via recursive CTE with node/edge caps; compute campaign
clustering using shared-entity overlap (nameserver, certificate issuer, payee, IP/24, DOM
fingerprint) with weighted Jaccard; assign cluster confidence; persist `campaigns` and
`campaign_entities` on demand.

**Outputs.** `{nodes[], edges[], campaigns[]}` with per-edge `confidence` and `evidence_refs`.

**Failures.** Depth > 3 → `422`. Node cap exceeded → `truncated: true` with counts (never a silent
partial graph).

**Acceptance.** Every edge is typed, evidenced and confidence-scored. Sharing a hosting provider
alone never exceeds 0.3 confidence. The UI can filter below a threshold.

---

## 16. TL-014 — AI investigation report

**Purpose.** Explain an attack in prose that a non-specialist can act on, strictly grounded in
collected evidence.

**Inputs.** `scan_id`.

**Processing.** Orchestrator executes a fixed tool sequence (see
`../07-ai-intelligence/AI_INVESTIGATION_ENGINE.md` §5), records each step, assembles a compact
evidence pack, calls the model with a strict schema, validates the output, stores narrative +
references.

**Outputs.** Investigation with `steps[]`, `narrative` (sections + claims), `references[]`,
`ai: {generated, model, tokens, latency}`, `status`.

**Failures.** No API key → template narrative, `generated: false`. Model returns invalid schema →
one repair attempt, then template. Model cites unknown finding → that claim is dropped, recorded in
`dropped_claims[]`. Timeout → `partial` with completed steps.

**Acceptance.** Zero claims without a resolvable reference. The narrative never states a decision
different from the scan's decision. Prompt-injected page text cannot alter the tool sequence
(asserted by a test fixture containing "ignore previous instructions").

---

## 17. TL-015 — Developer SDK & API keys

**Purpose.** Make TrustLens embeddable.

**Inputs.** API key with scopes; method calls.

**Processing.** SDK wraps the REST API with typed methods: `assess`, `verifyIdentity`,
`verifyPayment`, `inspectRedirect`, `reportThreat`, `getScan`, `getInvestigation`. Adds
`Idempotency-Key`, timeouts, one retry on 429/5xx with `Retry-After`, error mapping.

**Outputs.** Typed results and errors (see `../06-sdk/SDK_SPECIFICATION.md`).

**Failures.** 401 → `AuthenticationError` (no retry). 429 → `RateLimitError` with `retryAfter`.
5xx → `ServerError` retryable once. Network → `NetworkError`.

**Acceptance.** Public surface matches the specification exactly. Types are generated from OpenAPI,
so a backend field rename breaks the build rather than production.

---

## 18. TL-016 — Extension site status

**Purpose.** Always-available indication of the current page's trust state.

**Inputs.** Tab URL, optional org context.

**Processing.** Service worker checks cache (10 min per URL), else `POST /assess` with
`intent = browse`; maps decision to icon + popup content; stores result per tab; shows coverage.

**Outputs.** Icon state (`block`, `warn`, `allow`, `unknown`), popup with top findings and a link to
the full report.

**Failures.** API unreachable → `unknown` + "not checked" copy; never green. Cache miss on rapid
navigation → debounce 400 ms.

**Acceptance.** The extension never displays "safe"/"verified" for `ALLOW`. The popup shows coverage
and the scan timestamp.

---

## 19. TL-017 — Extension action interception

**Purpose.** Stop the sensitive action, not just the page load.

**Inputs.** DOM mutations indicating form submit, payment link click, or password field focus.

**Processing.** On sensitive action, collect only metadata (form action, method, payee strings,
destination host, whether password field present) and request `POST /assess` with the matching
intent. If `BLOCK`, intercept (`preventDefault`) and render the overlay. If `WARN`, render a
non-blocking confirm. If API fails, allow with a visible "not verified" toast.

**Outputs.** Overlay with observed/expected values, "Go back" (primary), "Proceed anyway"
(secondary, requires confirm), "Report".

**Failures.** Cannot intercept (cross-origin iframe, native sheet) → show a warning before the
action where possible, and record `ACTION_NOT_OBSERVABLE` in the popup.

**Acceptance.** The demo payment action is stopped before any navigation to the payment URL. No
credential value is ever read (`event.target.value` is never accessed for password fields).

---

## 20. TL-018 — Extension reporting

**Purpose.** One-click contribution with automatic technical context.

**Inputs.** Current URL, finding codes shown, user justification.

**Processing.** `POST /reports` with the scan id and codes; no page HTML; no screenshots.

**Outputs.** Confirmation with report id and status.

**Acceptance.** Report payload contains no field values, no cookies, no headers.

---

## 21. TL-019 — Reputation & community propagation

**Purpose.** Make one confirmed finding protect everyone, without enabling brigading.

**Inputs.** Confirmed/dismissed reports, scan history, analyst overrides.

**Processing.** Maintain per-entity reputation counters (confirmed reports, distinct reporters,
recency-weighted). Compute a bounded reputation contribution to the `reputation` signal group.
Expire effects after 90 days unless reinforced. Propagate to `assess` via the cache key.

**Outputs.** `reputation` block with `score`, `basis`, `last_confirmed_at`, `related_report_count`.

**Acceptance.** A domain needs ≥ 2 distinct reporters **or** 1 analyst confirmation to affect
decisions. Reputation never alone forces `BLOCK` unless an analyst set a manual block (audited).

---

## 22. TL-020 — Certificate monitoring & CA incidents

**Purpose.** Track the cryptographic dependencies of monitored domains and show the blast radius of
an issuer incident.

**Inputs.** Monitored domain list; optional incident (real advisory or simulated).

**Processing.** On each scan of a monitored domain, upsert certificate record and its issuer edges;
compute expiry buckets; detect fingerprint changes. Incident model: `{issuer, title, severity,
source, simulated, published_at}`; impact = monitored domains whose chain includes the issuer.

**Outputs.** Certificate inventory, alerts, incident with affected assets and recommended action.

**Failures.** No certificate observed → `NO_CERTIFICATE_OBSERVED`. Simulated incident on a
production environment → `403 DEMO_MODE_REQUIRED`.

**Acceptance.** Simulated incidents are labelled in API (`simulated: true`), UI (badge), and export
(filename prefix `SIMULATED-`). The platform never states that a CA is distrusted; it reports
dependency.

---

## 23. TL-021 — Accounts & sessions

**Purpose.** Identity for humans and machines.

**Processing.** Email + password registration (bcrypt 12), login, 15-min access JWT, 30-day rotating
refresh token in httpOnly SameSite=Lax cookie with reuse detection, logout revocation, API key
creation/revocation, extension device pairing.

**Acceptance.** Refresh token reuse revokes the whole family. API key secret is shown once. All auth
events audited. Details: `../03-backend/AUTHENTICATION_AUTHORIZATION.md`.

---

## 24. TL-022 — Organisations & membership

**Purpose.** Multi-user access to one Trust Profile.

**Processing.** Invite by email (token), roles `org_admin` / `org_member`, ownership transfer, member
removal. Invites expire in 7 days. Last admin cannot be removed.

**Acceptance.** Cross-tenant reads return `404` (not `403`) to avoid existence leaks.

---

## 25. TL-023 — Dashboard overview

**Purpose.** Answer "what should I look at now?" in one screen.

**Content.** Scan input, recent scans (5), high-risk domains (5), certificate alerts (3), campaign
discoveries (3), report queue count. Each block has empty/loading/error states and links to detail.

**Acceptance.** First meaningful paint ≤ 1.5 s warm; skeleton states match final layout; no block
shows fabricated data when its API fails (it shows an error with retry).

---

## 26. TL-024 — Audit & usage logging

**Purpose.** Accountability and quota visibility.

**Processing.** Append-only `audit_logs` for auth, key, profile, review, appeal, seed and operator
actions, with actor, action, target, before/after (redacted), IP hash, request id. Usage counters per
API key and per user per day.

**Acceptance.** Audit rows are never updated or deleted by application code. Usage is queryable via
`GET /usage` and shown on the developers page.

---

## 27. Cross-feature rules

1. Every feature that produces a verdict must return coverage.
2. Every feature that mutates verified state must write an audit row.
3. Every feature that reads tenant data must scope by membership.
4. Every feature that touches the network must pass the SSRF guard.
5. Every feature that displays external text must escape it.
