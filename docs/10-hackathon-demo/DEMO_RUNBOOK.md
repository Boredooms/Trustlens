# DEMO_RUNBOOK

> **Status:** DECIDED · **Group:** 10-hackathon-demo · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** demo script, seed data, timing, fallbacks, reset.
> **Related:** [`../01-product/USER_JOURNEYS.md`](../01-product/USER_JOURNEYS.md) · [`../03-backend/RISK_ENGINE.md`](../03-backend/RISK_ENGINE.md) · [`../02-architecture/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. The one sentence

> A site with a valid padlock and a perfect URL reputation can still be stealing your fee — and
> TrustLens stops the payment because the payee is not the university's.

Everything in the demo serves that sentence. If a step does not strengthen it, cut it.

---

## 2. Cast and surfaces

| Surface | Role in the demo |
| --- | --- |
| Chrome profile A (clean) | The victim, with the extension installed |
| Chrome profile B | A second user who receives the community warning |
| Dashboard (analyst account) | Investigation, graph, certificates |
| Terminal | One SDK call (optional, 20 s) |

Pre-open tabs, in order: (1) the fake portal, (2) dashboard overview, (3) the seeded campaign,
(4) certificates, (5) a terminal with the command typed but not run.

---

## 3. Seeded data (canonical)

Created by `python -m app.scripts.seed_demo` (idempotent).

| Entity | Value |
| --- | --- |
| Verified organisation | Northstar University, `northstar-demo.example`, sector `education`, country `IN` |
| Verified domains | `northstar-demo.example` (official), `login.northstar-demo.example` (login), `pay.northstar-demo.example` (payment) |
| Verified recipient | `fees@northstar-demo` (UPI VPA), label "Admissions fee account" |
| Genuine site | `https://northstar-demo.example` (ours, inert forms) |
| Lookalike 1 | `apply.northstar-admissions.example` — admissions + payment |
| Lookalike 2 | `apply.northstar-scholarships.example` — scholarship lure |
| Lookalike 3 | `portal.northstar-placement.example` — placement lure |
| Shared infrastructure | nameservers `ns1.badhost.example` / `ns2.badhost.example`; IP `203.0.113.10`; issuer `R3` |
| Scam payee | `fees@okaxis` (used by lookalikes 1 and 2) |
| Credential sink | `https://collect.badhost.example/login` |
| Campaign | "Northstar admissions cluster", expected confidence ≥ 0.6 |
| Monitored certs | `northstar-demo.example` (89 days), `login.northstar-demo.example` (21 days), `pay.northstar-demo.example` (140 days) |
| Simulated incident | Issuer `Demo Intermediate CA`, `simulated: true`, affects 2 monitored domains |

**All forms are inert.** They post to a local sink that discards input; no credential, OTP or payment
detail is stored anywhere. The pages carry a footer: "Demonstration site — do not enter real
information."

---

## 4. Pre-flight (T-15 minutes)

| # | Check | Command/action | Expected |
| --- | --- | --- | --- |
| 1 | API awake | `curl -sS .../ready` | `200`, `database: ok` |
| 2 | Frontend loads | open `/` | renders, no console errors |
| 3 | Demo data present | dashboard overview | 3 lookalike scans, 1 campaign |
| 4 | Extension paired | popup | "Connected as analyst@…" |
| 5 | Lookalike reachable | open tab 1 | HTTPS padlock, page renders |
| 6 | Genuine site reachable | open `/` of northstar-demo | renders |
| 7 | Screen share | 1280×800, browser zoom 100% | text legible on projector |
| 8 | Notifications off | OS + browser | no popups |
| 9 | Recording open | fallback file | paused, ready |
| 10 | Timer visible | phone/clock | — |

If step 1 fails, re-run once after 60 s; if it still fails, go to §10 (fallbacks).

---

## 5. Script (6 minutes)

### 0:00 — The setup (30 s)

> "Universities get impersonated every admissions season. The fake site has a real certificate, a
> real logo, and takes real money. Let me show you one."

Open tab 1. Point at the padlock.

> "HTTPS is valid. Any URL scanner says 'no known threat'. That is the problem: encryption is not
> identity."

### 0:30 — The lure (30 s)

Scroll the fake portal: admissions copy, "Application fee ₹1,200", a login form.

> "It asks for a password and a fee. Both go somewhere the university does not control."

### 1:00 — The warning (60 s)

Click the payment button. The extension overlay appears.

> "TrustLens stopped the payment **before** the money moved. Not because the certificate is bad — it
> is valid. Because this page asks you to pay `fees@okaxis`, and Northstar University has registered
> `fees@northstar-demo`."

Point at the two values, then at the coverage line.

> "It also tells you how much it actually checked: 85 percent. We never say 'safe' — we say what we
> verified."

### 2:00 — The dashboard verdict (60 s)

Switch to tab 2, run a scan of the same URL with intent `payment` (pre-filled). Wait ~8 s.

> "Same engine, full report. Decision: blocked. Risk: critical. Coverage: 85 percent."

Expand findings: identity mismatch, credential destination, payee mismatch, shared infrastructure.

> "Each line has evidence: the DNS answer, the certificate fingerprint, the form action, the payee
> string. No black box."

### 3:00 — The investigation (60 s)

Click **Investigate**. Step timeline runs.

> "The AI does not decide anything. The rules already decided. It explains **why**, and every sentence
> points at a finding."

When the narrative appears, hover a `[F-2]` reference.

> "That reference is a database row. If the model invents a claim without one, we delete the claim."

### 4:00 — The campaign (60 s)

Open the campaign (tab 3).

> "Three sites — admissions, scholarships, placements — look unrelated. They share nameservers, a
> certificate issuer and the same payee. One operation."

Point at the confidence value.

> "80 percent, and we show the number. Sharing a hosting provider alone is weak evidence; we say so."

### 5:00 — The network (45 s)

Profile A: report the site (pre-typed, one click). Switch to profile B, open the lookalike.

> "One confirmed report becomes protection for everyone. Profile B has never seen this site, and it is
> already warned."

### 5:45 — The CA twist (30 s)

Tab 4, certificates.

> "And when an issuer has an incident, we can tell you which of your domains depend on it."

Click **Run simulated CA incident** (operator). It is labelled **Simulated**.

> "This is simulated for the demo — the label is part of the product, not decoration."

### 6:15 — Close (15 s)

> "Every website has an identity. Every action has a risk. We verify both. The extension protects
> users, the API protects products, and the network gets smarter with every report."

---

## 6. Timing discipline

| Segment | Budget | Cut if over |
| --- | --- | --- |
| Setup + padlock | 30 s | tighten to one sentence |
| Lure | 30 s | skip scrolling |
| Overlay | 60 s | drop the coverage line |
| Dashboard | 60 s | collapse findings to two |
| Investigation | 60 s | show the pre-run investigation |
| Campaign | 60 s | show the pre-loaded graph |
| Network | 45 s | narrate without switching profiles |
| CA | 30 s | skip; mention in closing |
| Close | 15 s | — |

Total 6:15 with 45 s of slack for a cold start.

---

## 7. Warm-up procedure

```bash
# ONE request, then wait. Never a loop.
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.example/ready
# then open the dashboard and run one throwaway scan of a benign URL
```

Do this 10 minutes before, and again 2 minutes before if the room is quiet. A sleeping instance takes
30–60 s to answer; the UI shows "Waking the analysis engine" during that window.

---

## 8. Expected results (exact)

| Step | Expected |
| --- | --- |
| Overlay decision | `BLOCK` |
| Overlay values | observed `fees@okaxis`, expected `fees@northstar-demo` |
| Scan decision | `BLOCK`, `risk_level: HIGH`, score 62 (overrides change the decision, not the band — RISK_ENGINE §8.6) |
| Findings present | `DOMAIN_NOT_REGISTERED_BY_BRAND`, `PAYEE_NOT_IN_VERIFIED_PROFILE`, `SHARED_INFRA…` |
| Coverage | 100% for the payment scan (all five groups collected); 65% for a `browse` check (credential and payment groups are skipped by intent) |
| Investigation | ≥ 5 claims, all with refs; `ai.generated` true or false, labelled |
| Campaign | 3 members, confidence ≥ 0.6 |
| Campaign confidence | 0.80 ("Northstar admissions cluster") |
| Profile B | `WARN` (score 39) with `RELATED_THREAT_FOUND`, on **lookalike 3** (`portal.northstar-placement.example`) after the analyst confirms profile A's report |
| Incident | badge `Simulated`, 2 affected domains |

If the score differs from ~62, that is acceptable; the decision and the payee finding are the
assertions that matter.

---

## 8.1 Automated rehearsal

```bash
cd apps/api
python -m app.scripts.reset_demo && python -m app.scripts.seed_demo
python -m app.scripts.demo_check          # 26 assertions over HTTP; exit code 0 = demo path intact
```

How the network beat works: confirming profile A's report marks the reported page's credential sink
(`https://collect.badhost.example/login`) and payee (`fees@okaxis`) as confirmed threats. Lookalike 3
submits to the same sink, so profile B's `browse` check is one hop from a confirmed threat
(`RELATED_THREAT_FOUND`) and warns. Before the confirmation, lookalike 3 at `browse` carries no
reputation finding. The demo hosts are answered by recorded fixtures in `DEMO_MODE` (ADR-016); the
pages the browser shows are served by `apps/demo-sites`.

## 9. Failure recovery

| Failure | Immediate action | Narration |
| --- | --- | --- |
| Cold start mid-demo | Keep talking; open dashboard (shows waking banner); retry | "It is waking up — free tier. The verdict is cached from the pre-flight, here it is." |
| Extension not showing | Reload the page once; if still absent, use the dashboard | "Same engine, same decision — here is the report." |
| Scan slow (> 20 s) | Open the pre-run scan from recent scans | "Here is one I ran earlier; identical input." |
| LLM down | Report renders as template | "This one used the deterministic template — the findings are the same, the prose is plainer." |
| Graph empty | Open the pre-seeded campaign link | "Here is the cluster from the earlier correlation." |
| Report fails | Skip step 5 | "Reports propagate on confirmation; I will show that in the dashboard." |
| Total network loss | Play the recording | "I recorded this run fifteen minutes ago; identical steps." |
| Projector too small | Zoom to 110%, single window | — |

Never debug live for more than 20 seconds. Switch to a fallback and keep the story moving.

---

## 10. Reset procedure

```bash
# Between rehearsals
python -m app.scripts.reset_demo     # removes seeded scans/reports/campaigns, keeps org + domains
python -m app.scripts.seed_demo      # re-creates the canonical dataset
```

Then:

1. Clear the extension's cached verdicts (options → Clear local data → re-pair if needed).
2. Close extra tabs; reopen the five demo tabs in order.
3. Confirm profile B is signed out of the dashboard and has the extension paired.

Reset refuses to run when `ENVIRONMENT=production` without `ALLOW_DEMO_SEED=1`. Audit rows are not
deleted by reset.

---

## 11. Presenter notes

- Say "no known threat", never "safe".
- Say "we could not verify", never "it is fake" when coverage is low.
- Name the observed and expected values out loud; that is the whole product.
- Say "simulated" every time the incident appears.
- If asked "is this AI deciding?" — "No. Rules decide; the model explains. That is deliberate."
- If asked about false positives — "We gate on coverage, we show our reasons, and there is an appeal
  path. A wrong block is a bug we can see and reverse."
- If asked about scale — "One backend, one database today; the graph is relational and the path to a
  queue is documented."

---

## 12. Judge Q&A prep

| Question | Answer |
| --- | --- |
| Isn't this just a URL scanner? | No: we verify authorisation for a specific action, against a verified profile, and explain with evidence. |
| What if the org has no profile? | We say "unverifiable" — we never claim fraud from absence of data. |
| How do you get profiles? | Domain challenge for control; attestation for payees; university/fintech pilots first. |
| How is this defensible? | The verified registry + the graph + distribution through the SDK and extension. Not the model. |
| What about privacy? | We never store credentials or form values; extension sends metadata only; retention documented. |
| Can attackers poison reports? | Distinct-reporter thresholds, analyst confirmation, decay, rate limits, audits. |
| What is not built? | Live CT polling, KYB, active scanning, billing, MCP. We list them on `/security`. |

---

## 13. Post-demo

1. Collect the scan IDs shown, so any judge question can be answered with a real report.
2. Export the investigation as Markdown for the submission appendix.
3. Note any step that failed and update §9.
4. If the demo required a workaround, file it as a bug — the runbook must describe the real product,
   not a rehearsed fiction.
