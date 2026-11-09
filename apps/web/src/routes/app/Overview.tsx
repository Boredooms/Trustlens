import { useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  BellRing,
  FileWarning,
  Gauge,
  Globe2,
  History,
  PieChart,
  RotateCw,
  ScanSearch,
  ShieldHalf,
  ShieldX,
  TrendingUp,
  Waypoints,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScanInput } from "@/components/domain/ScanInput";
import { VerdictBadge } from "@/components/domain/Badges";
import { ConfidenceBar } from "@/components/domain/Meters";
import { StatusCenter } from "@/components/domain/StatusCenter";
import { useAttentionItems } from "@/components/domain/attention";
import { CopyButton, TimeText, UrlText } from "@/components/domain/Text";
import { ChartPanel, type ChartPanelState } from "@/components/data/ChartPanel";
import { RankedBars, RiskTrend, VerdictRing } from "@/components/data/Charts";
import { AnimatedNumber, Reveal, Stagger, StaggerItem } from "@/components/motion/Motion";
import { Button } from "@/components/ui/Button";
import { Card, StatTile } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useCreateScan, useOverview, useScans } from "@/lib/query/hooks";
import { useRecentStore } from "@/stores/recent";
import { DECISION_COPY } from "@/lib/copy";
import type { Overview as OverviewData, ScanSummary } from "@/lib/api/types";
import { recentChange, riskSeries, scanWindow, topDomains, verdictDistribution } from "@/lib/insights";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

const DEMO_URL = "https://apply.northstar-admissions.example/register";
/** The API's maximum page size for GET /scans; charts state this window explicitly. */
const CHART_WINDOW = 100;

/** A null block means its source failed; the rest of the page still renders. */
function BlockUnavailable({ what, onRetry, retrying }: { what: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-strong">We could not load {what}. The rest of the overview is unaffected.</p>
      <Button size="sm" onClick={onRetry} loading={retrying}>
        <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        Try again
      </Button>
    </div>
  );
}

interface BlockProps<K extends keyof OverviewData> {
  title: string;
  description?: string;
  icon?: Parameters<typeof Card>[0]["icon"];
  what: string;
  k: K;
  className?: string;
  render: (v: NonNullable<OverviewData[K]>) => ReactNode;
  actions?: ReactNode;
}

/** One overview block: loading, failed (null), or rendered — independently of every other block. */
function Block<K extends keyof OverviewData>({ title, description, icon, what, k, className, render, actions }: BlockProps<K>) {
  const q = useOverview();
  let body: ReactNode;
  if (q.isPending) body = <SkeletonRows rows={3} label={`Loading ${what}`} />;
  else if (q.isError) body = <BlockUnavailable what={what} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  else {
    const v = q.data[k];
    body =
      v === null || v === undefined ? (
        <BlockUnavailable what={what} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        render(v as NonNullable<OverviewData[K]>)
      );
  }
  return (
    <Card title={title} description={description} icon={icon} actions={actions} className={cn("min-w-0", className)}>
      {body}
    </Card>
  );
}

function chartState(q: ReturnType<typeof useScans>, rows: ScanSummary[], what: string): ChartPanelState {
  if (q.isPending) return { kind: "loading" };
  if (q.isError) return { kind: "error", error: q.error, onRetry: () => void q.refetch(), retrying: q.isFetching };
  if ((q.data?.data.length ?? 0) === 0)
    return {
      kind: "no-data",
      title: "No scans yet",
      description: `Run your first scan and ${what} appears here, drawn from your own results.`,
    };
  if (rows.length === 0) return { kind: "empty", title: "No finished scans yet", description: "Scans still running are not counted." };
  return { kind: "ready" };
}

function KpiRow({ scans, overview }: { scans: ReturnType<typeof useScans>; overview: ReturnType<typeof useOverview> }) {
  const rows = scans.data?.data ?? [];
  const win = scanWindow(rows);
  const blocked = verdictDistribution(rows).find((s) => s.decision === "BLOCK")?.count ?? 0;
  const change = recentChange(rows);
  const rq = overview.data?.report_queue ?? null;
  const certs = overview.data?.certificate_alerts ?? null;
  const soon = certs?.filter((c) => c.days_to_expiry <= 30).length ?? null;
  const loading = scans.isPending;
  return (
    <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StaggerItem index={0}>
        <StatTile
          label="Finished scans"
          icon={ScanSearch}
          value={<AnimatedNumber face="display" value={loading || scans.isError ? null : win.scans} />}
          hint={scans.isError ? "Scans did not load" : `${change.last24h} in the last 24 h`}
        />
      </StaggerItem>
      <StaggerItem index={1}>
        <StatTile
          label="Blocked"
          icon={ShieldX}
          tone={blocked > 0 ? "danger" : "neutral"}
          value={<AnimatedNumber face="display" value={loading || scans.isError ? null : blocked} />}
          hint={scans.isError ? "Scans did not load" : `${change.blockedLast24h} in the last 24 h`}
        />
      </StaggerItem>
      <StaggerItem index={2}>
        <StatTile
          label="Reports waiting"
          icon={FileWarning}
          tone={rq && rq.pending + rq.reviewing > 0 ? "warning" : "neutral"}
          value={<AnimatedNumber face="display" value={rq ? rq.pending + rq.reviewing : null} />}
          hint={rq ? `${rq.pending} pending · ${rq.reviewing} reviewing` : overview.isPending ? "Loading" : "Queue unavailable"}
        />
      </StaggerItem>
      <StaggerItem index={3}>
        <StatTile
          label="Certificates ≤ 30 days"
          icon={ShieldHalf}
          tone={soon && soon > 0 ? "warning" : "neutral"}
          value={<AnimatedNumber face="display" value={soon} />}
          hint={certs ? `${plural(certs.length, "monitored alert")}` : overview.isPending ? "Loading" : "Monitors unavailable"}
        />
      </StaggerItem>
    </Stagger>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const create = useCreateScan();
  const addRecent = useRecentStore((s) => s.add);
  const q = useOverview();
  const scans = useScans({ limit: CHART_WINDOW });
  const rows = useMemo(() => scans.data?.data ?? [], [scans.data]);
  const win = useMemo(() => scanWindow(rows), [rows]);
  const slices = useMemo(() => verdictDistribution(rows), [rows]);
  const trend = useMemo(() => riskSeries(rows), [rows]);
  const series = trend.points;
  const perScan = trend.granularity === "scan";
  const domains = useMemo(() => topDomains(rows), [rows]);
  const { items: status } = useAttentionItems(rows);

  const source = `From your last ${plural(win.scans, "finished scan")}${win.unfinished ? ` (${win.unfinished} still running or failed, not counted)` : ""} · engine decisions as recorded`;
  const trendState = chartState(scans, series.length ? rows : [], "your risk trend");
  const verdictState = chartState(scans, win.scans ? rows : [], "the verdict mix");
  const peak = series.reduce<(typeof series)[number] | null>((best, p) => (best === null || p.max > best.max ? p : best), null);
  const top = slices.reduce((a, b) => (b.count > a.count ? b : a), slices[0] ?? { decision: "UNKNOWN", count: 0, percent: 0 });

  return (
    <>
      <PageHeader
        eyebrow="Investigate"
        title="Overview"
        subtitle="Recent decisions, what needs a person, and how your risk has moved — from your own stored results."
      />
      {q.isError ? (
        <ErrorState className="mb-6" error={q.error} title="The overview did not load" onRetry={() => void q.refetch()} retrying={q.isFetching} compact />
      ) : null}

      <div className="flex flex-col gap-6">
        <KpiRow scans={scans} overview={q} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-8">
            <Card title="Scan a website" description="Check whether a page is authorised to ask for what it asks for." icon={ScanSearch} className="h-full">
              <ScanInput
                submitting={create.isPending}
                onSubmit={({ url, intent }) =>
                  create.mutate(
                    { url, intent },
                    {
                      onSuccess: (r) => {
                        addRecent({ scanId: r.id, url, intent, at: new Date().toISOString() });
                        navigate(`/app/scan/${r.id}`);
                      },
                    },
                  )
                }
              />
              {create.isError ? <ErrorState className="mt-4" error={create.error} title="The scan did not start" compact /> : null}
            </Card>
          </Reveal>
          <Reveal className="lg:col-span-4" delay={0.04}>
            <Card title="Needs attention" description="Pending reviews and expiring trust, newest first." icon={BellRing} className="h-full">
              {q.isPending ? (
                <SkeletonRows rows={3} label="Loading status" />
              ) : (
                <StatusCenter items={status} emptyDescription="No reports waiting, no certificates expiring within 14 days." />
              )}
            </Card>
          </Reveal>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <ChartPanel
            className="lg:col-span-8"
            title="Risk over time"
            description={perScan ? "Engine risk score of each scan (0–100)." : "Highest and mean engine risk score per day (0–100)."}
            icon={TrendingUp}
            state={trendState}
            summary={
              peak ? (
                <>
                  {perScan ? `${plural(series.length, "scored scan")}, one point each.` : `${plural(series.length, "day")} with scored scans.`} Peak{" "}
                  <span className="font-mono tabular text-foreground">{peak.max}</span> on{" "}
                  {peak.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}.{perScan ? " A daily view starts once you have three days of scans." : " Days without a scan are not drawn."}
                </>
              ) : null
            }
            numbers={{
              columns: [
                { key: "day", label: perScan ? "Scanned" : "Day" },
                { key: "max", label: "Highest", align: "right" },
                { key: "mean", label: "Mean", align: "right" },
                { key: "scans", label: "Scans", align: "right" },
              ],
              rows: series.map((p) => ({ day: perScan ? p.date.toLocaleString() : p.day, max: p.max, mean: p.mean, scans: p.scans })),
              note: "Scores are the engine's; this chart does not re-score anything.",
            }}
            source={source}
          >
            <RiskTrend points={series} showMean={!perScan} />
          </ChartPanel>
          <ChartPanel
            className="lg:col-span-4"
            title="Verdict mix"
            description="How the engine decided your finished scans."
            icon={PieChart}
            state={verdictState}
            summary={
              win.scans > 0 ? (
                <>
                  Most often <span className="text-foreground">{DECISION_COPY[top.decision].label.toLowerCase()}</span> ({top.percent}% of{" "}
                  {plural(win.scans, "scan")}).
                </>
              ) : null
            }
            numbers={{
              columns: [
                { key: "decision", label: "Decision" },
                { key: "count", label: "Scans", align: "right" },
                { key: "percent", label: "Share", align: "right" },
              ],
              rows: slices.map((s) => ({ decision: DECISION_COPY[s.decision].label, count: s.count, percent: `${s.percent}%` })),
              note: "No known threat is not a statement that a site is safe.",
            }}
            source={`${plural(win.scans, "finished scan")}`}
          >
            <VerdictRing slices={slices} />
          </ChartPanel>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Block
            title="Recent scans"
            description="Your latest decisions."
            icon={History}
            what="recent scans"
            k="recent_scans"
            className="lg:col-span-7"
            actions={
              <Link to="/app/scan" className="text-xs text-muted-strong underline-offset-4 hover:text-foreground hover:underline">
                All scans
              </Link>
            }
            render={(list) =>
              list.length === 0 ? (
                <EmptyState
                  kind="no-data"
                  title="No scans yet — try the demo lookalike"
                  description={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{DEMO_URL}</span>
                      <CopyButton value={DEMO_URL} />
                    </span>
                  }
                />
              ) : (
                <Stagger as="ul" className="-my-2 divide-y divide-border">
                  {list.slice(0, 6).map((s, i) => (
                    <StaggerItem as="li" index={i} key={s.id} className="row-density flex items-center gap-4">
                      <Link to={`/app/scan/${s.id}`} className="min-w-0 flex-1 truncate rounded-sm hover:underline">
                        <UrlText url={s.url} max={56} />
                      </Link>
                      <VerdictBadge decision={s.decision} riskLevel={s.risk_level} size="sm" />
                      <span className="hidden w-24 text-right text-xs text-muted sm:block">
                        <TimeText iso={s.created_at} />
                      </span>
                    </StaggerItem>
                  ))}
                </Stagger>
              )
            }
          />
          <ChartPanel
            className="lg:col-span-5"
            title="Most-scanned domains"
            description="Registrable domains you checked most, with blocked scans in red."
            icon={Globe2}
            state={chartState(scans, domains.length ? rows : [], "your most-scanned domains")}
            summary={
              domains[0] ? (
                <>
                  <span className="font-mono text-foreground">{domains[0].domain}</span> leads with {plural(domains[0].scans, "scan")}
                  {domains[0].blocked ? `, ${domains[0].blocked} blocked` : ""}.
                </>
              ) : null
            }
            numbers={{
              columns: [
                { key: "domain", label: "Domain" },
                { key: "scans", label: "Scans", align: "right" },
                { key: "blocked", label: "Blocked", align: "right" },
              ],
              rows: domains.map((d) => ({ domain: <span className="font-mono">{d.domain}</span>, scans: d.scans, blocked: d.blocked })),
            }}
            source={source}
          >
            <RankedBars
              data={domains.map((d) => ({ label: d.domain, value: d.scans, secondary: d.blocked }))}
              valueLabel="Scans"
              secondaryLabel="Blocked"
            />
          </ChartPanel>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Block
            title="High-risk domains"
            description="Known-bad infrastructure in your scope, by reputation."
            icon={Activity}
            what="high-risk domains"
            k="high_risk_domains"
            className="lg:col-span-6"
            render={(list) =>
              list.length === 0 ? (
                <EmptyState title="No known bad domains in your scope" />
              ) : (
                <Stagger as="ul" className="-my-2 divide-y divide-border">
                  {list.slice(0, 5).map((d, i) => (
                    <StaggerItem as="li" index={i} key={d.entity_id} className="row-density flex items-center justify-between gap-4">
                      <Link
                        to={`/app/intelligence?entity=${encodeURIComponent(d.entity_id)}`}
                        className="min-w-0 truncate font-mono text-xs hover:underline"
                      >
                        {d.domain}
                      </Link>
                      <span className="font-mono tabular text-xs text-muted-strong" title="Reputation score (negative is worse)">
                        {d.reputation_score}
                      </span>
                    </StaggerItem>
                  ))}
                </Stagger>
              )
            }
          />
          <Block
            title="Certificate alerts"
            description="Monitored certificates closest to expiry."
            icon={ShieldHalf}
            what="certificate alerts"
            k="certificate_alerts"
            className="lg:col-span-6"
            actions={
              <Link to="/app/certificates" className="text-xs text-muted-strong underline-offset-4 hover:text-foreground hover:underline">
                Certificates
              </Link>
            }
            render={(list) =>
              list.length === 0 ? (
                <EmptyState title="No certificates expiring soon" />
              ) : (
                <Stagger as="ul" className="-my-2 divide-y divide-border">
                  {list.slice(0, 5).map((c, i) => (
                    <StaggerItem as="li" index={i} key={c.monitor_id} className="row-density flex items-center justify-between gap-4">
                      <span className="min-w-0 truncate font-mono text-xs">{c.domain}</span>
                      <span className={cn("font-mono tabular text-xs", c.days_to_expiry <= 30 ? "text-warning" : "text-muted-strong")}>
                        {c.days_to_expiry} days
                      </span>
                    </StaggerItem>
                  ))}
                </Stagger>
              )
            }
          />
        </div>

        <Block
          title="Campaigns"
          description="Correlated infrastructure across reports and scans."
          icon={Waypoints}
          what="campaigns"
          k="campaigns"
          actions={
            <Link to="/app/campaigns" className="text-xs text-muted-strong underline-offset-4 hover:text-foreground hover:underline">
              All campaigns
            </Link>
          }
          render={(list) =>
            list.length === 0 ? (
              <EmptyState title="No correlated campaigns yet" description="Campaigns form when confirmed reports share infrastructure." />
            ) : (
              <Stagger as="ul" className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {list.slice(0, 3).map((c, i) => (
                  <StaggerItem as="li" index={i} key={c.id} className="rounded-md border border-border bg-surface-secondary p-3">
                    <Link to={`/app/campaigns/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <ConfidenceBar value={c.confidence} label={`Confidence for ${c.name}`} />
                      <span className="text-xs text-muted">
                        <span className="font-mono tabular text-foreground">{c.member_count}</span> members
                      </span>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            )
          }
        />

        <Block
          title="Quota"
          what="your quota"
          k="quota"
          icon={Gauge}
          render={(qt) => (
            <div className="flex flex-wrap items-center gap-6">
              <p className="font-mono tabular text-sm">
                {qt.scans_used}
                <span className="text-muted">/{qt.scans_limit} scans</span>
              </p>
              <div
                role="meter"
                aria-label="Scan quota used"
                aria-valuemin={0}
                aria-valuemax={qt.scans_limit}
                aria-valuenow={qt.scans_used}
                aria-valuetext={`${qt.scans_used} of ${qt.scans_limit} scans used`}
                className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-secondary"
              >
                <div className="h-full bg-foreground" style={{ width: `${Math.min(100, (qt.scans_used / Math.max(1, qt.scans_limit)) * 100)}%` }} />
              </div>
              <p className="text-xs text-muted">
                Resets <TimeText iso={qt.resets_at} />
              </p>
            </div>
          )}
        />
      </div>
    </>
  );
}
