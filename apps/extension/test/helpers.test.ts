import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAssessment, payeeComparison } from "../src/shared/assessment";
import { readCache, VERDICT_TTL_MS } from "../src/shared/cache";
import { COPY, DECISION_COPY, FAILURE_COPY } from "../src/shared/copy";
import { isLocalHost, toReportedUrl } from "../src/shared/demo-url";
import { assessIdempotencyKey } from "../src/shared/hash";
import { buildOverlayModel, MODE_BY_DECISION } from "../src/shared/overlay-model";
import { DECISIONS, type CheckResult } from "../src/shared/types";

const here = dirname(fileURLToPath(import.meta.url));
const enums = JSON.parse(
  readFileSync(resolve(here, "../../api/tests/fixtures/contract_enums.json"), "utf8"),
) as { decision: string[] };

export const DEMO_BLOCK = {
  assessment_id: "01JCM8C0000000000000000000",
  decision: "BLOCK",
  risk_level: "CRITICAL",
  risk_score: 62,
  coverage: { percent: 85, collected: ["reputation"], unavailable: ["credential_destination"], skipped: [] },
  reasons: [
    "The payment address fees@okaxis is not one registered by Northstar University.",
    "The domain is not one of Northstar University's verified domains.",
    "Shares infrastructure with known lookalikes.",
    "A fourth reason that is not displayed.",
  ],
  identity_verified: false,
  action: {
    intent: "payment",
    claimed_organisation: { id: "01JCM5AA000000000000000000", name: "Northstar University" },
    observed_destination: "https://collect.badhost.example/pay",
    expected_destinations: ["pay.northstar-demo.example"],
    payee: "fees@okaxis",
    match: "none",
  },
  findings: [
    {
      id: "01JCM7B0000000000000000000",
      code: "PAYEE_NOT_IN_VERIFIED_PROFILE",
      signal_group: "payment_destination",
      severity: "critical",
      confidence: 1,
      title: "Payment address is not registered by the organisation",
      detail: "The page asks for a transfer to fees@okaxis; the organisation has registered fees@northstar-demo.",
      observed: { payee: "fees@okaxis" },
      expected: { payees: ["fees@northstar-demo"] },
      evidence_refs: [],
      rule_id: "R-PAY-01",
    },
  ],
  scan_id: "01JCM6A0000000000000000000",
  cached: false,
  decided_at: new Date().toISOString(),
};

const assessed = (raw: unknown): CheckResult => ({
  kind: "assessment",
  assessment: parseAssessment(raw)!,
  checkedAt: Date.now(),
});

const FORBIDDEN_ALLOW_WORDS = /\b(safe|secure|trusted|verified)\b/i;

describe("decision copy", () => {
  it("covers exactly the five decisions from contract_enums.json", () => {
    expect(Object.keys(DECISION_COPY).sort()).toEqual([...enums.decision].sort());
    expect([...DECISIONS]).toEqual(enums.decision);
    expect(Object.keys(MODE_BY_DECISION).sort()).toEqual([...enums.decision].sort());
  });

  it("ALLOW copy contains none of safe/secure/trusted/verified", () => {
    const allowStrings = [
      ...Object.values(DECISION_COPY.ALLOW),
      COPY.allowSublabel,
      COPY.allowToast,
      COPY.allowToastNoCoverage,
    ];
    for (const s of allowStrings) expect(s).not.toMatch(FORBIDDEN_ALLOW_WORDS);
    expect(DECISION_COPY.ALLOW.label).toBe("No known threat");
  });

  it("every degraded state says 'not checked' or names the failure — never blank", () => {
    for (const [code, text] of Object.entries(FAILURE_COPY)) {
      expect(text.length, code).toBeGreaterThan(10);
      expect(text).not.toMatch(FORBIDDEN_ALLOW_WORDS);
    }
  });
});

describe("cache freshness", () => {
  const result: CheckResult = { kind: "assessment", assessment: parseAssessment(DEMO_BLOCK)!, checkedAt: 0 };
  const now = 1_000_000_000_000;

  it("uses an entry up to 10 minutes old", () => {
    expect(readCache({ result, cachedAt: now }, now).state).toBe("fresh");
    expect(readCache({ result, cachedAt: now - VERDICT_TTL_MS }, now).state).toBe("fresh");
  });
  it("treats an entry older than 10 minutes as stale (rendered UNKNOWN), never as its decision", () => {
    expect(readCache({ result, cachedAt: now - VERDICT_TTL_MS - 1 }, now).state).toBe("stale");
  });
  it("treats a future timestamp as stale", () => {
    expect(readCache({ result, cachedAt: now + 60_000 }, now).state).toBe("stale");
  });
  it("treats missing or corrupt entries as a miss", () => {
    expect(readCache(undefined, now).state).toBe("miss");
    expect(readCache({ cachedAt: "yesterday", result }, now).state).toBe("miss");
    expect(readCache({ cachedAt: now }, now).state).toBe("miss");
    expect(readCache("garbage", now).state).toBe("miss");
  });
  it("never serves a cached failure", () => {
    const failure: CheckResult = { kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: now };
    expect(readCache({ result: failure, cachedAt: now }, now).state).toBe("miss");
  });
});

describe("demo URL mapping", () => {
  const demo = "http://localhost:8081";
  it("maps path mode to https://<host>/<path>", () => {
    expect(toReportedUrl("http://localhost:8081/site/apply.northstar-admissions.example/pay", demo)).toBe(
      "https://apply.northstar-admissions.example/pay",
    );
    expect(toReportedUrl("http://localhost:8081/site/apply.northstar-admissions.example/register?x=1#frag", demo)).toBe(
      "https://apply.northstar-admissions.example/register?x=1",
    );
    expect(toReportedUrl("http://localhost:8081/site/northstar-demo.example", demo)).toBe("https://northstar-demo.example/");
  });
  it("maps form actions under the demo origin the same way", () => {
    expect(toReportedUrl("/site/login.northstar-demo.example/session", demo, "http://localhost:8081/site/login.northstar-demo.example/")).toBe(
      "https://login.northstar-demo.example/session",
    );
  });
  it("maps host mode for .example hosts on the demo port", () => {
    expect(toReportedUrl("http://apply.northstar-admissions.example:8081/pay", demo)).toBe(
      "https://apply.northstar-admissions.example/pay",
    );
  });
  it("leaves other URLs alone apart from the fragment", () => {
    expect(toReportedUrl("https://collect.badhost.example/pay", demo)).toBe("https://collect.badhost.example/pay");
    expect(toReportedUrl("https://example.com/a#b", demo)).toBe("https://example.com/a");
    expect(toReportedUrl("http://example.com:8081/a", demo)).toBe("http://example.com:8081/a");
    expect(toReportedUrl("http://localhost:8081/site/apply.northstar-admissions.example/pay", null)).toBe(
      "http://localhost:8081/site/apply.northstar-admissions.example/pay",
    );
  });
  it("rejects non-http(s) and invalid input", () => {
    expect(toReportedUrl("upi://pay?pa=fees@okaxis", demo)).toBeNull();
    expect(toReportedUrl("javascript:alert(1)", demo)).toBeNull();
    expect(toReportedUrl("not a url", demo)).toBeNull();
  });
  it("does not map an invalid host segment", () => {
    expect(toReportedUrl("http://localhost:8081/site/..%2f/x", demo)).toBe("http://localhost:8081/site/..%2f/x");
  });
  it("flags loopback hosts", () => {
    expect(isLocalHost("http://localhost:5173/")).toBe(true);
    expect(isLocalHost("https://apply.northstar-admissions.example/")).toBe(false);
  });
});

describe("assessment parsing", () => {
  it("maps unknown decision to UNKNOWN and clamps coverage", () => {
    const a = parseAssessment({ ...DEMO_BLOCK, decision: "QUARANTINE", coverage: { percent: 140 } })!;
    expect(a.decision).toBe("UNKNOWN");
    expect(a.coverage.percent).toBe(100);
  });
  it("missing decision is UNKNOWN; missing coverage is null (not a number we made up)", () => {
    const { decision: _d, coverage: _c, ...rest } = DEMO_BLOCK;
    void _d;
    void _c;
    const a = parseAssessment(rest)!;
    expect(a.decision).toBe("UNKNOWN");
    expect(a.coverage.percent).toBeNull();
  });
  it("returns null for a malformed body", () => {
    expect(parseAssessment("nope")).toBeNull();
    expect(parseAssessment([1, 2])).toBeNull();
  });
  it("prefers the PAYEE finding's expected payees over expected_destinations", () => {
    expect(payeeComparison(parseAssessment(DEMO_BLOCK)!)).toEqual({
      observed: "fees@okaxis",
      expected: ["fees@northstar-demo"],
    });
    const noFinding = parseAssessment({ ...DEMO_BLOCK, findings: [] })!;
    expect(payeeComparison(noFinding).expected).toEqual(["pay.northstar-demo.example"]);
  });
});

describe("overlay model", () => {
  it("BLOCK payment shows observed vs expected payee, org, coverage, top 3 reasons and full report", () => {
    const m = buildOverlayModel(assessed(DEMO_BLOCK), "payment");
    expect(m.mode).toBe("block");
    expect(m.title).toBe("Payment stopped");
    expect(m.mismatch).toEqual({
      kind: "payee",
      observed: "fees@okaxis",
      org: "Northstar University",
      expected: ["fees@northstar-demo"],
    });
    expect(m.coverageLine).toBe("We checked 85% of signal groups.");
    expect(m.reasons).toHaveLength(3);
    expect(m.fullReportUrl).toBe("http://localhost:5173/app/scan/01JCM6A0000000000000000000");
    expect(m.secondaryConfirmLabel).toBeTruthy();
  });
  it("BLOCK login names the credential destination", () => {
    const m = buildOverlayModel(
      assessed({ ...DEMO_BLOCK, action: { ...DEMO_BLOCK.action, intent: "login", observed_destination: "https://collect.badhost.example/login" } }),
      "login",
    );
    expect(m.mismatch).toEqual({
      kind: "credential",
      text: "This login form sends your password to collect.badhost.example, which is not an approved Northstar University login endpoint.",
    });
  });
  it("WARN and REVIEW confirm before proceeding", () => {
    expect(buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "WARN" }), "payment").mode).toBe("confirm");
    expect(buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "REVIEW" }), "payment").mode).toBe("confirm");
  });
  it("ALLOW proceeds with a coverage toast that makes no guarantee", () => {
    const m = buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "ALLOW", coverage: { percent: 100 } }), "payment");
    expect(m.mode).toBe("proceed");
    expect(m.toast).toBe("No known threat in the checks that ran · coverage 100%");
    expect(m.toast).not.toMatch(FORBIDDEN_ALLOW_WORDS);
  });
  it("unreachable API → neutral 'Could not verify', user decides, never proceed silently", () => {
    const m = buildOverlayModel({ kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: 0 }, "payment");
    expect(m.mode).toBe("unknown");
    expect(m.tone).toBe("UNKNOWN");
    expect(m.title).toBe("Could not verify this page");
    expect(m.body).toContain("not checked");
  });
  it("BLOCK and WARN offer the owner appeal link for the judged host; others do not", () => {
    const host = "apply.northstar-admissions.example";
    const block = buildOverlayModel(assessed(DEMO_BLOCK), "payment", 0, host);
    expect(block.appealUrl).toBe("http://localhost:5173/appeal?domain=apply.northstar-admissions.example");
    expect(buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "WARN" }), "payment", 0, host).appealUrl).toBeTruthy();
    expect(buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "REVIEW" }), "payment", 0, host).appealUrl).toBeNull();
    expect(
      buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "ALLOW", coverage: { percent: 100 } }), "payment", 0, host).appealUrl,
    ).toBeNull();
    expect(buildOverlayModel({ kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: 0 }, "payment", 0, host).appealUrl).toBeNull();
    // No host known → no link; the host is URL-encoded.
    expect(buildOverlayModel(assessed(DEMO_BLOCK), "payment").appealUrl).toBeNull();
    expect(buildOverlayModel(assessed(DEMO_BLOCK), "payment", 0, "a b&c").appealUrl).toBe(
      "http://localhost:5173/appeal?domain=a%20b%26c",
    );
  });
  it("unknown decision from the server → unknown mode", () => {
    expect(buildOverlayModel(assessed({ ...DEMO_BLOCK, decision: "NEW_THING" }), "payment").mode).toBe("unknown");
  });
});

describe("idempotency key", () => {
  it("is 64 hex chars, stable within the window, and differs by body", async () => {
    const body = { url: "https://a.example/pay", intent: "payment", payee: "fees@okaxis" };
    const t = 1_700_000_000_000;
    const k1 = await assessIdempotencyKey(body, t);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(await assessIdempotencyKey(body, t + 1000)).toBe(k1);
    expect(await assessIdempotencyKey({ ...body, payee: "x@y" }, t)).not.toBe(k1);
  });
});

describe("page guard models (§5.5)", () => {
  const assessed = (decision: "BLOCK" | "WARN" | "REVIEW" | "ALLOW"): CheckResult => ({
    kind: "assessment",
    assessment: parseAssessment({
      decision,
      risk_level: "HIGH",
      risk_score: 50,
      coverage: { percent: 65, collected: [], unavailable: [], skipped: [] },
      reasons: ["The page claims to be Northstar University but x.example is not one of its verified domains."],
      identity_verified: false,
      findings: [],
      scan_id: "01M70B0DHPX4YRZZFKR6YD29V3",
      cached: false,
      decided_at: new Date().toISOString(),
    })!,
    checkedAt: Date.now(),
  });

  it("titles a held page as a page, not as an action", async () => {
    const { buildOverlayModel: build } = await import("../src/shared/overlay-model");
    expect(build(assessed("BLOCK"), "payment", Date.now(), "x.example", "page").title).toBe(COPY.page.stopped.payment);
    expect(build(assessed("BLOCK"), "browse", Date.now(), "x.example", "page").title).toBe(COPY.page.stopped.browse);
    expect(build(assessed("WARN"), "browse", Date.now(), "x.example", "page").title).toBe(COPY.page.suspicious.browse);
    expect(build(assessed("REVIEW"), "login", Date.now(), "x.example", "page").title).toBe(COPY.page.review.login);
    // The action stage is unchanged.
    expect(build(assessed("BLOCK"), "payment").title).toBe(COPY.stopped.payment);
  });

  it("BLOCK needs a confirmation click; WARN does not; ALLOW lets the page through", async () => {
    const { buildOverlayModel: build } = await import("../src/shared/overlay-model");
    expect(build(assessed("BLOCK"), "browse", Date.now(), null, "page").secondaryConfirmLabel).toBe(COPY.proceedConfirm);
    expect(build(assessed("WARN"), "browse", Date.now(), null, "page").secondaryConfirmLabel).toBeNull();
    expect(build(assessed("ALLOW"), "browse", Date.now(), null, "page").mode).toBe("proceed");
  });

  it("a failed check is never a pass", async () => {
    const { buildOverlayModel: build } = await import("../src/shared/overlay-model");
    const m = build({ kind: "failure", failure: { code: "TIMEOUT" }, checkedAt: Date.now() }, "browse", Date.now(), null, "page");
    expect(m.mode).toBe("unknown");
    expect(m.body).toContain(COPY.page.notChecked);
  });

  it("link model: names the destination, BLOCK needs two clicks", async () => {
    const { buildLinkModel } = await import("../src/shared/overlay-model");
    const b = buildLinkModel("BLOCK", "trustlens-demo-admissions.vercel.app");
    expect(b.mode).toBe("block");
    expect(b.title).toBe(COPY.page.linkStopped);
    expect(b.body).toContain("trustlens-demo-admissions.vercel.app");
    expect(b.secondaryConfirmLabel).toBe(COPY.proceedConfirm);
    expect(buildLinkModel("WARN", "x.example").mode).toBe("confirm");
    expect(buildLinkModel("WARN", "x.example").secondaryConfirmLabel).toBeNull();
  });
});
