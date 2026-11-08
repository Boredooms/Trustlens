// Deploys ThreatReportRegistry to a running JSON-RPC node (default: local Hardhat node started with
// `pnpm --filter @trustlens/contracts node`). Uses the node's first unlocked account (Hardhat public
// test mnemonic — dev only). Idempotent: if code already exists at the deterministic address for a
// fresh node, it is reused. Writes the deploy section of docs/evidence/web3/chain.json.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JsonRpcProvider, ContractFactory, Contract } = require("ethers");

const RPC = process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
const artifact = require("../deployments/ThreatReportRegistry.json");
const evidence = path.resolve(__dirname, "..", "..", "..", "docs", "evidence", "web3", "chain.json");

async function main() {
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: false });
  const network = await provider.getNetwork();
  const signer = await provider.getSigner(0);
  const deployer = await signer.getAddress();

  const previous = fs.existsSync(evidence) ? JSON.parse(fs.readFileSync(evidence, "utf8")) : {};
  if (previous.contract && Number(previous.chain_id) === Number(network.chainId)) {
    const code = await provider.getCode(previous.contract);
    if (code && code !== "0x") {
      const total = await new Contract(previous.contract, artifact.abi, provider).total();
      console.log(`Registry already deployed at ${previous.contract} (total=${total}); reusing.`);
      print(previous.contract, network);
      return;
    }
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  const receipt = await tx.wait();
  const address = await contract.getAddress();
  const out = {
    simulated: true,
    network: RPC.includes("127.0.0.1") || RPC.includes("localhost") ? "local hardhat node" : RPC,
    chain_id: Number(network.chainId),
    contract: address,
    deployer,
    deploy_tx: tx.hash,
    deploy_block: receipt.blockNumber,
    solc: artifact.solc,
    seeded_reports: [],
    generated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  fs.writeFileSync(evidence, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  print(address, network, deployer);
}

function print(address, network, sender) {
  console.log("\nSet these in apps/api/.env:");
  console.log(`CHAIN_RPC_URL=${RPC}`);
  console.log(`CHAIN_ID=${network.chainId}`);
  console.log(`CHAIN_REGISTRY_ADDRESS=${address}`);
  if (sender) console.log(`CHAIN_SENDER_ADDRESS=${sender}`);
}

main().catch((err) => {
  console.error(`Deploy failed against ${RPC}: ${err.shortMessage || err.message}`);
  console.error("Is the node running? pnpm --filter @trustlens/contracts node");
  process.exitCode = 1;
});
