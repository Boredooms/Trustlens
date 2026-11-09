import type { ScanSummary } from "@/lib/api/types";
import { recentChange, riskByDay, riskSeries, scanWindow, topDomains, verdictDistribution } from "./insights";

function scan(p: Partial<ScanSummary> & Pick<ScanSummary, "id">): ScanSummary {
  return {
    url: "https://a.example/",
    intent: "browse",
    status: "completed",
    decision: "ALLOW",
    risk_level: "LOW",
    risk_score: 0,
    created_at: "2026-11-09T10:00:00Z",
    ...p,
  };
}

describe("insights (dashboard charts read engine output as-is)", () => {
  const rows = [
    // Mid-day UTC so day grouping (local calendar day) is stable for UTC-11 … UTC+10 test machines.
    scan({ id: "1", decision: "BLOCK", risk_score: 81, registrable_domain: "bad.example", created_at: "2026-11-08T12:00:00Z" }),
    scan({ id: "2", decision: "BLOCK", risk_score: 70, registrable_domain: "bad.example", created_at: "2026-11-08T13:00:00Z" }),
    scan({ id: "3", decision: "ALLOW", risk_score: 0, registrable_domain: "good.example", created_at: "2026-11-09T12:00:00Z" }),
    scan({ id: "4", decision: "WARN", risk_score: 10, registrable_domain: "cert.example", created_at: "2026-11-09T13:00:00Z" }),
    scan({ id: "5", status: "running", decision: null, risk_score: null }),
    scan({ id: "6", decision: "something-new", risk_score: null }),
  ];

  it("counts each decision and never counts unfinished scans", () => {
    const d = verdictDistribution(rows);
    expect(d.map((s) => [s.decision, s.count])).toEqual([
      ["BLOCK", 2],
      ["WARN", 1],
      ["ALLOW", 1],
      ["REVIEW", 0],
      ["UNKNOWN", 1],
    ]);
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(5);
    expect(scanWindow(rows)).toMatchObject({ scans: 5, unfinished: 1 });
  });

  it("an empty window is all zeros, not NaN", () => {
    expect(verdictDistribution([]).every((s) => s.count === 0 && s.percent === 0)).toBe(true);
    expect(riskByDay([])).toEqual([]);
  });

  it("risk series has one point per day with scores, max and mean; unscored scans are skipped", () => {
    const series = riskByDay(rows);
    expect(series.map((p) => [p.max, p.mean, p.scans])).toEqual([
      [81, 75.5, 2],
      [10, 5, 2],
    ]);
  });

  it("falls back to one point per scored scan when there are fewer than 3 days", () => {
    const s = riskSeries(rows);
    expect(s.granularity).toBe("scan");
    expect(s.points.map((p) => p.max)).toEqual([81, 70, 0, 10]);
  });

  it("top domains rank by scan count and carry the blocked count", () => {
    expect(topDomains(rows, 2)).toEqual([
      { domain: "bad.example", scans: 2, blocked: 2 },
      { domain: "a.example", scans: 1, blocked: 0 },
    ]);
  });

  it("what changed compares the last 24 h with the 24 h before", () => {
    // now = 09T14:00Z: scans 3, 4 and 6 (09T10:00Z default) are within 24 h; 1 and 2 are 25–26 h old.
    expect(recentChange(rows, new Date("2026-11-09T14:00:00Z"))).toEqual({ last24h: 3, previous24h: 2, blockedLast24h: 0 });
  });
});
