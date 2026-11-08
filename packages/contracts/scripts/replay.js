// One-command, offline proof (deliverables 5 + 6): `pnpm --filter @trustlens/contracts replay`.
// Runs on Hardhat's in-process chain (chainId 31337, public test mnemonic — dev only, never funded):
// deploy -> register the committed sample report -> verify true -> tamper -> verify false.
// Writes docs/evidence/web3/replay.json. Needs no wallet, no funds, no network, no TrustLens API.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { reportIdBytes32, payloadHash, commitment, STATUS } = require("../lib/commitment");
const sample = require("../test/fixtures/sample-report.json");

async function main() {
  const { ethers } = hre;
  const [reporter] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("ThreatReportRegistry");
  const registry = await Registry.deploy();
  const deployTx = registry.deploymentTransaction();
  const deployReceipt = await deployTx.wait();
  const address = await registry.getAddress();

  const id = reportIdBytes32(sample.report_id);
  const ph = payloadHash(sample.payload);
  const c = commitment(id, ph, sample.salt, sample.revision);
  const onChainFormula = await registry.commitmentOf(id, ph, sample.salt, sample.revision);
  if (onChainFormula !== c) throw new Error("local and on-chain commitment formulas disagree");
  const regReceipt = await (await registry.register(id, c, ph, sample.revision)).wait();

  const [ok, revision, status] = await registry.verify(id, ph, sample.salt);
  const tamperedPayload = { ...sample.payload, indicator: "northstar-demo.example" };
  const [tamperedOk] = await registry.verify(id, payloadHash(tamperedPayload), sample.salt);

  const network = await ethers.provider.getNetwork();
  const result = {
    simulated: true,
    network: "hardhat in-process",
    chain_id: Number(network.chainId),
    contract: address,
    deployer: reporter.address,
    deploy_tx: deployTx.hash,
    deploy_block: deployReceipt.blockNumber,
    report: {
      report_id: sample.report_id,
      report_id_bytes32: id,
      payload_hash: ph,
      commitment: c,
      revision: Number(revision),
      register_tx: regReceipt.hash,
      register_block: regReceipt.blockNumber,
    },
    verify_original: { valid: ok, status: STATUS[Number(status)] },
    verify_tampered: { valid: tamperedOk, changed_field: "indicator" },
  };
  if (!ok || tamperedOk) throw new Error("replay invariant failed: " + JSON.stringify(result));

  const out = path.resolve(__dirname, "..", "..", "..", "docs", "evidence", "web3", "replay.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nOK: original verifies true, tampered verifies false. Wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
