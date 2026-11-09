/**
 * Scan context coordinator ("orbits"). When a person opens a scan report, this assembles LINKED
 * CONTEXT around it from data the API already stores:
 *
 *   orbit 1  prior scans of the same registrable domain      GET /scans?q=<domain>
 *   orbit 2  community reports about that domain            GET /reports (caller's own, last 100)
 *   orbit 3  campaigns that list the domain as a member     GET /campaigns, GET /campaigns/{id} (≤ 5)
 *
 * Rules (DASHBOARD_REBUILD §3, AGENTS.md hard rule 2):
 *   - It never creates a finding, never scores, never changes or "re-ranks" the engine's decision.
 *   - Linked context is labelled as linked context, with its source, never as a verdict.
 *   - Every call goes through the authenticated API client; nothing here holds or fetches a token.
 *   - "What changed" compares stored decisions; it does not re-run the engine on old data.
 */
import { useQuery } from "@tanstack/react-query";
import { api, listData } from "@/lib/api/endpoints";
import type { CampaignSummary, ReportSummary, Scan, ScanSummary } from "@/lib/api/types";
import { toDecision, type Decision } from "@/lib/api/enums";
import { hostOf } from "@/lib/insights";
import { derivedStep, skippedStep, traced, type TraceStep } from "./trace";

export interface PriorScans {
  rows: ScanSummary[];
  /** The most recent earlier finished scan of this domain, if any. */
  previous: ScanSummary | null;
  /** Stored decision of `previous` vs this scan — a comparison, not a new judgement. */
  change: { from: Decision; to: Decision; scoreDelta: number | null } | null;
}

export interface LinkedCampaign extends CampaignSummary {
  matchedMember: string;
}

export interface ScanContext {
  domain: string;
  prior: PriorScans | null;
  reports: ReportSummary[] | null;
  campaigns: LinkedCampaign[] | null;
  trace: TraceStep[];
  generatedAt: number;
}

const MAX_CAMPAIGN_DETAILS = 5;

function matchesDomain(candidate: string, domain: string): boolean {
  const c = candidate.toLowerCase().replace(/\.$/, "");
  const d = domain.toLowerCase();
  return c === d || c.endsWith(`.${d}`);
}

export function domainOf(scan: Pick<Scan, "registrable_domain" | "url">): string {
  return (scan.registrable_domain || hostOf(scan.url) || "").toLowerCase();
}

export function comparePrior(scan: Scan, rows: ScanSummary[]): PriorScans {
  const others = rows
    .filter((r) => r.id !== scan.id && (r.status === "completed" || r.status === "partial") && r.created_at <= scan.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const previous = others[0] ?? null;
  const change = previous
    ? {
        from: toDecision(previous.decision),
        to: toDecision(scan.decision),
        scoreDelta:
          typeof previous.risk_score === "number" && typeof scan.risk_score === "number" ? scan.risk_score - previous.risk_score : null,
      }
    : null;
  return { rows: others, previous, change };
}

export async function buildScanContext(scan: Scan): Promise<ScanContext> {
  const domain = domainOf(scan);
  const trace: TraceStep[] = [];
  if (!domain) {
    trace.push(skippedStep("Linked context", "—", "The scan has no registrable domain to correlate on."));
    return { domain, prior: null, reports: null, campaigns: null, trace, generatedAt: Date.now() };
  }

  const [priorR, reportsR, campaignsR] = await Promise.all([
    traced(
      { label: "Prior scans of this domain", source: "GET /api/v1/scans?q", pathPrefix: "/api/v1/scans", count: (v: ScanSummary[]) => v.length },
      async () => listData(await api.scans.list({ q: domain, limit: 20 })).filter((r) => matchesDomain(r.registrable_domain || hostOf(r.url), domain)),
    ),
    traced(
      { label: "Community reports about this domain", source: "GET /api/v1/reports", pathPrefix: "/api/v1/reports", count: (v: ReportSummary[]) => v.length },
      async () => listData(await api.reports.list({ limit: 100 })).filter((r) => matchesDomain(hostOf(r.url), domain)),
    ),
    traced(
      {
        label: "Campaigns listing this domain",
        source: `GET /api/v1/campaigns + ≤${MAX_CAMPAIGN_DETAILS} details`,
        pathPrefix: "/api/v1/campaigns",
        count: (v: LinkedCampaign[]) => v.length,
      },
      async () => {
        const list = listData(await api.campaigns.list()).slice(0, MAX_CAMPAIGN_DETAILS);
        const details = await Promise.allSettled(list.map((c) => api.campaigns.get(c.id)));
        const linked: LinkedCampaign[] = [];
        details.forEach((d) => {
          if (d.status !== "fulfilled") return;
          const member = d.value.members.find((m) => m.type === "domain" && matchesDomain(m.label, domain));
          if (member) linked.push({ ...d.value, matchedMember: member.label });
        });
        return linked;
      },
    ),
  ]);
  trace.push(priorR.step, reportsR.step, campaignsR.step);

  const prior = priorR.value ? comparePrior(scan, priorR.value) : null;
  if (prior) trace.push(derivedStep("Compared with the previous stored decision", prior.change ? 1 : 0, "Stored decisions only; nothing re-scored."));

  return { domain, prior, reports: reportsR.value, campaigns: campaignsR.value, trace, generatedAt: Date.now() };
}

/** Runs once per finished scan; cached for the session like any other query. */
export function useScanContext(scan: Scan | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["agents", "scan-context", scan?.id ?? ""],
    queryFn: () => buildScanContext(scan as Scan),
    enabled: enabled && Boolean(scan),
    staleTime: 60_000,
    retry: false,
  });
}
