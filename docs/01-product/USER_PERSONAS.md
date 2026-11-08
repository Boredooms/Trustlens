# USER_PERSONAS

> **Status:** DECIDED · **Group:** 01-product · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** user segments, goals, frustrations, permissions and product needs.
> **Related:** [`USER_JOURNEYS.md`](USER_JOURNEYS.md) · [`../03-backend/AUTHENTICATION_AUTHORIZATION.md`](../03-backend/AUTHENTICATION_AUTHORIZATION.md)

---

## 1. How to use personas

Personas drive copy, default settings and priority. When a design decision is contested, ask which
persona it serves. A feature that serves nobody in this document is out of scope.

Each persona includes: context, goals, frustrations, what they need from TrustLens, where they
interact, and their permissions. Permissions reference the matrix in
`../03-backend/AUTHENTICATION_AUTHORIZATION.md` §5 — this document does not redefine them.

---

## 2. P1 — Aisha, the applicant (individual user)

**Context.** 19, applying to universities abroad, does most things on a phone, has been told her
whole life that the padlock means safe.

**Goals**

- Apply to the right portal without losing money or identity.
- Know *why* something is suspicious, in one sentence, not a wall of jargon.

**Frustrations**

- Security tools say "suspicious" with no explanation, or "safe" when the site was a scam.
- Warnings that require reading a certificate chain to understand.
- Anything that asks her to install something and then does nothing visible.

**What she needs**

- A warning at the exact moment she is about to type a password or pay.
- The specific mismatch in plain language: "This page asks you to pay
  `northstar-fees@okaxis`, which is not a payment address Northstar University has registered."
- A one-tap report.
- Reassurance that the extension is not reading her passwords.

**Where.** Extension popup and overlay; public checker on mobile web.

**Permissions.** `user` (or anonymous for the public checker). She never sees a dashboard.

**Design implications.** Overlay must be readable at 360 px, one primary action, dismissible but
with an explicit "I understand the risk" confirmation. Copy avoids "safe" (BR-002).

---

## 3. P2 — Dev, the developer

**Context.** Builds a marketplace checkout; wants to stop fraudulent seller links and payee details
before users act.

**Goals**

- Integrate in under 30 minutes with typed responses.
- Get a deterministic, explainable answer he can log and act on.
- Know what happens when the API is slow or down.

**Frustrations**

- SDKs that return prose instead of structured fields.
- Inconsistent schemas between docs and reality.
- Rate limits discovered in production.

**What he needs**

- `POST /api/v1/assess` with `intent` and a stable decision enum.
- Typed errors with `retryable` and `requestId`.
- Documented rate limits and a `429` that tells him when to retry.
- A local test key and a sandbox domain set.

**Where.** SDK, API keys page, developer docs.

**Permissions.** `user` + `service` (API key scopes `assess:read`, `reports:write`).

**Design implications.** The developers page must show a working `curl` and TypeScript snippet with
the same field names the API returns. No camelCase translation.

---

## 4. P3 — Meera, the university IT/security lead (org admin)

**Context.** Runs IT for a university that is impersonated two to three times a month. Cannot get
lookalikes taken down fast enough.

**Goals**

- Publish the authoritative list of official domains, login hosts and fee accounts.
- Be alerted when a lookalike appears and when a certificate her sites depend on is affected.
- Give her helpdesk a tool to check a link a student forwarded.

**Frustrations**

- Takedown is reactive and slow.
- No single place that says "these are our real domains".
- Certificate incidents that surface as an opaque browser error.

**What she needs**

- Trust Profile management with verification she can complete without a support ticket.
- A monitoring list with certificate expiry and issuer dependency.
- A shareable report link for the helpdesk.

**Where.** `/app/organisations/*`, `/app/certificates`, reports.

**Permissions.** `org_admin` for her organisation; read-only elsewhere.

**Design implications.** Verification UI must show the exact DNS record to paste, with a copy
button and a re-check that reports the observed value on failure.

---

## 5. P4 — Rohan, the security analyst

**Context.** SOC analyst at a fintech partner; triages a queue of reported URLs each morning.

**Goals**

- Decide fast: is this a campaign, a false positive, or noise?
- Record a defensible reason for the decision.
- Hand a clean incident narrative to non-technical stakeholders.

**Frustrations**

- Tools that give a score with no evidence.
- Re-investigating the same infrastructure from scratch each time.
- Reports that cannot be exported.

**What he needs**

- Scan report with findings grouped by signal group and expandable evidence.
- Graph traversal from a domain to shared infrastructure.
- Confirm/dismiss with a required reason.
- An investigation narrative with source references he can paste into a ticket.

**Where.** `/app/scan/:id`, `/app/intelligence`, `/app/reports`, `/app/campaigns`.

**Permissions.** `analyst` (global review rights) plus `user`.

**Design implications.** Dense but calm layout; keyboard-first navigation; evidence rows must show
source and timestamp; no decorative motion in the app shell.

---

## 6. P5 — Priya, the threat researcher

**Context.** Tracks fraud campaigns targeting Indian education and payments; publishes findings.

**Goals**

- Discover related infrastructure she did not know about.
- Distinguish "shares a hosting provider" (weak) from "shares a payment recipient" (strong).
- Export a subgraph and the underlying evidence.

**Frustrations**

- Graphs that draw every shared CDN as a relationship and become hairballs.
- Confidence presented as fact.
- No way to see why an edge exists.

**What she needs**

- Edge-level confidence and evidence.
- Filtering by edge type and confidence threshold.
- Campaign clusters with a stated confidence and member list.
- Export (JSON) of a subgraph and its evidence.

**Where.** `/app/intelligence`, `/app/campaigns`.

**Permissions.** `analyst` + `user`.

**Design implications.** Graph legend must name every edge type; selecting an edge opens an
evidence drawer; default filter hides edges below 0.5 confidence.

---

## 7. P6 — The platform operator (internal)

**Context.** One of us, on demo day, responsible for the environment.

**Goals**

- Know at a glance whether the system is healthy and seeded.
- Run the simulated CA incident safely and clearly labelled.
- Recover from a failed demo step without redeploying.

**Frustrations**

- Cold starts during a presentation.
- Demo data that drifts from what the runbook says.

**What he needs**

- `/health`, `/ready`, a seed command, and a reset command.
- An operator-only way to trigger the simulated incident.
- Logs with request IDs.

**Where.** Terminal, `/app/settings` (operator panel), Render dashboard.

**Permissions.** `operator` flag on a normal account.

**Design implications.** The operator panel is visually distinct (a banner reading "Operator mode —
simulated data visible") so it is never mistaken for production truth.

---

## 8. Persona → feature priority

| Feature | P1 Aisha | P2 Dev | P3 Meera | P4 Rohan | P5 Priya | P6 Operator |
| --- | --- | --- | --- | --- | --- | --- |
| TL-001 URL assessment | ● | ● | ● | ● | ● | ○ |
| TL-004 risk & decision | ● | ● | ● | ● | ● | ○ |
| TL-006/007 trust profiles + verification | ○ | ○ | ● | ○ | ○ | ○ |
| TL-008 payment verification | ● | ● | ● | ● | ● | ○ |
| TL-009 action integrity | ● | ● | ● | ● | ○ | ○ |
| TL-012/019 reports & propagation | ● | ○ | ● | ● | ● | ○ |
| TL-013 graph & campaigns | ○ | ○ | ○ | ● | ● | ○ |
| TL-014 AI investigation | ○ | ○ | ● | ● | ● | ○ |
| TL-015 SDK | ○ | ● | ○ | ○ | ○ | ○ |
| TL-016/017 extension | ● | ○ | ○ | ○ | ○ | ○ |
| TL-020 certificates | ○ | ○ | ● | ○ | ○ | ● |
| TL-023 dashboard overview | ○ | ○ | ● | ● | ● | ● |

● primary need · ○ secondary/no need

---

## 9. Anti-personas

Explicitly not designed for, and not a reason to add features:

- **The attacker** trying to poison reports, enumerate our customers or use the scanner to probe
  internal networks. Their needs are handled by abuse controls, not features.
- **The enterprise buyer** wanting SSO, SCIM, SLAs and on-prem. FUTURE at best.
- **The casual "is this site safe?" user** who wants a binary answer. We will not give one; we give
  a decision plus coverage, and copy that explains the difference.
