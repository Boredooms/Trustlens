# Web3 evidence — reproduce it yourself

Deliverables 5 (reproducible local blockchain) and 6 (contract address + transaction reference, or
equivalent reproducible verification). Design: [`../../02-architecture/WEB3_REGISTRY.md`](../../02-architecture/WEB3_REGISTRY.md).
Everything here is **simulated** demo data on a **local development chain** (`chainId 31337`, Hardhat's
public test mnemonic: never funded, not a secret).

## 1. One command, no wallet, no internet, no TrustLens API

```bash
pnpm install
pnpm --filter @trustlens/contracts replay
```

Deploys `ThreatReportRegistry` on Hardhat's in-process chain, registers the committed sample report
(`packages/contracts/test/fixtures/sample-report.json`), verifies it (`valid: true`), changes one field,
verifies again (`valid: false`), and writes [`replay.json`](replay.json) with the contract address,
deploy transaction, register transaction and block numbers. The address is deterministic
(`0x5FbDB2315678afecb367f032d93F642f64180aa3`, the first contract of Hardhat account #0).

```bash
pnpm --filter @trustlens/contracts test     # 9 contract + cross-language commitment tests
```

## 2. The full system: API anchors real reports, anyone verifies them

```bash
# terminal 1 — local chain (persistent while running)
pnpm --filter @trustlens/contracts node
# terminal 2 — deploy (writes chain.json) and print the CHAIN_* values for apps/api/.env
pnpm --filter @trustlens/contracts run deploy:local
# terminal 3 — API with CHAIN_* set (see apps/api/.env.example), then:
cd apps/api && python -m app.scripts.chain_evidence      # anchors simulated reports, verifies, tampers
```

[`chain.json`](chain.json) then records `chain_id`, `contract`, `deploy_tx`, `deploy_block`, and per
seeded report `tx`, `block`, `commitment`, `payload_hash`, the verification of the original
(`valid: true`) and of a tampered copy (`valid: false`), plus the git commit.

## 3. Verify without trusting TrustLens

```bash
pnpm --filter @trustlens/contracts verify-report -- --report <REPORT_ULID>
```

Fetches the public projection and salt from `GET /api/v1/public/verify/{id}`, recomputes sha256 and
the keccak commitment **locally**, reads the record straight from the contract over RPC, and prints
`INDEPENDENTLY VERIFIED` only when both match. It ignores the API's own `valid` field. The same check
is in the browser at `http://localhost:5173/verify/<REPORT_ULID>` (no sign-in, works in a private
window), including a "check a copy of the payload" box that shows a tampered copy failing.

## 4. What is on chain, and what is not

On chain per report: `reportId` (bytes32 of the ULID), `commitment`, `payloadHash`, reporter address,
timestamp, revision, status. Never: URL, domain, message text, email, payee, user id, justification.
The salt prevents dictionary attacks on the low-entropy payload. A chain record proves **integrity
and history**, never that the report is **true**.

## 5. Limits (stated, not hidden)

- The Hardhat node is in-memory: restarting it erases the registry. Existing anchors then verify
  `chain_commitment_matches: false` until re-anchored, which is the honest answer.
- Anchoring through the API to a public testnet is not implemented (the API holds no key and relies on
  a node-unlocked account). The contract itself deploys to any EVM network.
