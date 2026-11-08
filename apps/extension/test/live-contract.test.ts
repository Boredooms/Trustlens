// Contract check against a response captured from the local API (apps/api, DEMO_MODE, seeded data)
// on 2026-11-08: POST /api/v1/assess for the lookalike /pay page with intent=payment.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAssessment } from "../src/shared/assessment";
import { buildOverlayModel } from "../src/shared/overlay-model";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "fixtures/live-assess-payment-block.json"), "utf8")) as unknown;

describe("live /assess response (demo money shot)", () => {
  it("parses and renders the BLOCK overlay with observed vs expected payee", () => {
    const a = parseAssessment(raw);
    expect(a).not.toBeNull();
    const m = buildOverlayModel({ kind: "assessment", assessment: a!, checkedAt: Date.now() }, "payment");
    expect(m.mode).toBe("block");
    expect(m.title).toBe("Payment stopped");
    expect(m.mismatch).toEqual({
      kind: "payee",
      observed: "fees@okaxis",
      org: "Northstar University",
      expected: ["fees@northstar-demo"],
    });
    expect(m.coverageLine).toMatch(/^We checked \d+% of signal groups\.$/);
    expect(m.reasons.length).toBeGreaterThan(0);
    expect(m.reasons.length).toBeLessThanOrEqual(3);
    expect(m.fullReportUrl).toMatch(/^http:\/\/localhost:5173\/app\/scan\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
