# UI_UX_SPECIFICATIONS

> **Status:** DECIDED · **Group:** 04-frontend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** screen layout, hierarchy, states and interactions.
> **Related:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) · [`FRONTEND_ARCHITECTURE.md`](FRONTEND_ARCHITECTURE.md) · [`../01-product/USER_JOURNEYS.md`](../01-product/USER_JOURNEYS.md)

---

## 1. Global patterns

Every screen defines four states explicitly: **loading** (skeleton matching final layout),
**empty** (explanation + primary action), **error** (message + request ID + retry), **populated**.
A screen without all four is incomplete.

Interaction rules:

- One primary action per view.
- Destructive actions require confirmation naming the consequence.
- Filters live in the URL.
- Nothing critical is conveyed by colour alone.
- Keyboard: `Tab` order follows visual order; `/` focuses search; `Esc` closes overlays.

---

## 2. Public: landing `/`

**Purpose.** Explain the product in one screen and offer a check.

| Section | Content |
| --- | --- |
| Hero | `The internet was built on trust. We verify it.` Sub: verify identity, investigate infrastructure, protect sensitive actions. Actions: **Check a website** (input inline), **Explore the platform** |
| Inline checker | URL field + intent select (default `browse`); submits and shows a compact verdict card with top 3 findings and "full report" (requires sign-in) |
| How detection works | Four columns: identity, action, infrastructure, community — one sentence each |
| Action Integrity demo | Static illustration of "asked for X / registered Y" with a mismatch; no fake data presented as live |
| Network | Small graph illustration + "three lookalikes, one campaign" |
| Certificate trust | Issuer dependency illustration |
| Developers | Three-line code block + link to `/developers` |
| Security methodology | Link to `/security` with limitations stated |
| Footer | Product, docs, security, contact |

Loading: none (static). Checker states: idle, checking (progress with named steps), verdict, error,
quota-exceeded (sign-up CTA).

---

## 3. Public: `/how-it-works`

Explains the pipeline as five numbered steps with a diagram per step. No marketing adjectives without
a concrete claim. Ends with "what we cannot see" (honesty section) and a CTA.

---

## 4. Public: `/developers`

- Install snippet, `assess()` example with request and response (real shapes from `API_CONTRACTS.md`).
- Decision semantics table (all five values, plain meaning).
- Rate limits table.
- Error handling snippet.
- Link to create a key (auth required).
- "Sandbox" note: demo domains and how to test without real targets.

---

## 5. Public: `/security`

Methodology, coverage philosophy, SSRF and isolation description, data handling, what we never store,
how to report a vulnerability, and an explicit limitations list (no active scanning, CT polling not
live, payee verification by attestation). This page is a trust asset, not marketing.

---

## 6. Auth: `/login`, `/register`

Centered card, 400 px, no sidebar, minimal chrome. Fields with inline validation on blur. Error
banner is generic for login (`Invalid email or password`) and specific for registration (email taken).
After success, honour `?next=` only if it starts with `/app`.

Password rules shown before submission (length, not complexity theatre). No "confirm password" field
(cut scope; reveal toggle instead).

---

## 7. App: `/app` — Overview

Layout: 12-col grid, three rows.

| Block | Span | Content | Empty state |
| --- | --- | --- | --- |
| Scan input | 12 | Large URL field + intent + Run scan | — |
| Recent scans | 8 | 5 rows: URL (truncated), verdict, time | "No scans yet — try the demo lookalike" with a copyable URL |
| Report queue | 4 | Pending/reviewing counts + link | "Nothing waiting" |
| High-risk domains | 6 | Top 5 by reputation | "No known bad domains in your scope" |
| Certificate alerts | 6 | Expiring ≤ 30 days + simulated incidents | "No certificates expiring soon" |
| Campaigns | 12 | 3 campaign cards: name, confidence bar, member count | "No correlated campaigns yet" |

Each block fetches independently (`GET /overview` returns nullable blocks). A failed block shows an
inline error and does not blank the page.

Above the fold on a 1440×900 screen: scan input + recent scans.

---

## 8. App: `/app/scan` — Scan index / new scan

Split view: input panel (URL, intent, optional organisation select) and a right panel with "what will
be checked" (five groups, each with a one-line explanation) and recent targets.

On submit: navigate to `/app/scan/:id` immediately; the report screen owns the progress UI.

---

## 9. App: `/app/scan/:id` — Scan report (the core screen)

**Header.** URL (mono, truncated middle), decision badge, risk score `62/100`, coverage meter,
timestamp, actions: **Investigate**, **Report**, **Copy link**, **Re-scan**.

**Layout.** Two columns on ≥ 1280 px (main 8, rail 4); stacked below.

**Main column**

1. **Verdict panel** — decision, one-sentence summary, top 3 reasons as a numbered list, override
   chips (`O-2` with tooltip). If coverage < 50%, a banner explains the gate.
2. **Findings** — grouped by signal group in the canonical order (reputation, identity, credential,
   payment, infrastructure). Each group is a collapsible section with count and group contribution
   (`25/25`). Each finding row: severity dot, title, detail, observed→expected, evidence count,
   expand to evidence list.
3. **Action evidence** — for `login`/`payment`: a two-column "Observed" vs "Expected" block with mono
   values, plus the intent that produced the decision.
4. **Page summary** — title, forms table (action, method, fields count, password present), scripts
   origins, iframes, `dom_source`.
5. **Redirect chain** — ordered hops with status and cross-domain markers; blocked hop highlighted.

**Rail**

- Identity card: claimed organisation, verified domains, match status.
- TLS card: issuer, root, validity, days to expiry, chain verification result, fingerprints (copy).
- DNS card: A/AAAA, NS, MX, age.
- Graph preview: 1-hop mini graph with "Open in intelligence".
- Metadata: scan id, engine version, duration, cached groups.

**States.** `queued`/`running`: skeleton with a step list and live duration; poll 1 s; after 90 s show
"taking longer than usual" with the last data. `partial`: amber banner listing unavailable checks.
`failed`: error panel with `failure_code` and a re-run action.

**Investigate.** Creates an investigation, opens a right drawer with the step timeline; when complete,
shows the narrative with inline `[F-3]` references that scroll to and highlight the finding. A footer
states whether AI was used (`AI narrative` vs `Template narrative`).

---

## 10. App: `/app/intelligence` — Graph

Toolbar: entity search, depth (1–3), min-confidence slider (default 0.5), node-type toggles,
edge-type toggles, layout select, "List view" toggle.

Canvas: 60% height minimum, pan/zoom, click node → drawer; click edge → evidence drawer with
`observed_count`, `confidence`, evidence list.

Right drawer for a node: type, label, attributes, reputation basis, first/last seen, edges grouped by
type with counts, actions ("Set as root", "Investigate", "Report").

Legend always visible. A text summary ("9 nodes, 11 edges; strongest link: shared payee 0.82") sits
above the canvas for accessibility and for narration during a demo.

Empty: "Search an entity to explore its neighbourhood." Error: retry.

---

## 11. App: `/app/campaigns` and detail

List: name, confidence bar, member count, first/last seen, top shared indicator. Detail: header with
**Simulated** badge when applicable, member entity table, shared indicators table (type, value,
confidence, member count), mini graph, "Export JSON" (filename prefixed `SIMULATED-` when simulated).

Below 0.6 confidence the header reads "Possible campaign" and a note explains the threshold; it is
never labelled "confirmed".

---

## 12. App: `/app/organisations` and detail

List: name, status pill, verified domains count, members count, role.

Detail tabs: **Profile**, **Domains**, **Recipients**, **Members**, **Monitoring**.

- Profile: form (name, legal name, country, sector, support email, brand tokens as chips, logo
  upload), publish/suspend with confirmation.
- Domains: table (domain, kind, status, verified_at, expires_at), "Add domain" → challenge panel with
  copy buttons for the TXT record and file URL, "Verify now" with observed-value error display.
- Recipients: table (type, handle, label, status, verified_at), add form with live normalisation
  preview, attestation action for analysts.
- Members: table with role select and remove (blocked for last admin, with explanation).
- Monitoring: monitored domains and their certificate status.

Every mutation shows a toast and refreshes the affected tables.

---

## 13. App: `/app/certificates`

Header: counts (total, expiring ≤ 30, incidents). Tabs: **Inventory**, **Monitors**, **Incidents**.

- Inventory table: domain, issuer, root, not_after, days left (colour band), fingerprint short.
- Monitors: domain, last checked, current cert, add/remove.
- Incidents: list with **Simulated** badge, issuer, severity, affected count, published date; detail
  shows affected domains table with required action and CSV export.
- Operator-only, demo-mode-only: "Run simulated CA incident" button, clearly separated in a panel
  labelled "Demonstration tools".

---

## 14. App: `/app/reports` and detail

List: URL, status, reporter channel, created, linked decision. Filters: status, date, decision.
Detail: justification, observed payee, linked scan summary, evidence, reporter (pseudonymised for
non-analysts), review panel with **Confirm** / **Dismiss** and a required reason (min 10 chars).
Confirm is disabled with an explanation when coverage < 50%.

---

## 15. App: `/app/settings`

Tabs: Account (name, email, password change, delete account), Security (sessions/devices list with
revoke), Appearance (theme, density), Demo (operator only: seed status, reset).

Delete account requires typing the email and password; explains what is deleted vs anonymised.

---

## 16. App: `/app/developers`

Key table (name, prefix, scopes, last used, revoke), create dialog with scope checkboxes and a
one-time secret reveal (copy button, warning, "I have stored it" checkbox before closing), usage chart
(7 days) and quota bar, and the same snippets as the public developers page but with the user's key
placeholder.

---

## 17. Extension surfaces (summary)

| Surface | Content |
| --- | --- |
| Popup (360×420) | Current site verdict, coverage, top finding, "Full report", "Report", settings link, pairing state |
| Banner | Non-blocking, top-right, 1 line + "Details" |
| Overlay (block) | Full-width modal on the page: what was stopped, observed vs expected, **Go back** primary, **Proceed anyway** secondary (confirm), **Report** |
| Options | Account pairing, protection toggle, cache TTL display, privacy statement, clear data |

Detailed behaviour: `../05-browser-extension/BROWSER_PROTECTION_LOGIC.md`.

---

## 18. Responsive behaviour

| Breakpoint | Changes |
| --- | --- |
| ≥ 1280 | Two-column scan report, full sidebar |
| 1024–1279 | Scan report single column with rail below; sidebar icons only |
| 768–1023 | Sidebar drawer; tables stay tables but drop low-priority columns |
| < 768 | Single column; tables → stacked cards; graph canvas 320 px tall with list view default; overlay uses full width with 16 px margins |

The demo must work at 1280×800 (projector) and 390×844 (phone) without layout breakage.

---

## 19. Copy deck (canonical strings)

| Context | String |
| --- | --- |
| `ALLOW` label | "No known threat" |
| `ALLOW` sublabel | "Based on {n}% coverage. This is not a guarantee." |
| `BLOCK` label | "Blocked" |
| `WARN` label | "Suspicious" |
| `REVIEW` label | "Needs review" |
| `UNKNOWN` label | "Not verified" |
| Payee mismatch | "This page asks for {observed}. {org} has registered {expected}." |
| Credential mismatch | "This login form sends your password to {observed}, which is not an approved {org} login endpoint." |
| Unverifiable | "We could not verify this claim. {org} has no registered {thing} to compare against." |
| Cold start | "Waking the analysis engine. This can take up to a minute." |
| Simulated | "Simulated for demonstration. Not a real incident." |

These strings are the source for both the UI and the extension; keep them in one module
(`lib/copy.ts`) so the extension can mirror them.
