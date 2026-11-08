# BUILD_PROMPT — TrustLens, graded build brief

**Purpose.** `MASTER_PROMPT.md` describes the codebase you inherited. This document tells an agent
what to *build* on top of it so the project satisfies the HackMatrix problem statement and scores
against its rubric.

**Read this with:** `MASTER_PROMPT.md` (inventory, machine state, traps), `handover/HANDOVER.md`
(state at transfer), `14-testing/TESTING_STRATEGY.md` (test conventions).

**Status of the claims here.** Every "exists" in §3 was verified by reading the code, not the docs.
Every "missing" in §4 was verified by search. If you find a contradiction, the code wins — and fix
this file in the same commit (§16, trap 12).

---

## 1. THE PROMPT (paste this into a fresh session)

**▼ START — copy from the next line to the END marker ▼**

You are working in `C:\trustlens\trustlens` on **TrustLens**, a digital-trust scanner entered in a
48-hour hackathon. The application is substantially built. Your job is **not** to re-architect it.
Your job is to close four missing capability gaps, produce the evidence artefacts the judges require,
and leave the repository in a state that can be cloned, run and graded by a stranger.

### 1.0 Rules of engagement

1. **The risk engine is the product.** `apps/api/app/risk/` (engine, codes, rules, reasons) is
   authoritative: 42 finding codes, five signal groups weighted reputation 30 / identity 25 /
   credential 20 / payment 15 / infrastructure 10, overrides `O-1`…`O-7`, and a coverage model where
   `ALLOW` means "no known threat within executed checks", never "safe". Every new capability emits
   findings **through `risk/codes.py`** or it does not ship. No module may compute its own verdict.
2. **Nothing on chain is personal.** No URLs, domains, emails, message text, phone numbers, scan ids
   that resolve off-chain, or user identifiers. Only hashes, counters, addresses, timestamps and
   status. This is a graded requirement, not a preference.
3. **AI never invents a finding.** The LLM narrates an evidence pack; `agents/narrative.py::validate`
   rejects claims without evidence references. Keep the template narrator (`template_narrative`)
   working with **no API key** — the demo must survive a missing secret.
4. **Language alone cannot condemn.** A message that is urgent, poorly spelled or pushy may reach
   `REVIEW` at most. `BLOCK` requires corroboration: a malicious destination, a reputation hit, or a
   credential/payment mismatch. The problem statement says so explicitly and judges test it.
5. **Spec before code.** `AGENTS.md` rule 1: no new endpoint, enum value, table, finding code or
   error code that is not first described in its owning document under `docs/`. Update the spec, the
   OpenAPI description and the code in one change.
6. **No intrusive testing.** One ordinary HTTPS GET and a TLS handshake per target. Never probe
   paths, never send payloads, never authenticate against a target, never scan an address range.
7. **Ship less, working.** Judges score demonstrated function, not technology count. A verified
   local chain beats a broken Sepolia deployment. A confident `UNAVAILABLE` beats a fabricated hit.

### 1.1 Read, in this order (do not skip)

- `docs/handover/HANDOVER.md` → current state, hosted services, 14 traps.
- `docs/handover/PROGRESS_LOG.md` → why decisions were made; do not re-litigate them.
- `docs/MASTER_PROMPT.md` §2 (inventory), §6 (machine state), §7 (bring-up), §15 (traps).
- `docs/AGENTS.md` and `apps/api/app/risk/codes.py` → the laws and the finding registry.
- `apps/api/app/risk/engine.py` → weights, `score()`, `overrides_for()`, `decide()`.
- `apps/api/app/agents/narrative.py` → `build_pack`, `template_narrative`, `llm_narrative`,
  `validate`. This is the AI story; understand it before adding any other AI surface.
- `apps/api/app/services/collectors.py` → DNS, RDAP, TLS, redirects, static page analysis.
- `apps/api/app/services/guard.py` → SSRF and target-safety rules. Every outbound call goes here.
- `apps/api/app/models/tables.py` → 25 tables. Note `Certificate`, `CertificateMonitor`,
  `CertificateIncident` already model certificate trust.
- Only grep `docs/handover/CONVERSATION_LOG.md`; never read it whole.

### 1.2 Establish a baseline before changing anything

Work on Windows, bash syntax, `PYTHONIOENCODING=utf-8`.

1. `git init` is required — the repository has **no** `.git`, and a public repo is a graded
   deliverable. Audit `.gitignore` first, confirm no `.env*` is tracked, then commit the untouched
   tree as `chore: import existing tree`. Never commit a secret.
2. Rebuild the API environment. `apps/api/.venv` is broken (points at a removed Python 3.13). Only
   Python 3.14 is installed and the pinned dependencies may lack wheels — install 3.12 or 3.13,
   recreate the venv, `pip install -r requirements-dev.txt`.
3. Start the database. Docker is installed but the daemon is not running. `docker compose up -d db`.
4. `alembic upgrade head` → `python -m app.scripts.seed_demo` → `python -m app.serve` (:8000).
5. `pnpm --filter @trustlens/web dev` (:5173) and `node apps/demo-sites/server.mjs` (:8081).
6. Run `demo_check` and `platform_check` and **record the real numbers** in
   `docs/evidence/baseline.md`. If a check fails, that failure is your first work item; do not
   proceed on a broken baseline and do not soften a check to make it pass.
7. Note in `baseline.md`: node/pnpm/python versions, docker status, test counts actually observed,
   and anything that did not run. Never report an unrun check as passing.

### 1.3 Workstream A — Web3 report registry (20% of grade, currently 0% built)

Implement an on-chain integrity registry for threat reports. Off-chain stays authoritative; the
chain proves the report was not altered afterwards. Design and acceptance criteria are in **§6**;
follow that section exactly, including the privacy rule and the reproducible local chain.

Deliver: contract, deploy + seed scripts, API anchor/verify routes, an on-chain proof panel on the
report page, a public `/verify/:reportId` page needing no login, and
`docs/evidence/web3/` containing contract address, deploy tx hash, block number, chain id, and one
command a judge can run to reproduce all of it.

### 1.4 Workstream B — pasted message / scam analysis (Module 3, missing)

Add deterministic message analysis that turns a pasted email or SMS into indicators and findings,
and hands extracted URLs to the **existing** scan pipeline. Specification in **§7**. The bar: the
same message produces the same findings every time, with no model call; the model only explains.

Deliver: extraction module, message endpoint, findings registered in `codes.py`, UI surface, and a
fixture set of 3 scam and 3 legitimate messages used by tests and the demo.

### 1.5 Workstream C — external threat intelligence (mandatory MVP row, missing)

Integrate at least one real external source behind `guard.py`, with caching, attribution, and an
honest `UNAVAILABLE` path, plus an offline fixture mode so the demo works on a hostile network.
Specification in **§8**.

Deliver: provider client, normalisation into findings, `intel_sources` provenance on evidence,
fixtures, and a test proving a hit and a timeout both behave.

### 1.6 Workstream D — certificate depth and security headers (Module 2 / Module 5)

Certificate storage is already strong; the analysis is thin. Add revocation, CT presence, a
distrusted-issuer advisory path (the seeded simulated CA incident is the eMudhra analogue), weak-key
and hostname checks. Add a non-intrusive security-header posture pass. Specification in **§9**.

Deliver: new finding codes in the infrastructure group, extended TLS collector, header analyser,
and a certificate report that distinguishes "misconfigured" from "trust may be compromised".

### 1.7 Workstream E — evidence, docs, repo hygiene

A judge with the repo must reach a working demo in under ten minutes. Specification in **§10**.
This is not paperwork: deliverables 2, 7, 8 and 9 are graded artefacts and they are currently
missing.

Deliver: `README.md` that actually works from a clean clone, architecture and pipeline docs,
a threat-intelligence-source doc with licensing/limits, a **testing report** with 3 suspicious and 3
benign cases with observed results, `docs/evidence/` screenshots and JSON, and a one-command
`make demo` equivalent.

### 1.8 Order of work

Do not interleave. Baseline → git → A (highest graded weight, largest gap) → B → C → D → E. If time
runs out, an unfinished workstream must be left **off by default** behind a config flag and
described as unfinished — never half-wired into the verdict path.

### 1.9 Definition of done

`§17` is the acceptance checklist. Each line is evidence, not assertion. Report per §18: what you
built, what you verified and how, what remains, what you could not run. Never claim a check you did
not run.

**▲ END — stop copying here ▲**

Everything after this point is reference material. The prompt above is self-contained: it names the
four gaps, their acceptance bars and the order of work; the sections below supply the detail.

---

## 2. Rubric → work mapping

| Category | Weight | What earns the marks | Where the work lives |
| --- | --- | --- | --- |
| Cybersecurity & threat detection | 30% | Phishing detection depth, **certificate analysis**, evidence quality, **false-positive handling** | Existing engine + §9 |
| AI implementation | 20% | Intelligent investigation, contextual analysis, **explainability** | Existing `agents/` + §7 |
| Web3 integration | 20% | Meaningful reporting, integrity, **independent verification** | §6 — from zero |
| Technical implementation | 20% | Working architecture, reliability, integration quality | Baseline, §10, §8 |
| Innovation & UX | 10% | Practical relevance, usability, originality | §13 demo script |

Consequences of that ordering:

- Web3 is worth **twice** the innovation category and is currently absent. It is the single highest
  expected-value workstream, and it cannot be faked: the deliverable is "contract address and
  transaction reference **or equivalent reproducible verification**". A local chain with a
  one-command replay satisfies the "equivalent" clause; a screenshot does not.
- False-positive handling is named explicitly at 30% band. The existing design already refuses to
  call `ALLOW` "safe" and refuses to let unreachable targets become verdicts. Protect that property,
  and make it visible in the demo: show a legitimate site scoring low **with** evidence.
- "Evidence quality" means each finding carries source, timestamp and the raw observation. Do not
  add a capability that emits a label without a citable observation.

---

## 3. Verified current state

Read from code on 2026-11-08. "Exists" means found by search, not assumed.

| Module / requirement | State | Evidence in repo |
| --- | --- | --- |
| Module 1 — URL & domain investigation | **Exists** | `services/collectors.py` (DNS, RDAP, TLS, redirects, static page), `services/scan_orchestrator.py`, `routes/scans.py`, 68 OpenAPI operations |
| Module 1 — external intelligence | **Missing** | No `urlhaus`/`openphish`/`phishtank`/safe-browsing reference anywhere in `apps/api/app` |
| Module 2 — TLS & web trust | **Partly exists** | `collect_tls` captures issuer CN, subject CN, SANs, validity window, days to expiry, SHA-256 fingerprint, key type/size, signature algorithm, `verified`, handshake failure. Tables `certificates` (SANs, root issuer, chain length, self-signed, simulated), `certificate_monitors`, `certificate_incidents` |
| Module 2 — revocation, CT, distrusted CA | **Missing as analysis** | No OCSP/CRL, no CT lookup, no distrusted-issuer registry; `certificate_incidents` exists but only `simulated` rows are permitted (enforced by a check constraint) |
| Module 3 — message / scam analysis | **Missing** | No urgency, social-engineering, OTP or email-body analysis in the API |
| Module 4 — threat correlation | **Exists** | `entities`, `relationships`, `campaigns`, `investigations`, `routes/intelligence.py`, `routes/investigations.py` |
| Module 5 — security-header assessment | **Missing** | Header names appear only in `api/middleware.py`, which sets TrustLens' *own* headers |
| Module 6 — Web3 registry | **Missing** | No chain, contract, or web3 dependency; grep hits are the word "contract" meaning API contract |
| AI narration / explainability | **Exists** | `agents/narrative.py`: `build_pack` → `template_narrative` (no model needed) → `llm_narrative` → `validate`; config has `llm_*` settings and `llm_configured` |
| Five-class risk vocabulary | **Exists, different words** | `Decision`: `BLOCK`/`WARN`/`REVIEW`/`ALLOW`/`UNKNOWN` — see §5 for the bijection |
| Three suspicious + three benign cases | **Partly** | Demo scenarios exist; no documented testing report artefact |
| Public repo, setup instructions | **Missing** | No `.git`; `README.md` references a nonexistent `apps/extension/README.md` |

Treat §5 as settled: the classification vocabulary already satisfies the problem statement. Do not
invent a second risk vocabulary, and do not rename `Decision`.

---

## 4. Gap register

| # | Gap | Severity | Workstream | Blocked by |
| --- | --- | --- | --- | --- |
| G1 | No on-chain report registry | Graded 20% | A | Nothing (local chain is acceptable) |
| G2 | No message analysis | Module 3 | B | Nothing |
| G3 | No external intelligence source | Mandatory MVP row | C | Provider key (free tier) or fixture-only fallback |
| G4 | Certificate analysis depth | 30% band | D | Nothing |
| G5 | No header posture | Module 5 | D | Nothing |
| G6 | No `.git`, README broken | Deliverable 2 | E / baseline | Nothing |
| G7 | No testing report | Deliverable 8 | E | B, C, D producing findings to document |
| G8 | No evidence bundle | Deliverable 6 | E | A |
| G9 | Venv broken, Docker daemon off | Blocks everything | baseline | Local tooling |

---

## 5. Classification mapping (authoritative)

The problem statement requires exactly five classes. `Decision` already has exactly five members
with matching intent. Map, do not replace:

| Problem statement | `Decision` | Meaning in this codebase |
| --- | --- | --- |
| Confirmed Malicious | `BLOCK` | Authoritative intelligence or a forced override (e.g. `O-2`) says stop |
| High Risk | `WARN` | Multiple significant indicators; substantial threat |
| Suspicious | `REVIEW` | One or more indicators needing investigation |
| Low Risk | `ALLOW` | No known threat **within executed checks** — never "safe" |
| Inconclusive | `UNKNOWN` | Insufficient data, unreachable target, missing sources |

Implementation rules:

- Expose a derived `risk_class` in read models and the SDK (`low`/`suspicious`/`high`/`confirmed_malicious`/
  `inconclusive`) computed from `Decision` in one place, documented as derived. Do not add a column,
  do not fork the engine, do not let a client map it itself.
- Any document or UI showing `risk_class` must carry the caveat for `low` and `inconclusive`
  verbatim: absence of evidence is not evidence of safety.
- The engine version (`ENGINE_VERSION`) travels with every verdict; a mapping change is an engine
  version bump.

---

## 6. Workstream A — on-chain report registry

### 6.1 What must be true when it is done

1. A threat report is registered on chain and a stranger can verify its integrity **without trusting
   TrustLens' database or UI**.
2. The chain stores no personal data, no URLs, no message content.
3. A replayed, altered report fails verification.
4. A judge can reproduce address, deployment and verification from the repo with one command on a
   machine with no wallet, no funded account and no internet.
5. The UI shows the proof where a human would look for it: on the report they filed.

### 6.2 Chain and tooling

- **Primary:** local EVM chain, `chainId 31337`, Hardhat (Node and pnpm are already installed; no new
  system toolchain). Foundry is acceptable only if already working — do not install a second
  toolchain on demo day.
- **Optional:** Sepolia deployment for a public address, behind an env flag. Never let the demo
  depend on it. If Sepolia is used, the same script must still work locally.
- Pin versions in `package.json`; commit `pnpm-lock.yaml`. Commit compiled artefacts **only** if the
  judge cannot compile (they can — so commit solc output but keep it out of the API's import path).
- Determinism: fixed mnemonic in the script (not a secret — it is a well-known test mnemonic), fixed
  deploy nonce, so address and deploy block are stable across runs. State the mnemonic origin in the
  script header ("public Hardhat test mnemonic, dev only, never funded on mainnet").

### 6.3 Contract surface

`contracts/ThreatReportRegistry.sol`. Keep it small enough to read on one screen; judges read it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Integrity registry for off-chain threat reports.
/// @notice Stores commitments only. No URLs, no message text, no personal data, ever.
contract ThreatReportRegistry {
    enum Status { Unknown, Active, Disputed, Withdrawn }

    struct Record {
        bytes32 commitment;   // keccak256(reportId, payloadHash, salt, revision)
        bytes32 payloadHash;  // sha256 of canonical off-chain payload (no PII)
        address reporter;
        uint64  registeredAt;
        uint32  revision;
        Status  status;
    }

    mapping(bytes32 => Record) private _records; // reportId => record
    uint256 public total;

    event ReportRegistered(bytes32 indexed reportId, address indexed reporter, bytes32 commitment, uint32 revision, bytes32 payloadHash);
    event ReportDisputed(bytes32 indexed reportId, address indexed by, bytes32 reasonHash);
    event ReportWithdrawn(bytes32 indexed reportId, address indexed by);

    error AlreadyRegistered(bytes32 reportId);
    error NotRegistered(bytes32 reportId);
    error NotReporter(bytes32 reportId);
    error EmptyCommitment();

    function register(bytes32 reportId, bytes32 commitment, bytes32 payloadHash, uint32 revision) external {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        Record storage r = _records[reportId];
        if (r.commitment != bytes32(0)) revert AlreadyRegistered(reportId);
        _records[reportId] = Record(commitment, payloadHash, msg.sender, uint64(block.timestamp), revision, Status.Active);
        unchecked { total += 1; }
        emit ReportRegistered(reportId, msg.sender, commitment, revision, payloadHash);
    }

    /// @notice Append a revision. The previous commitment is replaced; history lives in events.
    function revise(bytes32 reportId, bytes32 commitment, uint32 revision) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        if (r.reporter != msg.sender) revert NotReporter(reportId);
        if (revision <= r.revision) revert EmptyCommitment();
        r.commitment = commitment;
        r.revision = revision;
        emit ReportRegistered(reportId, msg.sender, commitment, revision, r.payloadHash);
    }

    function dispute(bytes32 reportId, bytes32 reasonHash) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        r.status = Status.Disputed;
        emit ReportDisputed(reportId, msg.sender, reasonHash);
    }

    function withdraw(bytes32 reportId) external {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) revert NotRegistered(reportId);
        if (r.reporter != msg.sender) revert NotReporter(reportId);
        r.status = Status.Withdrawn;
        emit ReportWithdrawn(reportId, msg.sender);
    }

    function get(bytes32 reportId) external view returns (Record memory) {
        return _records[reportId];
    }

    /// @notice Independent check: does this report id + payload + salt match the stored commitment?
    function verify(bytes32 reportId, bytes32 payloadHash, bytes32 salt) external view returns (bool ok, uint32 revision, Status status) {
        Record storage r = _records[reportId];
        if (r.commitment == bytes32(0)) return (false, 0, Status.Unknown);
        bytes32 expected = keccak256(abi.encode(reportId, payloadHash, salt, r.revision));
        return (expected == r.commitment, r.revision, r.status);
    }
}
```

Design notes to preserve:

- `revision` is inside the commitment, so a revision cannot be replayed as the original.
- `verify` is `view` and takes only hashes — that is what "independently verify" means here.
- No bond, no token, no ownership. Adding a payable bond buys nothing at this grade and costs demo
  reliability.
- Events are the audit trail. A judge can replay `ReportRegistered` history from the chain alone.

### 6.4 Off-chain commitment

Canonical payload = the report's public fields only: report id, entity descriptor (registrable
domain or indicator type, never a personal URL), category, summary hash, evidence hash list, created
timestamp, reporter pseudonym.

- `payloadHash = sha256(canonical_json_bytes)` where canonical JSON is sorted keys, UTF-8, no
  whitespace, no nulls.
- `salt` = 32 random bytes, generated per report, **returned to the reporter and stored off-chain
  encrypted-at-rest alongside the report** so verification is possible; never logged.
- `commitment = keccak256(abi.encode(bytes32 reportId, payloadHash, bytes32 salt, uint32 revision))`.
- `reportId` = the report's ULID decoded to bytes32, or `keccak256(ulid)` if it is not 16 bytes —
  pick one and document it in §12 of the spec.
- Salt protects low-entropy payloads from dictionary matching. Say this in the docs; it shows
  thought rather than cargo cult.

### 6.5 API surface (spec-first)

| Route | Who | Behaviour |
| --- | --- | --- |
| `POST /v1/reports/{report_id}/anchor` | report owner or analyst | Build payload hash, generate salt if absent, submit `register`, store `{chain_id, contract, tx_hash, block, report_id_bytes32, revision, commitment, anchored_at}`. Idempotent: if an active record exists, return it |
| `GET /v1/reports/{report_id}/anchor` | report owner, analyst, reader | Return the anchor record, or `404`-style "not anchored" state (never a 500) |
| `POST /v1/reports/{report_id}/anchor/verify` | anyone with a payload | Recompute, call `verify`, return `{valid, revision, status, checked_at, contract, chain_id}` |
| `GET /v1/public/verify/{report_id}` | public, no auth | Public verification of an anchored report using server-held salt; returns hashes and status only |

Rules: the chain client is optional. If `CHAIN_RPC_URL` or the contract address is unset, these
routes return a documented `CHAIN_UNAVAILABLE` error and the report page hides the panel. The
verdict path must never depend on chain availability — anchoring is a post-hoc integrity action.

New error codes go in `schemas/enums.py::ErrorCode` **and** the error catalogue doc first:
`CHAIN_UNAVAILABLE`, `ANCHOR_ALREADY_EXISTS`, `ANCHOR_NOT_FOUND`, `ANCHOR_TX_FAILED`.
New table `report_anchors` (see §11). New env: `CHAIN_RPC_URL`, `CHAIN_ID`, `CHAIN_REGISTRY_ADDRESS`,
`CHAIN_PRIVATE_KEY` (dev-only, documented as such). Production config must refuse to boot with a
chain private key and no explicit enable flag.

### 6.6 UI

- Report detail: an "On-chain proof" panel — contract address (truncated, copyable), report id bytes,
  commitment, revision, status, tx hash, block, chain id, and a "Verify independently" button that
  runs the public route and shows `valid: true/false` with the recomputation inputs.
- Public `/verify/:reportId` page, no login, works in incognito: paste or link-shareable. This is
  the page you show a judge.
- Five states for the panel: loading, not anchored, anchored, verify failed, chain unavailable.
  No dead ends.

### 6.7 Evidence

`docs/evidence/web3/chain.json`:

```json
{ "chain_id": 31337, "contract": "0x…", "deploy_tx": "0x…", "deploy_block": 1,
  "seeded_reports": [ { "report_id": "…", "tx": "0x…", "block": 2, "commitment": "0x…" } ],
  "solc": "0.8.24", "commit": "<git sha>", "generated_at": "…" }
```

Plus `docs/evidence/web3/README.md` with the exact three commands a judge runs, and one screenshot of
the public verify page showing `valid: true` and a second showing `valid: false` after tampering.
Generate the artefacts from the script, never by hand-typing a hash.

---

## 7. Workstream B — message and scam analysis

### 7.1 Shape

New endpoint `POST /v1/messages/analyse` (spec first). Request: `{ text, channel?: "email"|"sms"|"dm"|"other",
organisation_id?, intent? }`. Response: extracted indicators, findings, `decision`, `risk_class`,
narrative, coverage. Max 20 000 characters; reject above with `VALIDATION_FAILED`.

Alternatively `scans` gains an `input_type`, but a separate route is cleaner: messages are not
targets and must not be forced through URL-shaped validation. Choose one and document why.

### 7.2 Stage 1 — deterministic extraction (no model, no network)

Order matters; write unit tests per extractor.

| Extractor | Output | Notes |
| --- | --- | --- |
| URLs | normalised absolute URLs + registrable domain | defang `hxxp`, `[.]`, `(dot)`, `\u2010`-style hyphens; ignore trailing punctuation |
| Emails | address + domain | exclude the sender's own domain from "destination" logic |
| Phones | digits with country hint | never assert country from length alone |
| Payment handles | UPI id, IBAN, card-like Luhn-validated digits, wallet addresses | Luhn-valid only; everything else is "possible identifier" |
| Urgency lexicon | matched span + category | `account suspended`, `within 24 hours`, `final notice`, `act now` |
| Credential request | matched span | `OTP`, `one-time password`, `PIN`, `password`, `CVV`, `KYC`, `re-verify` |
| Payment request | matched span | `pay`, `transfer`, `fees`, `clearance`, `refund`, `processing charge` |
| Impersonation claim | claimed brand + channel style | match against verified brands/domains already in the DB |
| Channel tells | e.g. "reply STOP", sender id | weak signal only |

### 7.3 Stage 2 — findings, and the cap

Every extraction that matters becomes a finding in **existing** groups (`IDENTITY`,
`CREDENTIAL_DESTINATION`, `PAYMENT_DESTINATION`) so the 30/25/20/15/10 weights keep working. New
codes (register in `risk/codes.py`, document in `RISK_ENGINE.md` §7):

| Code | Group | Severity | Fires when |
| --- | --- | --- | --- |
| `MESSAGE_CREDENTIAL_REQUEST` | credential_destination | HIGH | message asks for OTP/PIN/password/CVV |
| `MESSAGE_PAYMENT_DEMAND` | payment_destination | HIGH | message asks for a transfer or "fee" |
| `MESSAGE_IMPERSONATES_ORGANISATION` | identity | MEDIUM | claims a brand that has a verified domain |
| `MESSAGE_LINK_TO_UNVERIFIED_CLAIM` | identity | MEDIUM | claimed brand + link to a domain not registered by it |
| `MESSAGE_URGENCY_PRESSURE` | identity | LOW | urgency lexicon only |
| `MESSAGE_CONTACT_CHANNEL_MISMATCH` | identity | LOW | free-mail sender for a bank/agency claim |
| `MESSAGE_NO_MALICIOUS_INDICATOR` | identity | INFO | nothing corroborating found — the benign case |

**The cap (O-8).** Add an override/guard in `engine.py` documented as `O-8`: if the only findings are
the language-only codes (`MESSAGE_URGENCY_PRESSURE`, `MESSAGE_CONTACT_CHANNEL_MISMATCH`), the verdict
is capped at `REVIEW`. This is the encoded form of "a message should not be labelled fraudulent
solely because it contains urgent language", and it is the single most impressive thing to show a
judge: paste a pushy but legitimate bank notice and get `REVIEW` at most, with the reason stated.

### 7.4 Stage 3 — hand off to the real pipeline

For every extracted URL: run the existing scan path (guard → collectors → findings), attach results
as evidence, and keep the message finding list separate from the link finding list in the response so
the UI can say "the message is suspicious because it claims to be your bank, and the link goes to a
domain your bank does not use". Correlation to existing campaigns/entities comes free from the
existing relationship layer — use it.

### 7.5 Stage 4 — narrative

Build an evidence pack (`build_pack`) that includes message findings with quoted spans. Run
`template_narrative` first and store it; attempt `llm_narrative`, validate; on any failure keep the
template narrative and set a coverage note. Never show raw model output.

### 7.6 Tests

Fixtures in `apps/api/tests/fixtures/messages/`: 3 scam (bank OTP with lookalike link, fake courier
fee, job-offer KYC), 3 legitimate (real bank notice with real domain, genuine receipt, newsletter).
Assertions: exact finding codes, the `O-8` cap on the pushy-legitimate case, deterministic repeat
runs byte-identical, no PII in logs.

---

## 8. Workstream C — external threat intelligence

### 8.1 Provider

Pick **URLhaus** (abuse.ch) as primary: free, terms-permitting, returns recent malicious URLs and
hosts, and needs only an Auth-Key. Add **OpenPhish** community feed as an optional secondary. Do not
add more than two: each source is a failure mode and a licensing claim you must defend in docs.

If no key is available, the provider module must still work in **fixture mode** from
`apps/api/app/intel/fixtures/`. Fixture mode is a documented configuration, not a silent fallback —
the response must say `mode: "fixture"` so nobody mistakes a canned hit for live intelligence.

### 8.2 Implementation rules

- All calls through `daily_budget`/`guard.py` conventions already used for outbound requests:
  timeout ≤ 5 s, no redirects, size cap, no user-controlled headers.
- Cache by registrable domain and by URL hash, TTL 15 minutes for URL, 6 hours for domain, in the
  existing cache/DB path — not in process memory (the API runs multiple workers).
- Respect provider rate limits; on 429 back off and return `UNAVAILABLE` with `retry_after`.
- Normalise to observations, then to findings: a hit emits `KNOWN_MALICIOUS_REPUTATION`
  (critical, reputation) with evidence `{source, queried_at, listing_id, url_status, threat_type}`.
  A confirmed hit is allowed to force `BLOCK` — that is corroboration, not language.
- Attribution is mandatory in every surface: "URLhaus, queried 12:04 UTC, listing 1234567".
  Never present feed data as TrustLens' own finding.
- Document per source: licence/terms, rate limit, what a hit does and does not mean, retention,
  and privacy (do we send the target to a third party? yes — say so, and make it configurable).

### 8.3 Acceptance

- Offline: scan of a fixture-listed domain produces the critical finding with attribution.
- Timeout: scan of anything else finishes `PARTIAL`, verdict unaffected, coverage shows
  `UNAVAILABLE` for the source, UI says "external reputation unavailable" rather than implying clean.
- No key configured: source is simply absent from coverage; the scan still runs.

---

## 9. Workstream D — certificate depth and header posture

### 9.1 Certificate analysis (Cybersecurity 30%)

Already collected: issuer/subject CN, SANs, validity window, expiry days, SHA-256 fingerprint, key
type/size, signature algorithm, self-signed, chain length, root issuer. Missing, add as findings in
`infrastructure`:

| Code | Severity | Fires when | Evidence |
| --- | --- | --- | --- |
| `CERTIFICATE_EXPIRED` | HIGH | `not_after` in the past | not_after, days |
| `CERTIFICATE_EXPIRING_SOON` | LOW | ≤ 14 days | days_to_expiry |
| `CERTIFICATE_NOT_YET_VALID` | MEDIUM | `not_before` in the future | not_before |
| `CERTIFICATE_HOSTNAME_MISMATCH` | CRITICAL | presented cert's SANs do not cover the host | SANs, host |
| `CERTIFICATE_SELF_SIGNED` | HIGH | self-signed | issuer == subject |
| `CERTIFICATE_UNTRUSTED_ISSUER` | CRITICAL | chain does not validate to a trusted root | verification error string |
| `CERTIFICATE_WEAK_KEY` | HIGH | RSA < 2048 or EC < 224 | key_type, key_bits |
| `CERTIFICATE_WEAK_SIGNATURE` | MEDIUM | MD5/SHA-1 signature | signature_algorithm |
| `CERTIFICATE_NO_CT_RECORDS` | LOW | no SCT / no CT log entry found | query timestamp |
| `CERTIFICATE_REVOKED` | CRITICAL | OCSP/CRL says revoked | responder, this_update |
| `CERTIFICATE_ISSUER_UNDER_ADVISORY` | CRITICAL | issuer appears in the advisory table | advisory id, issued_at |

Implementation notes:

- Revocation and CT are best-effort and **timeouts are `UNAVAILABLE`**, never "not revoked". A silent
  OCSP timeout turning into `LOW` risk is exactly the false-negative a judge will probe.
- Distrusted-issuer data is the `certificate_incidents` table. Its own comment says real advisory
  ingestion is FUTURE, and a check constraint forces any row with `source = 'simulation'` to be
  flagged `simulated`. Present simulated advisories as explicitly simulated in every surface — the
  eMudhra story is a *demonstration* of the capability, not a claim about a real CA. Do not insert
  rows that impersonate real advisories.
- Never claim to detect a CA's internal key-generation weakness from a URL. The problem statement
  forbids it. The capability is: "this certificate chains to an issuer under an advisory".
- Output must distinguish **misconfiguration** (expired, weak, no CT) from **trust compromise**
  (untrusted chain, revoked, advisory) in both wording and severity — a "certificate report" that
  lumps them together loses the 30% band.

### 9.2 Header posture (Module 5)

One GET, response headers only. Report per finding: issue, technical evidence (header value or
absence), potential impact, severity, remediation, limitations.

| Check | Severity | Note |
| --- | --- | --- |
| Missing `Strict-Transport-Security` on an HTTPS target | LOW | note max-age requirement |
| Missing or trivially permissive `Content-Security-Policy` | LOW | `unsafe-inline`/`*` counts as weak |
| Missing `X-Content-Type-Options: nosniff` | INFO | |
| Missing `Referrer-Policy` | INFO | |
| Missing `Permissions-Policy` | INFO | |
| `Set-Cookie` without `Secure`/`HttpOnly` on HTTPS | MEDIUM | |
| `Server`/`X-Powered-By` disclosing precise versions | LOW | version only, not banner presence |
| Mixed content on the fetched page (http subresource on https page) | MEDIUM | from the static page analysis, not by crawling |
| Open redirect observed in the redirect chain | HIGH | already have redirect data |

Hard limits: one request, no crawling, no path guessing, no payloads, no authenticated requests, no
rate above one request per target per scan. Each finding carries `limitations` text ("based on a
single unauthenticated response; server-side validation not tested"). Deliverable 4 in the problem
statement says "including TLS certificate analysis" — the header pass supports it, it is not a
substitute.

---

## 10. Workstream E — evidence, docs, repo

### 10.1 Repository (deliverable 2)

- `git init`, `.gitignore` audit, first commit of the untouched tree, then one commit per workstream.
- Verify no secret is tracked: `git grep -nE "sk-|api[_-]key|BEGIN PRIVATE|postgres://.*:.*@"` on the
  tracked tree, and confirm `.env*` is ignored. This must be done **before** the repo is public.
- `README.md` must be true from a clean clone: prerequisites, `docker compose up -d db`, venv rebuild
  with the correct Python, migrations, seed, three dev servers, demo URLs, demo credentials, and the
  one-command chain replay. Fix the dangling `apps/extension/README.md` reference by writing the file
  or removing the line.
- Add `LICENSE`, and a `docs/evidence/` tree that is safe to publish.

### 10.2 Documentation (deliverable 7)

Required artefacts, each a real document, not a paragraph:

1. `docs/03-backend/MESSAGE_ANALYSIS.md` — extraction pipeline, finding codes, the O-8 cap, fixtures.
2. `docs/02-architecture/THREAT_INTELLIGENCE_SOURCES.md` — per source: licence, limits, what a hit
   means, retention, privacy, failure behaviour.
3. `docs/03-backend/CERTIFICATE_ANALYSIS.md` — checks, severities, what is and is not claimed,
   simulated advisories.
4. `docs/02-architecture/WEB3_REGISTRY.md` — contract, commitment scheme, privacy boundary, threat
   model (what an attacker with the reporter's key can and cannot do), replay instructions.
5. Update `docs/INDEX.md`, `docs/DOCUMENTATION_COVERAGE.md` and the drift rows you fix.

### 10.3 Testing report (deliverable 8)

`docs/evidence/TESTING_REPORT.md`, generated from real runs. Six cases minimum, each with: input,
what was expected, what the system returned (decision, score, finding codes with evidence), and a
screenshot or JSON path. Include one **false-positive** case explicitly and one **inconclusive**
case — those are named in the rubric.

Suggested six, using existing demo data:

| # | Case | Expected outcome |
| --- | --- | --- |
| 1 | `northstar-demo.example` benign portal | `ALLOW`, low score, identity confirmed |
| 2 | Lookalike `apply.northstar-admissions.example` | `BLOCK` via `O-2`, `PAYEE_NOT_IN_VERIFIED_PROFILE` |
| 3 | Typo/IDN lookalike of a verified domain | `WARN`/`REVIEW` with typosquat evidence |
| 4 | Pushy legitimate bank message with real link | `REVIEW` at most (O-8) — false-positive handling |
| 5 | Scam SMS with OTP request + `fees@okaxis` | `BLOCK`, credential + payment findings |
| 6 | Unreachable host that cannot be resolved | `UNKNOWN`, coverage explains why |

Record engine version, timestamp and git sha with each case.

### 10.4 Demo (deliverable 9)

The end-to-end path in one take: submit → investigate → assess → report → anchor on chain → verify
independently in incognito. Rehearse it on a machine with no network if the chain and intel fixtures
allow it. Have the fallback order written down (Sepolia → local chain; live feed → fixture).

---

## 11. Data model additions

Migration order matters; one revision per workstream, named after it.

| Table / change | Columns | Why |
| --- | --- | --- |
| `report_anchors` | `report_id` (fk, unique), `chain_id`, `contract`, `report_id_bytes32`, `payload_hash`, `salt_ciphertext`, `commitment`, `revision`, `tx_hash`, `block_number`, `status`, `anchored_at`, `created_by` | §6 |
| `certificate_advisories` (or reuse `certificate_incidents`) | `issuer_cn`, `advisory_id`, `severity`, `source`, `simulated`, `published_at`, `summary` | §9 |
| `intel_sources` / `intel_observations` | `source`, `indicator_hash`, `indicator_type`, `listing_id`, `threat_type`, `queried_at`, `ttl_expires_at`, `raw_hash` | §8, with TTL indexing |
| `message_analyses` | `id`, `channel`, `text_hash`, `char_count`, `extracted_json`, `decision`, `engine_version`, `created_at`, `created_by`, `organisation_id` | §7; store the **hash** and extracted indicators, not the raw text by default |

Raw message text is personal data: default to not storing it. If product requires storing, encrypt
and document retention. Say which you chose in the spec.

---

## 12. API additions and the spec-first rule

Per workstream, in this order: owning document → `openapi.json` description → Pydantic schema →
route → tests → web client. Anything else creates drift that §14 of `MASTER_PROMPT.md` already
records eight examples of.

Endpoints expected: 4 chain routes (§6.5), 1 message route (§7.1), 0–1 intel route (prefer none —
intel is evidence inside scans), 1 certificate-advisory read route if the UI needs it. Keep the
OpenAPI operation count honest in the docs; today it is 68 operations on 55 paths, and that number
appears in several documents.

---

## 13. Demo script — what the judges click

Five minutes, in this order. Each step states the rubric line it earns.

1. **Benign control** (30% false-positive): scan the legitimate demo portal → `ALLOW`, evidence shown,
   explicit "not a clean bill of health" caveat. 
2. **Phishing with certificate analysis** (30%): scan the lookalike → `BLOCK`, `O-2` reason visible,
   then open the certificate panel: issuer, SANs, expiry, and the finding that separates
   misconfiguration from trust issues.
3. **Message AI** (20%): paste the OTP scam SMS → indicators highlighted, link scanned live, narrative
   citing each finding by code. Then paste the pushy legitimate notice → capped at `REVIEW`, with the
   cap explained. That contrast is the AI category in one gesture.
4. **Report + chain** (20%): file the report, anchor it, open `/verify/:id` in an incognito window,
   show `valid: true`. Tamper locally, show `valid: false`. Show `chain.json` and the replay command.
5. **Independent verification** (deliverable 6): hand over the address, tx hash and the one command.
   Then the testing report and architecture doc.

Do not demo features in a different order than the rubric is weighted.

---

## 14. 48-hour plan

| Window | Work | Exit condition |
| --- | --- | --- |
| 0–4 h | Baseline: git init, python 3.12, docker db, migrations, seed, three servers, `demo_check`/`platform_check` numbers into `baseline.md` | Numbers recorded; every failure listed |
| 4–16 h | Workstream A: contract, scripts, chain.json, API, UI panel, public verify page | Replay from clean clone yields `valid: true` and tamper yields `false` |
| 16–24 h | Workstream B: extraction, codes, O-8 cap, route, fixtures, UI | 6 fixtures produce expected codes; determinism test passes |
| 24–30 h | Workstream C: URLhaus client, cache, attribution, fixtures, timeout path | Offline and timeout tests pass |
| 30–36 h | Workstream D: cert findings, advisory path, header posture | Certificate report separates config vs trust; header findings carry limitations |
| 36–42 h | Workstream E: README, 5 docs, testing report from real runs, evidence bundle | A stranger can clone and run |
| 42–46 h | Freeze features. Rehearse demo twice, once offline. Fix only what breaks the demo | Two clean rehearsals |
| 46–48 h | Buffer + submit. No new code | Repo public, artefacts present |

Rules: freeze is a hard gate. A feature that is not demo-ready at T-42 goes behind a config flag and
into the "unfinished" section of the README. Never let an unfinished workstream sit in the verdict
path at demo time.

---

## 15. Verification and evidence bundle

Minimum evidence per workstream, all in `docs/evidence/`:

- `baseline.md` — toolchain, docker, migrations, seed, test counts actually run, failures.
- `web3/chain.json` + `web3/README.md` + 2 screenshots (valid, invalid).
- `messages/` — 6 fixture inputs and their recorded responses (JSON), determinism diff output.
- `intel/` — one live-or-fixture hit with attribution, one timeout with `UNAVAILABLE`.
- `certificates/` — one benign cert, one expiring, one simulated-advisory issuer, one untrusted.
- `headers/` — one target with findings and the limitations text.
- `TESTING_REPORT.md` — the six documented cases.
- `demo.md` — the five-step script with actual screenshots from the final rehearsal.

Verification commands that must exist and be documented: `pytest`, `pnpm -r test`, `pnpm -r build`,
`alembic upgrade head` from empty DB, chain replay, `demo_check`, `platform_check`. A failing check is
reported as a limitation, never hidden, never weakened.

---

## 16. Traps

Inherited from `MASTER_PROMPT.md` §15 (venv interpreter, Docker daemon, selector event loop on
Windows, `PYTHONIOENCODING`, pooler `statement_cache_size`, dev bearer tokens refused in production)
plus these, specific to this build:

1. **PII on chain.** Any URL, email or message text in a contract call is a graded failure and
   unrecoverable. Enforce with a test that inspects the payload builder for forbidden fields.
2. **Salt loss.** If the salt is not persisted, verification is impossible forever. Store it
   encrypted; test the round-trip.
3. **Chain in the verdict path.** Anchoring must never gate a scan result. Test with the chain down.
4. **LLM key absent at demo.** Template narrator must be the default path; test with
   `llm_api_key=None` and assert a narrative still renders.
5. **Model-generated finding ids.** `validate()` rejects unknown codes; never relax it to make a
   narrative pass.
6. **Language-only condemnation.** O-8 exists to prevent this. Test the pushy-legitimate case both
   before and after any rule change.
7. **OCSP/CT timeout read as clean.** Timeouts are `UNAVAILABLE`. Test with a blackholed responder.
8. **Feed data presented as ours.** Attribution is mandatory; a hit without a source is a bug.
9. **Header scan drifting into scanning.** One GET, no paths. Review the code against this line
   explicitly before demo.
10. **Simulated advisories presented as real.** The eMudhra-style incident is a demonstration. Every
    surface must say simulated.
11. **Feature freeze violation.** Post-freeze code changes are how working demos die.
12. **Doc drift.** If you change behaviour, change the owning doc in the same commit — this repo
    currently carries eight known mismatches and a judge may read them.

---

## 17. Definition of done

Deliverables from the problem statement, each with its evidence:

| # | Required | Met when |
| --- | --- | --- |
| 1 | Working prototype, URL/domain investigation | Baseline green; benign and lookalike scans produce evidence-backed verdicts |
| 2 | Public GitHub repo + setup | `.git` exists, no secrets tracked, README reproduces the demo from clean clone |
| 3 | AI demonstration with evidence-based explanation | Narrative cites finding codes; template path works with no key; O-8 contrast shown |
| 4 | Cybersecurity demo incl. TLS analysis | Certificate report distinguishes misconfiguration from trust compromise; header findings with limitations |
| 5 | Web3 demo, testnet or reproducible local chain | One-command replay produces the same contract address |
| 6 | Contract address + tx ref or equivalent verification | `docs/evidence/web3/chain.json` + public verify page + tamper case |
| 7 | Technical docs: architecture, pipeline, intel sources, methodology | Five documents listed in §10.2 exist and match code |
| 8 | Testing report, legit + suspicious, observed results | Six cases with recorded outputs and timestamps |
| 9 | Live end-to-end demo | Five-step script rehearsed twice, once offline |

Platform rules honoured: `ALLOW` never described as safe; `UNKNOWN`/`UNAVAILABLE` surfaced honestly;
no intrusive scanning; no PII on chain; no verdict from language alone; simulated data labelled;
unfinished work flagged and off by default.

---

## 18. Report format

End every workstream with: **built** (files, routes, tables, codes), **verified** (command → observed
result), **not run / blocked** (and why), **decisions taken** (and the doc that records them), **next
risk**. One paragraph per item, no superlatives. If a check failed, it appears in the report with its
output, not paraphrased away.

---

*Companion to `MASTER_PROMPT.md` (state) — this file is intent. When they disagree, the code wins and
both files get fixed.*
