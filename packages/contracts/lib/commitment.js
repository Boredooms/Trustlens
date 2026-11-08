// Commitment scheme shared by the CLI scripts and tests (docs/02-architecture/WEB3_REGISTRY.md §3).
// Must produce byte-identical results to apps/api/app/services/anchors.py.
"use strict";
const crypto = require("node:crypto");
const { AbiCoder, keccak256 } = require("ethers");

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID (26 Crockford base32 chars = 128 bits) -> 0x-prefixed bytes32, left-padded. */
function reportIdBytes32(ulid) {
  if (typeof ulid !== "string" || ulid.length !== 26) throw new Error("report id must be a 26-char ULID");
  let n = 0n;
  for (const ch of ulid.toUpperCase()) {
    const v = ULID_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid ULID character ${ch}`);
    n = (n << 5n) | BigInt(v);
  }
  if (n >> 128n) throw new Error("ULID overflows 128 bits");
  return "0x" + n.toString(16).padStart(64, "0");
}

/** Sorted keys, no whitespace, nulls omitted. Matches Python json.dumps(sort_keys, compact, ensure_ascii=False). */
function canonicalJson(value) {
  if (value === null || value === undefined) throw new Error("null values are omitted, not encoded");
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== null && value[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  if (typeof value === "number" && !Number.isInteger(value)) throw new Error("floats are not allowed in payloads");
  return JSON.stringify(value);
}

function payloadHash(payload) {
  return "0x" + crypto.createHash("sha256").update(Buffer.from(canonicalJson(payload), "utf8")).digest("hex");
}

function commitment(reportIdB32, payloadHashHex, saltHex, revision) {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "bytes32", "uint32"],
    [reportIdB32, payloadHashHex, saltHex, revision],
  );
  return keccak256(encoded);
}

const STATUS = ["unknown", "active", "disputed", "withdrawn"];

module.exports = { reportIdBytes32, canonicalJson, payloadHash, commitment, STATUS };
