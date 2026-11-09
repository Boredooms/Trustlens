# Web3 Report Registry — integrity anchoring for threat reports

> **Status:** DECIDED (ADR-018, `SYSTEM_ARCHITECTURE.md` §11). **Owner of:** the
> `ThreatReportRegistry` contract, the commitment scheme, the `report_anchors` table, the anchor and
> public-verify endpoints, the `CHAIN_*` settings and the `CHAIN_*`/`ANCHOR_*` error codes.
> **Problem statement:** Module 6 (decentralised threat intelligence), deliverables 5 and 6.

## 1. What the chain is for (and what it is not)

The off-chain report in Postgres stays authoritative. The chain stores a **commitment** to a
privacy-safe projection of each report, so anyone can later prove that the projection they are shown
is byte-for-byte the one that was registered, at a block, by an address, at a revision.

- A chain record establishes **integrity and history** of a report, never its **truth**. A
  registered report can be wrong; a confirmed report can be disputed. The UI says so.
- Anchoring is a **post-hoc integrity action**. It never gates a scan, a verdict, a report review or
  any other request. If the chain is down, scans and reports work exactly as before; only the anchor
  endpoints answer `503 CHAIN_UNAVAILABLE`.
- Nothing personal reaches the chain: no URL, no domain, no message text, no email, no payee, no user
  id, no justification. Only 32-byte hashes, a revision counter, an address, a timestamp and a status.

## 2. Contract — `packages/contracts/contracts/ThreatReportRegistry.sol`

Solidity `0.8.24`, no owner, no token, no payable function, no upgrade path.

| Member | Meaning |
| --- | --- |
| `register(reportId, commitment, payloadHash, revision)` | First registration. Reverts `AlreadyRegistered`, `EmptyCommitment` |
| `revise(reportId, commitment, payloadHash, revision)` | Reporter-only. `revision` must strictly increase (`StaleRevision`). Replaces the current commitment; history lives in `ReportRegistered` events |
| `dispute(reportId, reasonHash)` | Anyone. Sets status `Disputed`, emits `ReportDisputed`. Never changes the commitment |
| `withdraw(reportId)` | Reporter-only. Status `Withdrawn` |
| `get(reportId)` | The current `Record` |
| `verify(reportId, payloadHash, salt)` | `view`: recomputes the commitment for the current revision and returns `(ok, revision, status)` |
| `commitmentOf(reportId, payloadHash, salt, revision)` | `pure`: the exact commitment formula, so clients without keccak (the API) and clients with it (the CLI) agree by construction |

`Status`: `0 Unknown · 1 Active · 2 Disputed · 3 Withdrawn` (API spelling: `unknown`, `active`,
`disputed`, `withdrawn`).

Differences from the first sketch in `BUILD_PROMPT.md` §6.3, both deliberate: `revise` takes a new
`payloadHash` (a revision changes the payload, e.g. after analyst review; without it a revised report
could never verify), and a non-increasing revision reverts with its own `StaleRevision` error instead
of reusing `EmptyCommitment`.

## 3. Commitment scheme

```text
reportId    = bytes32( ULID as 128-bit big-endian integer, left-padded with zeros )
payload     = canonical JSON object (§4)
payloadHash = sha256( UTF-8( canonical_json(payload) ) )
salt        = 32 random bytes, per anchor revision
commitment  = keccak256( abi.encode(bytes32 reportId, bytes32 payloadHash, bytes32 salt, uint32 revision) )
```

- `canonical_json`: keys sorted recursively, separators `,` and `:` with no whitespace, UTF-8 without
  ASCII escaping, `null`-valued keys omitted, only strings / booleans / integers / arrays / objects.
  Python (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`) and the CLI
  (`packages/contracts/lib/commitment.js`) produce identical bytes; a cross-language test fixes this.
- `revision` is inside the commitment, so revision *n* can never be replayed as revision *m*.
- **Why a salt.** The payload has low entropy (a registrable domain, an intent, a status, a list of
  finding codes). Without a salt, an observer of chain events could hash candidate domains and learn
  which domain a report is about. The salt keeps the chain blind; the payload is disclosed only by the
  public verify endpoint for a report id the caller already holds.
- The salt is stored off-chain, **encrypted at rest** (Fernet, key derived with HKDF-SHA256 from
  `JWT_SECRET`, info `trustlens-anchor-salt-v1`). Losing it would make verification impossible
  forever, so it is persisted in the same transaction as the anchor row and a round-trip test guards
  it. Rotating `JWT_SECRET` requires re-encrypting `report_anchors.salt_ciphertext`.

## 4. Canonical payload (the privacy boundary)

Built only by `app/services/anchors.py::build_payload`. Allowed keys, nothing else:

| Key | Value | Why it is safe |
| --- | --- | --- |
| `schema` | `"trustlens.report-commitment.v1"` | constant |
| `report_id` | ULID | random identifier |
| `indicator_type` | `"domain"` | constant |
| `indicator` | registrable domain of the reported URL (`guard.registrable_domain`) | the reported site, never path, query or user info |
| `intent` | report intent, if any | enum |
| `status` | report status | enum |
| `justification_sha256` | sha256 of the reporter's free text | text may contain personal data, so only its hash |
| `observed_payee_sha256` | sha256 of the observed payee, if any | payee ids can identify people |
| `linked_scan` | `{decision, engine_version, finding_codes[]}` of the linked scan | enums and codes only |
| `created_at` | ISO-8601 UTC | |
| `reporter_pseudonym` | first 16 hex of HMAC-SHA256(key, reporter user id), or `"anonymous"` | unlinkable without the server key |
| `simulated` | boolean | demo labelling |

A unit test feeds a report whose URL, justification and payee contain an email, a phone number and a
token, and asserts none of them appear in the serialised payload or in any argument sent to the chain.

## 5. API surface

| # | Route | Auth | Behaviour |
| --- | --- | --- | --- |
| 68 | `POST /api/v1/reports/{report_id}/anchor` | report owner or analyst | Builds the payload. No anchor → `register` revision 1. Anchor exists and payload unchanged → returns it (idempotent, `200`). Payload changed (e.g. reviewed) → `revise` with revision + 1. `201` on a new transaction |
| 69 | `GET /api/v1/reports/{report_id}/anchor` | report owner or analyst | `{anchored: false}` when none (never a 404 or 500 for "not anchored") |
| 70 | `GET /api/v1/public/verify/{report_id}` | **public** | Recomputes from the stored snapshot and reads the chain. Returns payload, salt, hashes, the three checks and `valid` |
| 71 | `POST /api/v1/public/verify/{report_id}` | **public**, rate-limited | Same, but hashes the caller-supplied `payload` instead of the stored snapshot. A tampered payload yields `valid: false` |

Verify response (`AnchorVerification`):

```json
{
  "report_id": "01…", "anchored": true, "valid": true,
  "checks": { "payload_hash_matches": true, "chain_commitment_matches": true, "report_unchanged": true },
  "payload": { "…": "…" }, "payload_hash": "0x… (anchored)", "computed_payload_hash": "0x… (of payload)",
  "salt": "0x…", "commitment": "0x…", "report_id_bytes32": "0x…", "revision": 1,
  "on_chain_revision": 1, "on_chain_status": "active",
  "chain_id": 31337, "contract": "0x…", "tx_hash": "0x…", "block_number": 2,
  "anchored_at": "…", "checked_at": "…", "simulated": false
}
```

- `payload_hash_matches` — sha256 of the (stored or supplied) payload equals the anchored hash.
- `chain_commitment_matches` — the contract's `verify` returns `ok` for that hash and the salt.
- `report_unchanged` — rebuilding the payload from today's report row gives the anchored snapshot.
  `false` means the report changed after anchoring (re-anchor to create a revision) or the database
  was altered.
- `valid` is the conjunction. The verdict of the report is never shown as part of this answer.

Independent of the API: `pnpm --filter @trustlens/contracts verify-report -- --report <id>` fetches
the public payload and salt, recomputes sha256 and keccak **locally**, and calls the contract directly
over RPC. It ignores the API's own `valid` field.

## 6. Data — `report_anchors`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `CHAR(26)` PK | ULID |
| `report_id` | `CHAR(26)` FK `threat_reports` `ON DELETE CASCADE`, **unique** | one anchor row per report, holds the latest revision |
| `chain_id` | `BIGINT` | |
| `contract` | `TEXT` | `0x` + 40 hex |
| `report_id_bytes32` | `TEXT` | `0x` + 64 hex |
| `payload` | `JSONB` | the canonical snapshot (no personal data, §4) |
| `payload_hash` | `TEXT` | `0x` + 64 hex |
| `salt_ciphertext` | `TEXT` | Fernet token |
| `commitment` | `TEXT` | `0x` + 64 hex |
| `revision` | `INTEGER` | ≥ 1 |
| `tx_hash` | `TEXT` | latest transaction |
| `block_number` | `BIGINT` | |
| `anchored_at` | `TIMESTAMPTZ` | |
| `created_by` | `CHAR(26)` FK `users` `ON DELETE SET NULL` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

RLS enabled with no policy (deny-all to non-owner roles), like the global intelligence tables.
Anchors are audited (`report.anchor`). Revision history is the chain's `ReportRegistered` events.

## 7. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHAIN_RPC_URL` | unset | JSON-RPC endpoint. Unset ⇒ chain disabled; anchor routes answer `503 CHAIN_UNAVAILABLE` |
| `CHAIN_ID` | `31337` | Must match `eth_chainId`; a mismatch is `CHAIN_UNAVAILABLE` |
| `CHAIN_REGISTRY_ADDRESS` | unset | Deployed contract. Required when `CHAIN_RPC_URL` is set |
| `CHAIN_SENDER_ADDRESS` | unset | Account that sends `register`/`revise`. Must be unlocked on the node |
| `CHAIN_TIMEOUT_SECONDS` | `5` | Per RPC call |

The API never holds a private key: it uses `eth_sendTransaction` from an account the **node** has
unlocked, which is what a local Hardhat node provides. Anchoring through the API to a public testnet
therefore needs a signing node or proxy and is **not implemented**; the contract itself deploys to any
EVM network with `packages/contracts` scripts. Production refuses to boot with `CHAIN_ID=31337`.

### 7.1 Simulated registry (`CHAIN_MODE=simulated`)

For a hosted demo without a funded testnet wallet. `services/sim_registry.py` answers the same
JSON-RPC calls a node would (`eth_chainId`, `eth_getCode`, `eth_call`, `eth_sendTransaction`,
`eth_getTransactionReceipt`), so anchoring and verification run unchanged code.

| Property | Value |
| --- | --- |
| Rules | The contract's, exactly: register once, `revise` only by the reporter with a higher revision, anyone may `dispute`, only the reporter may `withdraw`; reverts surface as `502 ANCHOR_TX_FAILED` |
| Commitment | Real `keccak256(abi.encode(reportId, payloadHash, salt, revision))` (pure-Python Keccak-f[1600]); unit tests pin it to values read from the deployed contract |
| State | Postgres: `sim_registry_records` and append-only `sim_registry_txs` (DATABASE_DESIGN.md §7.8); survives restarts |
| Identity | Chain id **0** (invalid on every EVM network), contract `0x7357…7357`, sender `0x5e4d…5e4d` |
| Labelling | Every anchor and verification it produces has `simulated: true`; the web shows "simulated registry (not a public blockchain)" |
| Gate | Excludes `CHAIN_RPC_URL`; in production only with `DEMO_MODE=true` |

What it does **not** give: independence. Only this API can write to it, so it proves tamper evidence
of the stored payload (a changed copy fails), not that TrustLens could not rewrite its own history.
That property needs a public chain; the reproducible local chain (§10) shows the real contract.

The RPC URL is operator configuration, like `LLM_BASE_URL`, not user input. It is not routed through
`services/guard.py` (which would correctly refuse a localhost node); every call is bounded by
`CHAIN_TIMEOUT_SECONDS` and the response size is capped.

## 8. Error codes (API_CONTRACTS.md §7.6)

| Code | Status | Meaning |
| --- | --- | --- |
| `CHAIN_UNAVAILABLE` | 503 | Chain not configured, unreachable, wrong chain id, or no contract at the address |
| `ANCHOR_NOT_FOUND` | 404 | Public verify for a report that has no anchor |
| `ANCHOR_TX_FAILED` | 502 | The node rejected or reverted the transaction |
| `ANCHOR_ALREADY_EXISTS` | 409 | The chain already holds this report id but the database has no anchor row (e.g. a restored database against an old chain). Never overwritten automatically |

## 9. Threat model

| Attacker | Can | Cannot |
| --- | --- | --- |
| Chain observer | See that report ids were registered, when, by which address, how many revisions | Learn the domain or any content (salted commitment) |
| Holder of a report id | Read the public projection and verify it | Read the reporter, URL, justification or payee |
| Database tamperer | Change a report row or the snapshot | Make `chain_commitment_matches` pass for altered content; `report_unchanged` exposes row edits |
| Holder of the sender key | Register junk ids, revise or withdraw its own records (history stays in events) | Rewrite past events, revise another reporter's record |
| Anyone | `dispute` any record (status signal only) | Change a commitment |

Disputes are deliberately open: they are a public signal recorded with a reason hash, reviewed off
chain. A dispute never removes a commitment and never changes a verdict.

## 10. Reproducing it (deliverables 5 and 6)

| Command (repo root) | Needs | Proves |
| --- | --- | --- |
| `pnpm --filter @trustlens/contracts test` | nothing (in-process chain) | contract behaviour, cross-language commitment |
| `pnpm --filter @trustlens/contracts replay` | nothing | deploys, registers the committed sample report, verifies `true`, tampers, verifies `false`, prints address and tx hashes |
| `pnpm --filter @trustlens/contracts node` + `pnpm --filter @trustlens/contracts deploy` | a terminal | a persistent local chain at `http://127.0.0.1:8545`, `chainId 31337`, deterministic address |
| `python -m app.scripts.chain_evidence` (in `apps/api`) | API database + node | anchors demo reports through the real service, writes `docs/evidence/web3/chain.json` |

The local Hardhat chain is in-memory. Restarting it erases the registry; existing `report_anchors`
rows then verify `chain_commitment_matches: false`, which is the honest answer.
`docs/evidence/web3/README.md` is the judge-facing version of this section.
