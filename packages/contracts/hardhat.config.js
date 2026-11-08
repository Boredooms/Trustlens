// Hardhat configuration for the TrustLens report registry (docs/02-architecture/WEB3_REGISTRY.md).
// The local chain uses Hardhat's PUBLIC test mnemonic ("test test ... junk"): development only,
// never funded on any real network. It is not a secret, which is why it is not in an env file.
require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545", chainId: 31337 },
  },
  mocha: { timeout: 60000 },
};
