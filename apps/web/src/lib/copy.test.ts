// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DECISION_COPY, allowSublabel } from "./copy";
import { DECISIONS, toDecision } from "./api/enums";

// The single shared enum fixture (API_CONTRACTS.md §14).
const fixturePath = fileURLToPath(new URL("../../../api/tests/fixtures/contract_enums.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { decision: string[] };

const FORBIDDEN = /safe|secure|trusted|verified/i;

describe("decision copy", () => {
  it("covers exactly the five decisions in the shared contract fixture", () => {
    expect(Object.keys(DECISION_COPY).sort()).toEqual([...fixture.decision].sort());
    expect([...DECISIONS].sort()).toEqual([...fixture.decision].sort());
  });

  it("never describes ALLOW as safe, secure, trusted or verified", () => {
    const allow = DECISION_COPY.ALLOW;
    for (const text of [allow.label, allow.meaning, allowSublabel(85), allowSublabel(0)]) {
      expect(text).not.toMatch(FORBIDDEN);
    }
    expect(allow.label).toBe("No known threat");
  });

  it("maps unknown decision values to UNKNOWN instead of crashing", () => {
    expect(toDecision("QUARANTINE")).toBe("UNKNOWN");
    expect(toDecision(undefined)).toBe("UNKNOWN");
    expect(toDecision(null)).toBe("UNKNOWN");
    expect(toDecision("BLOCK")).toBe("BLOCK");
  });
});
