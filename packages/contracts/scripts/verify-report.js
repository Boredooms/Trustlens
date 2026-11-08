// Independent verifier. Trusts neither TrustLens' database nor its "valid" field:
//  1. fetch the public projection (payload + salt) from GET /api/v1/public/verify/{id}
//  2. recompute sha256(canonical payload) and keccak commitment LOCALLY
//  3. read the record straight from the contract over RPC and compare
// Usage: pnpm --filter @trustlens/contracts verify-report -- --report <ULID>
//        [--api http://localhost:8000] [--rpc http://127.0.0.1:8545] [--payload file.json]
"use strict";
const fs = require("node:fs");
const { JsonRpcProvider, Contract } = require("ethers");
const { reportIdBytes32, payloadHash, commitment, STATUS } = require("../lib/commitment");
const artifact = require("../deployments/ThreatReportRegistry.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const report = arg("report");
  if (!report) throw new Error("--report <ULID> is required");
  const api = arg("api", process.env.TRUSTLENS_API || "http://localhost:8000");
  const rpc = arg("rpc", process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545");

  const res = await fetch(`${api}/api/v1/public/verify/${report}`);
  if (!res.ok) throw new Error(`public verify returned ${res.status}: ${await res.text()}`);
  const pub = await res.json();
  const payload = arg("payload") ? JSON.parse(fs.readFileSync(arg("payload"), "utf8")) : pub.payload;

  const id = reportIdBytes32(report);
  const ph = payloadHash(payload);
  const provider = new JsonRpcProvider(rpc);
  const net = await provider.getNetwork();
  const registry = new Contract(pub.contract, artifact.abi, provider);
  const rec = await registry.get(id);
  const local = commitment(id, ph, pub.salt, Number(rec.revision));
  const [ok, , status] = await registry.verify(id, ph, pub.salt);

  const result = {
    report_id: report,
    rpc,
    chain_id: Number(net.chainId),
    contract: pub.contract,
    report_id_bytes32: id,
    local_payload_hash: ph,
    on_chain_payload_hash: rec.payloadHash,
    local_commitment: local,
    on_chain_commitment: rec.commitment,
    revision: Number(rec.revision),
    on_chain_status: STATUS[Number(status)],
    reporter_address: rec.reporter,
    contract_verify: ok,
    independent_match: local === rec.commitment && ph === rec.payloadHash,
    api_said_valid: pub.valid,
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(result.independent_match ? "\nINDEPENDENTLY VERIFIED" : "\nDOES NOT MATCH THE CHAIN");
  if (!result.independent_match) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
