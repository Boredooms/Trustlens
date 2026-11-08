# Live demonstration script (deliverable 9)

Five minutes, ordered by rubric weight. Every step uses the running local stack
(`scripts/dev-up.ps1` or the README steps). Demo hosts are simulated (`.example`, ADR-016).
Expected outcomes are those recorded in [`TESTING_REPORT.md`](TESTING_REPORT.md).

| # | Rubric line | Do | Show |
| --- | --- | --- | --- |
| 1 | Cybersecurity 30 % · false positives | **Scan** `https://pay.northstar-demo.example/fees`, intent payment | `ALLOW` / Low risk, `IDENTITY_MATCH_CONFIRMED` + `PAYEE_MATCH_CONFIRMED`, coverage 100 %, "No known threat" (never "safe"), certificate report "not evidence the site is legitimate" |
| 2 | Cybersecurity 30 % · phishing + TLS | **Scan** `https://apply.northstar-admissions.example/register`, intent payment | `BLOCK` via `O-2`, observed payee vs registered payee, credential sink mismatch; then scan `https://revoked.badhost.example/` → certificate report **trust may be compromised** (OCSP revoked) vs `https://old.northstar-demo.example/` → **misconfigured** (expires in 5 days) |
| 3 | AI 20 % · explainability, contextual analysis | **Messages** → sample "Fake fee demand" → Analyse; then "Pushy but genuine fee reminder"; then "Urgent wording, no evidence" | `BLOCK` with defanged link assessed `BLOCK`, payee contradicting Northstar's profile, narrative citing `F-n`/`E-n`; the genuine reminder stays `ALLOW` (verified link and payee beat tone); pressure alone is exactly `REVIEW` via `O-8` |
| 4 | Web3 20 % · integrity, independent verification | **Reports** → open a report → **On-chain proof** → Anchor on chain → Verify independently; open `/verify/<id>` in a private window; edit one field in "Check a copy of the payload" | `valid: true` with three checks; tampered copy `valid: false`; contract address, tx hash, block; "integrity, not truth" |
| 5 | Deliverable 6 · reproducible verification | Terminal: `pnpm --filter @trustlens/contracts verify-report -- --report <id>` and `pnpm --filter @trustlens/contracts replay` | `INDEPENDENTLY VERIFIED` computed locally from the chain; offline replay prints address + tx and true/false |

Fallbacks: no LLM key → template narrator (labelled). No URLhaus key → labelled fixture listing for
`secure-pay.badhost.example` (scan it to show `LISTED_BY_EXTERNAL_FEED` → `BLOCK` via `O-6`). Chain
node down → anchor panel says "registry unavailable"; scans and reports keep working.

**Not rehearsed in a browser by the build agent:** the UI steps above were verified by component and
integration tests and by the HTTP evidence run, not by viewing the screens. Rehearse once before
presenting.
