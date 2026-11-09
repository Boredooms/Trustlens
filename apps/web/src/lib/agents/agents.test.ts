import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scan } from "@/lib/api/types";
import { QUESTIONS, citationsResolve, explainScan } from "./explain";
import { proposeActions } from "./actions";
import { buildScanContext, comparePrior } from "./coordinator";

const SCAN: Scan = {
  id: "S2",
  status: "completed",
  url: "https://apply.northstar-admissions.example/register",
  registrable_domain: "northstar-admissions.example",
  intent: "payment",
  decision: "BLOCK",
  risk_level: "CRITICAL",
  risk_score: 81,
  coverage: { percent: 80, collected: ["reputation", "identity", "payment_destination", "infrastructure"], unavailable: ["credential_destination"], skipped: [] },
  reasons: ["Payment address is not registered by the organisation"],
  overrides: ["O-2"],
  findings: [
    { id: "F1", code: "PAYEE_NOT_IN_VERIFIED_PROFILE", signal_group: "payment_destination", severity: "critical", confidence: 1, title: "Payment address is not registered by the organisation", detail: "d", evidence_refs: ["E1"] },
    { id: "F2", code: "DOMAIN_RECENTLY_REGISTERED", signal_group: "infrastructure", severity: "low", confidence: 0.9, title: "Domain was registered recently", detail: "d2", evidence_refs: [] },
  ],
  evidence: [{ id: "E1", source: "page", observed_at: "2026-11-09T09:00:00Z", summary: "Payee string in form" }],
  created_at: "2026-11-09T09:00:00Z",
  completed_at: "2026-11-09T09:00:30Z",
};

describe("explain (client-side reshape, never a verdict)", () => {
  it.each(QUESTIONS.map((q) => q.id))("%s cites only findings, evidence and overrides on the scan", (q) => {
    const ex = explainScan(SCAN, q);
    expect(ex.lines.length).toBeGreaterThan(0);
    expect(citationsResolve(SCAN, ex)).toBe(true);
    const codes = ex.lines.flatMap((l) => l.cites).filter((c) => c.kind === "finding").map((c) => (c as { code: string }).code);
    for (const c of codes) expect(["PAYEE_NOT_IN_VERIFIED_PROFILE", "DOMAIN_RECENTLY_REGISTERED"]).toContain(c);
  });

  it("states what was not checked instead of implying it passed", () => {
    expect(explainScan(SCAN, "meaning").unavailable).toEqual(["Credential destination was not checked on this scan."]);
    expect(explainScan(SCAN, "coverage").lines.map((l) => l.text).join(" ")).toMatch(/not a pass/);
  });

  it("an ALLOW is never described as safe", () => {
    const allow = { ...SCAN, decision: "ALLOW", risk_level: "LOW", risk_score: 0, findings: [], reasons: [], overrides: [] };
    const text = explainScan(allow, "meaning").lines.map((l) => l.text).join(" ");
    expect(text).toMatch(/not a statement that the site is safe/);
    // Outside that disclaimer, nothing may claim safety or trust.
    expect(text.replace(/not a statement that the site is safe/g, "")).not.toMatch(/\b(is safe|safe to|trusted|verified safe)\b/i);
  });

  it("detects a forged citation", () => {
    const ex = explainScan(SCAN, "evidence");
    ex.lines[0]?.cites.push({ kind: "finding", id: "F9", code: "INVENTED_CODE", label: "x" });
    expect(citationsResolve(SCAN, ex)).toBe(false);
  });
});

describe("action planner proposes, never decides", () => {
  it("suggests investigate + report for a blocked, unreported domain, and never alters the decision", () => {
    const acts = proposeActions(SCAN, { domain: "northstar-admissions.example", prior: null, reports: [], campaigns: [], trace: [], generatedAt: 0 }, Date.parse("2026-11-09T10:00:00Z"));
    expect(acts.map((a) => a.kind)).toEqual(["investigate", "report", "note"]);
    expect(SCAN.decision).toBe("BLOCK");
  });

  it("proposes nothing for an unfinished scan", () => {
    expect(proposeActions({ ...SCAN, status: "running" }, null)).toEqual([]);
  });
});

describe("coordinator orbits", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compares with the previous stored decision without re-scoring", () => {
    const prior = comparePrior(SCAN, [
      { id: "S1", url: SCAN.url, intent: "payment", status: "completed", decision: "WARN", risk_level: "HIGH", risk_score: 40, created_at: "2026-11-08T09:00:00Z" },
      { id: "S2", url: SCAN.url, intent: "payment", status: "completed", decision: "BLOCK", risk_level: "CRITICAL", risk_score: 81, created_at: "2026-11-09T09:00:00Z" },
    ]);
    expect(prior.change).toEqual({ from: "WARN", to: "BLOCK", scoreDelta: 41 });
  });

  it("records each orbit in the trace with endpoint templates only, and survives a failing orbit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const p = new URL(String(input)).pathname;
        const h = { "Content-Type": "application/json", "X-Request-Id": `req_${p.split("/").pop()}` };
        if (p === "/api/v1/scans") return new Response(JSON.stringify({ data: [], page: { limit: 20, next_cursor: null } }), { headers: h });
        if (p === "/api/v1/reports") return new Response(JSON.stringify({ error: { code: "INTERNAL", message: "x", request_id: "req_fail" } }), { status: 500, headers: h });
        if (p === "/api/v1/campaigns")
          return new Response(JSON.stringify({ data: [{ id: "C1", name: "Cluster", confidence: 0.8, member_count: 1, first_seen_at: null, last_seen_at: null }], page: { limit: 20, next_cursor: null } }), { headers: h });
        if (p === "/api/v1/campaigns/C1")
          return new Response(JSON.stringify({ id: "C1", name: "Cluster", confidence: 0.8, member_count: 1, first_seen_at: null, last_seen_at: null, members: [{ id: "E", type: "domain", label: "apply.northstar-admissions.example" }], shared_indicators: [] }), { headers: h });
        return new Response("{}", { status: 404 });
      }),
    );
    const ctx = await buildScanContext(SCAN);
    expect(ctx.campaigns?.map((c) => c.matchedMember)).toEqual(["apply.northstar-admissions.example"]);
    expect(ctx.reports).toBeNull();
    const byLabel = Object.fromEntries(ctx.trace.map((s) => [s.label, s]));
    expect(byLabel["Community reports about this domain"]).toMatchObject({ status: "error", errorCode: "INTERNAL", requestIds: ["req_fail"] });
    expect(byLabel["Prior scans of this domain"]).toMatchObject({ status: "empty", requestIds: ["req_scans"] });
    // No step may carry the domain or URL (trace shows sources, never content).
    expect(JSON.stringify(ctx.trace)).not.toContain("northstar");
  });
});
