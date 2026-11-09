/**
 * Pure aggregations behind the dashboard charts. Every number here is a count or an average of rows
 * the API returned; nothing is extrapolated, smoothed or re-scored. A chart built from these must say
 * what window it covers (`window`), because the API returns at most 100 scans per page.
 *
 * Decisions are the engine's decisions, read as-is (toDecision maps unknown wire values to UNKNOWN).
 */
import { DECISIONS, toDecision, type Decision } from "@/lib/api/enums";
import type { ScanSummary } from "@/lib/api/types";

export interface VerdictSlice {
  decision: Decision;
  count: number;
  /** 0–100, rounded; slices of a non-empty window sum to 100 ± rounding. */
  percent: number;
}

export interface InsightWindow {
  /** Rows considered (completed or partial scans with a decision). */
  scans: number;
  /** Rows skipped because they had not finished (queued/running/failed). */
  unfinished: number;
  from: string | null;
  to: string | null;
}

const FINISHED = new Set(["completed", "partial"]);

export function finishedScans(rows: ScanSummary[]): ScanSummary[] {
  return rows.filter((r) => FINISHED.has(r.status) && r.decision !== null);
}

export function scanWindow(rows: ScanSummary[]): InsightWindow {
  const done = finishedScans(rows);
  const times = done.map((r) => r.created_at).sort();
  return {
    scans: done.length,
    unfinished: rows.length - done.length,
    from: times[0] ?? null,
    to: times[times.length - 1] ?? null,
  };
}

/** Count of each engine decision in the window, in the canonical decision order. */
export function verdictDistribution(rows: ScanSummary[]): VerdictSlice[] {
  const done = finishedScans(rows);
  const counts = new Map<Decision, number>(DECISIONS.map((d) => [d, 0]));
  for (const r of done) {
    const d = toDecision(r.decision);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const total = done.length;
  return DECISIONS.map((decision) => {
    const count = counts.get(decision) ?? 0;
    return { decision, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}

export interface RiskPoint {
  /** Local calendar day (YYYY-MM-DD) the scans were created. */
  day: string;
  date: Date;
  /** Highest engine risk score that day — the number that matters for exposure. */
  max: number;
  /** Mean engine risk score that day, one decimal. */
  mean: number;
  scans: number;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Daily risk series: one point per calendar day that had at least one scored scan. Days without
 * scans are absent (not zero): no scan is not "no risk".
 */
export function riskByDay(rows: ScanSummary[]): RiskPoint[] {
  const byDay = new Map<string, number[]>();
  for (const r of finishedScans(rows)) {
    if (typeof r.risk_score !== "number" || !Number.isFinite(r.risk_score)) continue;
    const key = localDay(r.created_at);
    const list = byDay.get(key) ?? [];
    list.push(r.risk_score);
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, scores]) => {
      const [y, m, d] = day.split("-").map(Number) as [number, number, number];
      const sum = scores.reduce((s, v) => s + v, 0);
      return {
        day,
        date: new Date(y, m - 1, d),
        max: Math.max(...scores),
        mean: Math.round((sum / scores.length) * 10) / 10,
        scans: scores.length,
      };
    });
}

export type RiskGranularity = "day" | "scan";

/**
 * The series a trend chart should draw. With fewer than 3 days of history a daily series is one or
 * two dots, so each scored scan becomes its own point instead (max = mean = that scan's score).
 * The granularity is returned so the chart can say which one it is drawing.
 */
export function riskSeries(rows: ScanSummary[]): { granularity: RiskGranularity; points: RiskPoint[] } {
  const daily = riskByDay(rows);
  if (daily.length >= 3) return { granularity: "day", points: daily };
  const points = finishedScans(rows)
    .filter((r) => typeof r.risk_score === "number" && Number.isFinite(r.risk_score))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map((r) => ({
      day: r.created_at,
      date: new Date(r.created_at),
      max: r.risk_score as number,
      mean: r.risk_score as number,
      scans: 1,
    }));
  return { granularity: "scan", points };
}

export interface DomainCount {
  domain: string;
  scans: number;
  blocked: number;
}

/** Registrable domains scanned most often in the window, with how many of those scans were BLOCK. */
export function topDomains(rows: ScanSummary[], limit = 6): DomainCount[] {
  const map = new Map<string, DomainCount>();
  for (const r of finishedScans(rows)) {
    const domain = r.registrable_domain || hostOf(r.url);
    if (!domain) continue;
    const entry = map.get(domain) ?? { domain, scans: 0, blocked: 0 };
    entry.scans += 1;
    if (toDecision(r.decision) === "BLOCK") entry.blocked += 1;
    map.set(domain, entry);
  }
  return [...map.values()].sort((a, b) => b.scans - a.scans || b.blocked - a.blocked || a.domain.localeCompare(b.domain)).slice(0, limit);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** "What changed": decisions in the last 24 h vs the 24 h before, from stored rows only. */
export function recentChange(rows: ScanSummary[], now: Date = new Date()): { last24h: number; previous24h: number; blockedLast24h: number } {
  const t = now.getTime();
  const day = 24 * 60 * 60 * 1000;
  let last24h = 0;
  let previous24h = 0;
  let blockedLast24h = 0;
  for (const r of finishedScans(rows)) {
    const age = t - new Date(r.created_at).getTime();
    if (age < 0) continue;
    if (age <= day) {
      last24h += 1;
      if (toDecision(r.decision) === "BLOCK") blockedLast24h += 1;
    } else if (age <= 2 * day) previous24h += 1;
  }
  return { last24h, previous24h, blockedLast24h };
}
