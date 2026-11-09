# USER_JOURNEYS

> **Status:** DECIDED · **Group:** 01-product · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** end-to-end journeys, decision points and failure recovery.
> **Related:** [`USER_PERSONAS.md`](USER_PERSONAS.md) · [`../02-architecture/DATA_FLOW.md`](../02-architecture/DATA_FLOW.md) · [`../05-browser-extension/BROWSER_PROTECTION_LOGIC.md`](../05-browser-extension/BROWSER_PROTECTION_LOGIC.md)

---

## 1. Format

Each journey lists: trigger, steps (actor action → system action → API), decision points, failure
and recovery. Journeys are the bridge between personas and screens; screen layouts are in
`../04-frontend/UI_UX_SPECIFICATIONS.md`.

Common shorthand:

- `POST /scans` means `POST /api/v1/scans`.
- **Decision gate** = a point where the product must choose a branch that the user can see.

---

## 2. J1 — First-time visitor checks a suspicious link

**Trigger.** Aisha receives a WhatsApp message: "Northstar University admissions 2026-27 —
apply now".

| # | Actor | System |
| --- | --- | --- |
| 1 | Pastes the link into the public checker on `/` | Validates the URL, shows "Checking…" with the checks being run |
| 2 | — | `POST /scans` (anonymous, rate-limited), poll `GET /scans/{id}` every 1 s |
| 3 | Reads the verdict panel | Renders decision `BLOCK`, risk `CRITICAL`, the top three findings in plain language, and coverage |
| 4 | Clicks "See the evidence" | Renders the findings list with values (observed payee vs registered payee) |
| 5 | Clicks "Install the extension" | Links to the extension page with the demo install instructions |

**Decision gate.** If the anonymous quota is exhausted, the system shows the quota message and the
sign-up CTA instead of silently degrading depth.

**Failure and recovery**

| Failure | Behaviour |
| --- | --- |
| Scan times out (60 s) | Show partial results with `coverage` and a "run deeper scan after signing in" CTA; never a blank error |
| Target unreachable | `decision = UNKNOWN` with `TARGET_UNREACHABLE`; explain that unreachable ≠ safe |
| Backend cold start | Banner "Waking the analysis engine (up to 60 s)" plus a retry that reuses the same idempotency key |

---

## 3. J2 — Extension warns before a payment

**Trigger.** Aisha opens the lookalike portal with the extension installed and clicks "Pay
application fee".

1. Content script observes the navigation and sends the URL to the service worker.
2. Service worker checks `chrome.storage.session` cache; miss → `POST /assess`
   with `intent = browse` (page-level), receives `WARN`.
3. The popup icon turns amber; a non-blocking banner appears: "This site claims to be Northstar
   University but is not one of its registered domains."
4. Aisha clicks the payment button. The content script detects a payment-intent element (UPI link,
   payee string, or `intent=payment` heuristic) and requests `POST /assess` with
   `intent = payment` and the observed payee.
5. Server returns `BLOCK` with `PAYEE_NOT_IN_VERIFIED_PROFILE`, `observed`, `expected[]`.
6. The extension renders a blocking overlay: "Payment stopped — this payee is not registered by
   Northstar University", with `Proceed anyway` behind an explicit confirmation.

**Decision gates**

- Cache age > 10 min → re-check before warning (prevents stale "safe").
- API unreachable → fail **open** with a visible "not checked" state (Q-2 default), never a silent
  green state.
- Unknown payee extraction → `WARN` with "could not identify the payee", not `BLOCK`.

**Recovery.** If the overlay blocks a legitimate site, "Report a false positive" is one click and
sends the URL plus the finding codes (never page content).

---

## 4. J3 — Analyst investigates a report

**Trigger.** A report arrives for `apply.northstar-admissions.example`.

1. Rohan opens `/app/reports`, filters `status = pending`, sorted by `severity`.
2. Opens the report; sees reporter's justification, auto-collected evidence, and the linked scan.
3. Clicks "Re-run scan" → `POST /scans` with `organisationId` of the claimed brand.
4. Opens the graph tab; sees the domain linked to two other domains via nameserver and certificate
   issuer, and to one payee.
5. Clicks "Confirm report" → `POST /reports/{id}/review` with `{action: "confirm", reason: "..."}`.
6. System raises entity reputation, creates `REPORTED_BY` and infrastructure edges, and makes the
   verdict available to `assess` for other users.

**Decision gate.** If the scan's coverage < 50%, the UI disables "Confirm" and offers "Request
deeper scan" — an analyst cannot confirm on thin evidence (BR-001, BR-005).

**Failure.** Review call fails with `409 REPORT_ALREADY_REVIEWED` → refresh and show the existing
reviewer and timestamp.

---

## 5. J4 — Organisation registers and verifies a domain

**Trigger.** Meera signs up and wants Northstar's domains protected.

1. `/app/organisations` → "Create organisation" → name, country, sector, contact email.
2. Adds `northstar-demo.example` as an official domain → status `pending_verification`.
3. System displays two challenge options:
   - DNS: `TXT _trustlens-challenge.northstar-demo.example = tl-verify=<token>`
   - File: `https://northstar-demo.example/.well-known/trustlens-verify.txt` containing the token.
4. Meera publishes the record and clicks "Verify" → `POST /organisations/{id}/domains/{domainId}/verify`.
5. System resolves TXT (or fetches the file), compares tokens, marks `verified`, writes audit entry.
6. Login hostnames inside a verified domain inherit verification; explicit login endpoints can also
   be listed.

**Decision gates**

- Token mismatch → `VERIFICATION_TOKEN_MISMATCH`, showing the value observed (truncated) so she can
  fix the record without a support ticket.
- Domain already verified by another organisation → `409 DOMAIN_ALREADY_CLAIMED` and a dispute path.

**Recovery.** Verification can be re-run at any time; rate limit 5 attempts/hour per domain.

---

## 6. J5 — Organisation adds a payment recipient

1. `/app/organisations/:id` → Recipients → "Add recipient": type `upi_vpa`, value
   `fees@northstar-demo`, label "Admissions fee account", evidence note.
2. Recipient is created as `pending_attestation`. It does **not** authorise anything yet.
3. Meera uploads an attestation artefact (bank statement header page or a signed letter) — stored
   as an evidence reference, not published.
4. An `analyst`/`operator` confirms → `verified`, with `verified_by`, `verified_at`.
5. The public profile now includes the handle; `verify-payment` accepts it.

**Decision gate.** A `pending_attestation` recipient produces `PAYEE_NOT_VERIFIED` (WARN-level
identity finding), not `PAYEE_NOT_IN_VERIFIED_PROFILE` — the difference matters for false positives.

---

## 7. J6 — Developer integrates the SDK

1. Signs up, verifies email, opens `/app/developers`, creates a key with scopes
   `assess:read`, `reports:write`. The full key is shown once, with a copy button and a warning.
2. Installs: `npm install trustlens-sdk`.
3. Calls `assess({ url, intent: "payment" })` in a pre-checkout hook.
4. Handles the decision: `BLOCK` → refuse and log `requestId`; `WARN` → confirm dialog;
   `REVIEW`/`UNKNOWN` → proceed but log; `ALLOW` → proceed.
5. Adds a `reportThreat()` call behind a "report this seller" button.
6. Watches usage on the same page; sees 429 handling documented and implemented with backoff.

**Failure.** Invalid key → `401 INVALID_API_KEY`, SDK throws `AuthenticationError`; UI must not
retry. Rate limit → `429` with `Retry-After`; SDK retries once using the header.

---

## 8. J7 — Investigator asks the AI to explain

1. From a scan report, clicks "Investigate" → `POST /investigations {scanId}`.
2. UI shows the step timeline as steps complete: `collect_dns`, `collect_tls`,
   `collect_redirects`, `collect_page`, `correlate_graph`, `score`, `narrate`.
3. `GET /investigations/{id}` polled at 1 s; each step shows `status` and duration.
4. Narrative renders with inline references `[F-2]`, `[E-7]`; each reference is a link to the
   evidence row.
5. "Export Markdown" for a ticket; "Copy link" for sharing within the org.

**Decision gate.** If `ai.generated = false` (no key/failure), the report still renders, with a
banner: "Narrative generated from findings by template; no model was used."

**Failure.** Investigation step fails → status `partial`, narrative covers what succeeded, and the
failed tool is listed with its error code. Never a fake success.

---

## 9. J8 — Community propagation

1. Rohan confirms the report.
2. Correlation writes a `THREAT_REPORT` entity link and bumps `domain.reputation`.
3. Priya, in a different tenant, checks the same URL in the dashboard: `assess` now returns `WARN`
   with `RELATED_THREAT_FOUND` and a link "reported 12 minutes ago".
4. Aisha's extension, on a fresh check, warns without needing a new report.

**Gate.** Reputation from reports is capped per day (see `THREAT_INTELLIGENCE_ENGINE.md` §8) so a
brigade cannot mass-escalate a domain.

---

## 10. J9 — Certificate alert and simulated CA incident

1. Meera opens `/app/certificates`. Three monitored domains, sorted by soonest expiry; one flagged
   `expires_in_days = 21` with an amber badge.
2. A banner (only when the demo flag is on) offers "Run simulated CA incident" for operators.
3. Incident view: issuer `Demo Intermediate CA`, `simulated: true`, affected monitored domains with
   their current leaf fingerprints and the action required ("reissue from a different issuer").
4. Export CSV of affected assets for the helpdesk.

**Gate.** Production environments hide the trigger; the incident endpoint requires `operator`
(and `DEMO_MODE=1`).

---

## 11. J10 — False-positive appeal

1. A site owner hits the extension block and clicks "This is my site".
2. Form collects the domain and an email; a verification challenge is offered (same DNS/file
   mechanism) so an owner can prove control without an account.
3. On success, an appeal is created for analyst review; the domain's decision is not changed until
   reviewed.
4. Analyst dismisses the underlying report → reputation recomputed → propagation removes the block
   on next check.

**Gate.** Appeals never auto-clear a block (BR-006).

---

## 12. J11 — Account deletion

1. `/app/settings` → Delete account, requires password re-entry and typing the account email.
2. Sessions revoked; API keys revoked; device tokens revoked.
3. Scans and reports are anonymised (reporter set null, `anonymised_at` set) or deleted where they
   are not part of confirmed intelligence; org membership transfer is required first if the user is
   the sole `org_admin`.

**Gate.** The last `org_admin` of an organisation cannot delete their account without transferring
ownership — otherwise the profile becomes unmanageable.

---

## 13. Journey coverage

| Journey | Feature IDs | Screens |
| --- | --- | --- |
| J1 public check | TL-001, TL-004, TL-023 | `/`, `/app/scan/:id` preview |
| J2 extension warning | TL-016, TL-017, TL-009 | popup, overlay |
| J3 analyst report | TL-012, TL-013, TL-014 | `/app/reports`, `/app/scan/:id` |
| J4 domain verification | TL-006, TL-007 | `/app/organisations/:id` |
| J5 recipient verification | TL-008 | `/app/organisations/:id` |
| J6 SDK integration | TL-015, TL-021 | `/app/developers` |
| J7 AI investigation | TL-014 | `/app/scan/:id` → investigation |
| J8 propagation | TL-019, TL-012 | `/app/intelligence` |
| J9 certificates | TL-020 | `/app/certificates` |
| J10 appeal | TL-012, TL-019 | public appeal form |
| J11 deletion | TL-021, TL-024 | `/app/settings` |
