// Copies the compiled ABI + bytecode into deployments/ThreatReportRegistry.json (committed), with
// function selectors, so deploy/replay/verify and the API never need a Solidity compiler.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Interface } = require("ethers");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "artifacts", "contracts", "ThreatReportRegistry.sol", "ThreatReportRegistry.json");
const art = JSON.parse(fs.readFileSync(src, "utf8"));
const iface = new Interface(art.abi);
const selectors = {};
iface.forEachFunction((fn) => {
  selectors[fn.format("sighash")] = fn.selector;
});
const out = {
  _generated: "by scripts/export-artifact.js from hardhat compile — do not edit by hand",
  contractName: art.contractName,
  solc: "0.8.24",
  abi: art.abi,
  bytecode: art.bytecode,
  selectors,
};
fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
fs.writeFileSync(path.join(root, "deployments", "ThreatReportRegistry.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote deployments/ThreatReportRegistry.json", selectors);
