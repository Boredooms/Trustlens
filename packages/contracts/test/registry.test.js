// Contract behaviour + cross-language commitment (docs/02-architecture/WEB3_REGISTRY.md).
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ethers } = require("hardhat");
const { reportIdBytes32, canonicalJson, payloadHash, commitment } = require("../lib/commitment");
const sample = require("./fixtures/sample-report.json");

const ZERO = ethers.ZeroHash;
const rnd = () => "0x" + crypto.randomBytes(32).toString("hex");

async function deploy() {
  const [reporter, other] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("ThreatReportRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  return { registry, reporter, other };
}

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (err) => {
    assert.match(String(err.message), new RegExp(errorName));
    return true;
  });
}

describe("commitment scheme", () => {
  it("decodes the ULID to the fixture's bytes32", () => {
    assert.equal(reportIdBytes32(sample.report_id), sample.report_id_bytes32);
  });
  it("canonical JSON sorts keys recursively, omits nulls and keeps unicode", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: null, c: "₹" } }), '{"a":{"c":"₹"},"b":1}');
  });
  it("reproduces the fixture hashes the Python side also asserts", () => {
    assert.equal(payloadHash(sample.payload), sample.expected_payload_hash);
    assert.equal(
      commitment(sample.report_id_bytes32, sample.expected_payload_hash, sample.salt, sample.revision),
      sample.expected_commitment,
    );
    for (const c of sample.canonical_cases) assert.equal(payloadHash(c.value), c.sha256);
  });
  it("matches the on-chain formula", async () => {
    const { registry } = await deploy();
    const ph = payloadHash(sample.payload);
    const local = commitment(sample.report_id_bytes32, ph, sample.salt, sample.revision);
    assert.equal(await registry.commitmentOf(sample.report_id_bytes32, ph, sample.salt, sample.revision), local);
  });
});

describe("ThreatReportRegistry", () => {
  it("registers, verifies and rejects a tampered payload", async () => {
    const { registry, reporter } = await deploy();
    const id = sample.report_id_bytes32;
    const ph = payloadHash(sample.payload);
    const c = commitment(id, ph, sample.salt, 1);
    await (await registry.register(id, c, ph, 1)).wait();
    assert.equal(await registry.total(), 1n);
    const rec = await registry.get(id);
    assert.equal(rec.commitment, c);
    assert.equal(rec.reporter, reporter.address);
    assert.equal(rec.status, 1n);
    const [ok, rev, status] = await registry.verify(id, ph, sample.salt);
    assert.deepEqual([ok, rev, status], [true, 1n, 1n]);

    const tampered = payloadHash({ ...sample.payload, indicator: "northstar-demo.example" });
    assert.equal((await registry.verify(id, tampered, sample.salt))[0], false);
    assert.equal((await registry.verify(id, ph, rnd()))[0], false);
  });

  it("refuses duplicates and empty commitments", async () => {
    const { registry } = await deploy();
    const id = rnd();
    await expectRevert(registry.register(id, ZERO, rnd(), 1), "EmptyCommitment");
    await (await registry.register(id, rnd(), rnd(), 1)).wait();
    await expectRevert(registry.register(id, rnd(), rnd(), 1), "AlreadyRegistered");
  });

  it("revisions must increase, come from the reporter, and change the verifying payload", async () => {
    const { registry, other } = await deploy();
    const id = rnd();
    const salt = rnd();
    const p1 = rnd();
    await (await registry.register(id, commitment(id, p1, salt, 1), p1, 1)).wait();
    const p2 = rnd();
    const c2 = commitment(id, p2, salt, 2);
    await expectRevert(registry.connect(other).revise(id, c2, p2, 2), "NotReporter");
    await expectRevert(registry.revise(id, c2, p2, 1), "StaleRevision");
    await (await registry.revise(id, c2, p2, 2)).wait();
    assert.equal((await registry.verify(id, p2, salt))[0], true);
    // Revision 1 cannot be replayed as the current record.
    assert.equal((await registry.verify(id, p1, salt))[0], false);
    const events = await registry.queryFilter(registry.filters.ReportRegistered(id));
    assert.deepEqual(events.map((e) => e.args.revision), [1n, 2n]);
  });

  it("anyone can dispute; only the reporter withdraws; commitments never change", async () => {
    const { registry, other } = await deploy();
    const id = rnd();
    const c = rnd();
    await (await registry.register(id, c, rnd(), 1)).wait();
    await (await registry.connect(other).dispute(id, rnd())).wait();
    assert.equal((await registry.get(id)).status, 2n);
    assert.equal((await registry.get(id)).commitment, c);
    await expectRevert(registry.connect(other).withdraw(id), "NotReporter");
    await (await registry.withdraw(id)).wait();
    assert.equal((await registry.get(id)).status, 3n);
    await expectRevert(registry.dispute(rnd(), rnd()), "NotRegistered");
  });

  it("an unknown report verifies false with status Unknown", async () => {
    const { registry } = await deploy();
    assert.deepEqual([...(await registry.verify(rnd(), rnd(), rnd()))], [false, 0n, 0n]);
  });
});
