/**
 * Campaigns — correlated operations as case files. Panels and states:
 *   KPI row          loading (—) · values
 *   Confidence ladder chart (Bklit bars) · loading · error · no-data · numbers popover
 *   Case files       loading · error · no-data (how campaigns form) · cards
 * Confidence is the correlation engine's number; "possible" below 60% is the documented threshold.
 */
import { Link } from "react-router-dom";
import { CalendarRange, Layers, Users, Waypoints } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfidenceBar } from "@/components/domain/Meters";
import { SimulatedBadge } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { ChartPanel, type ChartPanelState } from "@/components/data/ChartPanel";
import { RankedBars } from "@/components/data/Charts";
import { AnimatedNumber, Stagger, StaggerItem } from "@/components/motion/Motion";
import { StatTile } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCampaigns } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { COPY } from "@/lib/copy";
import { percent } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { CampaignSummary } from "@/lib/api/types";

const POSSIBLE_BELOW = 0.6;

function activityDays(c: CampaignSummary): number | null {
  if (!c.first_seen_at || !c.last_seen_at) return null;
  return Math.max(0, Math.round((Date.parse(c.last_seen_at) - Date.parse(c.first_seen_at)) / 86_400_000));
}

function CaseCard({ c }: { c: CampaignSummary }) {
  const possible = c.confidence < POSSIBLE_BELOW;
  const days = activityDays(c);
  return (
    <Link
      to={`/app/campaigns/${c.id}`}
      className="sheen group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-fast hover:border-border-strong hover:shadow-raised"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-eyebrow text-2xs">{possible ? "Possible campaign" : "Correlated campaign"}</p>
          <p className="mt-1 text-base font-medium leading-snug text-foreground group-hover:underline">{c.name}</p>
        </div>
        {c.simulated ? <SimulatedBadge /> : null}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className={cn("font-display text-5xl leading-none", possible ? "text-muted-strong" : "text-foreground")}>{percent(c.confidence)}</p>
        <ConfidenceBar value={c.confidence} label={`Confidence for ${c.name}`} />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-muted">Members</dt>
          <dd className="font-mono tabular text-foreground">{c.member_count}</dd>
        </div>
        <div>
          <dt className="text-muted">Active window</dt>
          <dd className="font-mono tabular text-foreground">{days === null ? "—" : `${days} d`}</dd>
        </div>
        <div className="col-span-2 text-muted">
          First seen <TimeText iso={c.first_seen_at} /> · last seen <TimeText iso={c.last_seen_at} />
        </div>
      </dl>
    </Link>
  );
}

export default function Campaigns() {
  const q = useCampaigns();
  const rows = listData(q.data).slice().sort((a, b) => b.confidence - a.confidence);
  const correlated = rows.filter((c) => c.confidence >= POSSIBLE_BELOW).length;
  const members = rows.reduce((s, c) => s + c.member_count, 0);
  const loaded = Boolean(q.data);
  const chartState: ChartPanelState = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", error: q.error, onRetry: () => void q.refetch(), retrying: q.isFetching }
      : rows.length === 0
        ? { kind: "no-data", title: "No campaigns yet", description: "They form when confirmed reports and scans share strong indicators." }
        : { kind: "ready" };

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Campaigns"
        subtitle={<>Sites that share infrastructure, certificates or payees, correlated into one operation. The number shown is the {COPY.campaignConfidence}.</>}
      />
      <div className="flex flex-col gap-6">
        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StaggerItem index={0}>
            <StatTile label="Campaigns" icon={Waypoints} value={<AnimatedNumber face="display" value={loaded ? rows.length : null} />} hint="in your scope" />
          </StaggerItem>
          <StaggerItem index={1}>
            <StatTile label="Correlated" icon={Layers} tone={correlated ? "danger" : "neutral"} value={<AnimatedNumber face="display" value={loaded ? correlated : null} />} hint={`confidence ≥ ${POSSIBLE_BELOW * 100}%`} />
          </StaggerItem>
          <StaggerItem index={2}>
            <StatTile label="Possible" icon={CalendarRange} value={<AnimatedNumber face="display" value={loaded ? rows.length - correlated : null} />} hint="weaker shared indicators" />
          </StaggerItem>
          <StaggerItem index={3}>
            <StatTile label="Members" icon={Users} value={<AnimatedNumber face="display" value={loaded ? members : null} />} hint="entities across campaigns" />
          </StaggerItem>
        </Stagger>

        <ChartPanel
          title="Confidence ladder"
          description="Each campaign's correlation confidence, highest first."
          icon={Layers}
          state={chartState}
          summary={rows[0] ? <>Highest: <span className="text-foreground">{rows[0].name}</span> at {percent(rows[0].confidence)}.</> : null}
          numbers={{
            columns: [
              { key: "name", label: "Campaign" },
              { key: "confidence", label: "Confidence", align: "right" },
              { key: "members", label: "Members", align: "right" },
            ],
            rows: rows.map((c) => ({ name: c.name, confidence: percent(c.confidence), members: c.member_count })),
          }}
          source="GET /campaigns · correlation engine output"
        >
          <RankedBars data={rows.slice(0, 8).map((c) => ({ label: c.name, value: Math.round(c.confidence * 100) }))} valueLabel="Confidence %" />
        </ChartPanel>

        <section aria-label="Campaign list">
          <h2 className="mb-3 text-sm font-medium">Case files</h2>
          {q.isPending ? (
            <div role="status" aria-label="Loading campaigns" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-48 rounded-lg" />
              ))}
            </div>
          ) : q.isError ? (
            <ErrorState error={q.error} title="We could not load campaigns" onRetry={() => void q.refetch()} retrying={q.isFetching} />
          ) : rows.length === 0 ? (
            <EmptyState
              kind="no-data"
              title="No correlated campaigns yet"
              description="Campaigns appear when two or more scanned sites share strong indicators such as a payee or nameserver."
              action={
                <Link to="/app/scan" className="underline underline-offset-4">
                  Run a scan
                </Link>
              }
            />
          ) : (
            <Stagger as="ul" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((c, i) => (
                <StaggerItem as="li" key={c.id} index={i}>
                  <CaseCard c={c} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </section>
      </div>
    </>
  );
}
