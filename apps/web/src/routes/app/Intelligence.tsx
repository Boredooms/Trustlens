/**
 * Intelligence — entity neighbourhood explorer. Panels and states:
 *   Query bar        entity ID + depth (URL is the state: ?entity=&depth=)
 *   KPI row          idle (—) · loading (—) · values
 *   Node / edge mix  Bklit bars · idle · loading · error · no-data · numbers popover
 *   Link strength    strong vs weak (dashed) links · same states
 *   Neighbourhood    idle (start from a campaign) · loading · error · list view
 *   Starting points  campaigns list · loading · error · empty
 * Edge confidence is the correlation engine's number; nothing on this page judges a site.
 */
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Gauge, Network, Search, Share2, Spline, Waypoints } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChartPanel, type ChartPanelState } from "@/components/data/ChartPanel";
import { RankedBars } from "@/components/data/Charts";
import { GraphListView, NodeSwatch } from "@/components/domain/GraphList";
import { SimulatedBadge } from "@/components/domain/Badges";
import { ConfidenceBar } from "@/components/domain/Meters";
import { AnimatedNumber } from "@/components/motion/Motion";
import { Button } from "@/components/ui/Button";
import { Card, StatTile } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { useCampaigns, useGraph } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { humanise, percent } from "@/lib/format";
import type { Graph } from "@/lib/api/types";

/** Below this an edge is drawn dashed and faded (DESIGN_SYSTEM §7.9). */
const WEAK_BELOW = 0.5;

function tally(values: string[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([label, value]) => ({ label: humanise(label), value })).sort((a, b) => b.value - a.value);
}

function graphStats(g: Graph | undefined) {
  if (!g) return null;
  const strong = g.edges.filter((e) => e.confidence >= WEAK_BELOW).length;
  const mean = g.edges.length ? g.edges.reduce((s, e) => s + e.confidence, 0) / g.edges.length : null;
  return {
    nodes: g.counts?.nodes ?? g.nodes.length,
    edges: g.counts?.edges ?? g.edges.length,
    strong,
    weak: g.edges.length - strong,
    mean,
    nodeMix: tally(g.nodes.map((n) => n.type)),
    edgeMix: tally(g.edges.map((e) => e.type)),
  };
}

function StartingPoints() {
  const q = useCampaigns();
  const rows = listData(q.data).slice().sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  return (
    <Card title="Starting points" description="Campaigns are the quickest way in: open one and pick a member.">
      {q.isPending ? (
        <SkeletonRows rows={4} label="Loading campaigns" />
      ) : q.isError ? (
        <ErrorState error={q.error} title="We could not load campaigns" onRetry={() => void q.refetch()} compact />
      ) : rows.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Campaigns form when several scans share infrastructure. Paste an entity ID above instead." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Link to={`/app/campaigns/${c.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                {c.name}
              </Link>
              {c.simulated ? <SimulatedBadge /> : null}
              <span className="font-mono tabular text-xs text-muted">{c.member_count} members</span>
              <ConfidenceBar value={c.confidence} label={`Confidence for ${c.name}`} className="w-32" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Intelligence() {
  const [params, setParams] = useSearchParams();
  const entity = params.get("entity");
  const depth = Math.min(3, Math.max(1, Number(params.get("depth") ?? 2) || 2));
  const [draft, setDraft] = useState(entity ?? "");
  const g = useGraph(entity, depth);
  const stats = graphStats(g.data);

  const go = (id: string, d = depth) => {
    setDraft(id);
    if (id) setParams({ entity: id, depth: String(d) });
    else setParams({});
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = draft.trim();
    if (id) go(id);
  };

  const chartState = (hasData: boolean, emptyTitle: string): ChartPanelState =>
    !entity
      ? { kind: "empty", title: "Search an entity to see its shape" }
      : g.isPending
        ? { kind: "loading" }
        : g.isError
          ? { kind: "error", error: g.error, onRetry: () => void g.refetch() }
          : hasData
            ? { kind: "ready" }
            : { kind: "empty", title: emptyTitle };

  const kpi = (v: number | null | undefined, fmt?: (n: number) => string) =>
    stats && typeof v === "number" ? fmt ? fmt(v) : <AnimatedNumber value={v} face="display" /> : "—";
  const root = g.data?.nodes.find((n) => n.id === g.data?.root);

  return (
    <>
      <PageHeader
        title="Intelligence"
        subtitle="How an entity connects to domains, certificates, nameservers and payees. Weak links are shown, labelled and faded."
      />

      <section aria-label="Entity query" className="mesh-panel mb-6 rounded-xl border border-border p-5 shadow-raised">
        <form onSubmit={submit} className="flex flex-col gap-4 md:flex-row md:items-end">
          <Field label="Entity ID" className="flex-1" help="Open an entity from a campaign, or paste its ID.">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono" spellCheck={false} />
          </Field>
          <Field label="Depth" className="md:w-32">
            <Select value={String(depth)} onChange={(e) => entity && go(entity, Number(e.target.value))}>
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
            </Select>
          </Field>
          <div className="md:pb-5">
            <Button type="submit" variant="primary">
              <Search aria-hidden className="h-4 w-4" strokeWidth={1.5} />
              Explore
            </Button>
          </div>
        </form>
        {root ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-strong">
            <NodeSwatch type={root.type} />
            Root: <span className="break-all font-mono text-xs text-foreground">{root.label}</span>
            <span className="text-muted">· {humanise(root.type)}</span>
          </p>
        ) : null}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy={Boolean(entity) && g.isPending}>
        <StatTile label="Nodes" icon={Network} value={kpi(stats?.nodes)} hint={`Within ${depth} ${depth === 1 ? "hop" : "hops"}`} />
        <StatTile label="Links" icon={Share2} value={kpi(stats?.edges)} hint="Relationships observed" />
        <StatTile label="Weak links" icon={Spline} value={kpi(stats?.weak)} hint={`Below ${percent(WEAK_BELOW)} confidence`} tone={stats?.weak ? "warning" : "neutral"} />
        <StatTile label="Mean confidence" icon={Gauge} value={kpi(stats?.mean, (n) => percent(n))} hint="Across every link shown" />
      </div>

      {g.data?.truncated ? (
        <Banner className="mb-6" title="This neighbourhood was truncated at the node limit">
          Lower the depth, or open a member to focus on a smaller area.
        </Banner>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartPanel
          title="Node mix"
          description="What kinds of entity sit in this neighbourhood."
          icon={Waypoints}
          state={chartState(Boolean(stats?.nodeMix.length), "No nodes returned")}
          summary={stats?.nodeMix[0] ? <>Most common: <span className="text-foreground">{stats.nodeMix[0].label}</span> ({stats.nodeMix[0].value}).</> : null}
          numbers={{
            columns: [
              { key: "label", label: "Type" },
              { key: "value", label: "Nodes", align: "right" },
            ],
            rows: stats?.nodeMix ?? [],
          }}
          source="GET /graph/{entity_id} · nodes"
        >
          <RankedBars data={stats?.nodeMix ?? []} valueLabel="Nodes" />
        </ChartPanel>
        <ChartPanel
          title="Link mix"
          description="How the entities are connected, by relationship."
          icon={Share2}
          state={chartState(Boolean(stats?.edgeMix.length), "No relationships above the confidence threshold")}
          summary={
            stats && stats.edges > 0 ? (
              <>
                <span className="text-foreground">{stats.strong}</span> strong, <span className="text-foreground">{stats.weak}</span> weak (dashed).
              </>
            ) : null
          }
          numbers={{
            columns: [
              { key: "label", label: "Relationship" },
              { key: "value", label: "Links", align: "right" },
            ],
            rows: stats?.edgeMix ?? [],
          }}
          source="GET /graph/{entity_id} · edges"
        >
          <RankedBars data={stats?.edgeMix ?? []} valueLabel="Links" />
        </ChartPanel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card title="Neighbourhood (list view)" className="min-w-0 xl:col-span-8">
          {!entity ? (
            <EmptyState
              title="Search an entity to explore its neighbourhood"
              description="The quickest start is a campaign: open one and pick a member."
            />
          ) : g.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-64" />
              <SkeletonRows rows={6} label="Loading graph" />
            </div>
          ) : g.isError ? (
            <ErrorState error={g.error} title="We could not load this neighbourhood" onRetry={() => void g.refetch()} retrying={g.isFetching} />
          ) : (
            <GraphListView graph={g.data} onSelectNode={(n) => go(n.id)} />
          )}
        </Card>
        <div className="min-w-0 xl:col-span-4">
          <StartingPoints />
        </div>
      </div>
    </>
  );
}
