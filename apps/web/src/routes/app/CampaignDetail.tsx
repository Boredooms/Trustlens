import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfidenceBar } from "@/components/domain/Meters";
import { SimulatedBadge } from "@/components/domain/Badges";
import { GraphListView, NodeSwatch } from "@/components/domain/GraphList";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCampaign, useGraph } from "@/lib/query/hooks";
import { isNotFound } from "@/lib/api/errors";
import { COPY } from "@/lib/copy";
import { humanise, percent } from "@/lib/format";
import type { Campaign } from "@/lib/api/types";

function exportJson(c: Campaign) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.simulated ? "SIMULATED-" : ""}campaign-${c.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Neighbourhood({ entityId, label, onSelect }: { entityId: string; label: string; onSelect: (id: string, label: string) => void }) {
  const g = useGraph(entityId, 2);
  if (g.isPending) return <SkeletonRows rows={5} label="Loading neighbourhood" />;
  if (g.isError)
    return <ErrorState error={g.error} title={`We could not load the neighbourhood of ${label}`} onRetry={() => void g.refetch()} compact />;
  return <GraphListView graph={g.data} onSelectNode={(n) => onSelect(n.id, n.label)} />;
}

export default function CampaignDetail() {
  const { campaignId = "" } = useParams();
  const q = useCampaign(campaignId);
  const [root, setRoot] = useState<{ id: string; label: string } | null>(null);

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading campaign" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="Campaign" breadcrumbs={[{ label: "Campaigns", to: "/app/campaigns" }, { label: "Campaign" }]} />
        {isNotFound(q.error) ? (
          <EmptyState title="This campaign does not exist or is not visible to you" />
        ) : (
          <ErrorState error={q.error} title="We could not load this campaign" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );
  }

  const c = q.data;
  const possible = c.confidence < 0.6;
  const members = c.members ?? [];
  const indicators = (c.shared_indicators ?? []).slice().sort((a, b) => b.confidence - a.confidence);
  const selected = root ?? (members[0] ? { id: members[0].id, label: members[0].label } : null);

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumbs={[{ label: "Campaigns", to: "/app/campaigns" }, { label: c.name }]}
        meta={c.simulated ? <SimulatedBadge /> : null}
        subtitle={
          <span>
            {possible ? "Possible campaign" : "Correlated campaign"} · first seen <TimeText iso={c.first_seen_at} /> · last
            seen <TimeText iso={c.last_seen_at} />
          </span>
        }
        actions={
          <Button onClick={() => exportJson(c)}>
            <Download aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            Export JSON
          </Button>
        }
      />

      <section aria-labelledby="conf-title" className="mb-6 rounded-md border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p id="conf-title" className="label-eyebrow">
              Confidence
            </p>
            <p className="mt-1 font-mono tabular text-4xl font-medium leading-none">{percent(c.confidence)}</p>
            <p className="mt-2 max-w-prose text-sm text-muted-strong">{COPY.campaignConfidence}.</p>
            {possible ? (
              <p className="mt-1 max-w-prose text-sm text-muted-strong">
                Below 60% this is labelled a possible campaign: the shared indicators are real but individually weak,
                such as a common hosting provider.
              </p>
            ) : null}
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-muted">Members</p>
              <p className="font-mono tabular text-2xl">{c.member_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Shared indicators</p>
              <p className="font-mono tabular text-2xl">{indicators.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Shared indicators" bodyClassName="p-0">
          {indicators.length === 0 ? (
            <EmptyState className="px-5" title="No shared indicators recorded" />
          ) : (
            <Table caption="Shared indicators">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Value</Th>
                  <Th>Confidence</Th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((s, i) => (
                  <Tr key={`${s.type}-${s.value}-${i}`}>
                    <Td className="text-muted-strong">{humanise(s.type)}</Td>
                    <Td className="break-all font-mono text-xs">{s.value}</Td>
                    <Td>
                      <ConfidenceBar value={s.confidence} label={`Confidence for ${s.value}`} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Members" bodyClassName="p-0">
          {members.length === 0 ? (
            <EmptyState className="px-5" title="No members recorded" />
          ) : (
            <Table caption="Campaign members">
              <thead>
                <tr>
                  <Th>Entity</Th>
                  <Th className="hidden sm:table-cell">Type</Th>
                  <Th align="right">Reputation</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <Tr key={m.id} className={selected?.id === m.id ? "bg-surface-secondary" : undefined}>
                    <Td>
                      <button
                        type="button"
                        onClick={() => setRoot({ id: m.id, label: m.label })}
                        className="flex items-center gap-2 rounded-sm text-left hover:underline"
                        aria-pressed={selected?.id === m.id}
                      >
                        <NodeSwatch type={m.type} />
                        <span className="break-all font-mono text-xs">{m.label}</span>
                      </button>
                    </Td>
                    <Td className="hidden text-muted-strong sm:table-cell">{humanise(m.type)}</Td>
                    <Td align="right" className="font-mono">
                      {typeof m.reputation_score === "number" ? m.reputation_score : "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {selected ? (
        <Card
          className="mt-6"
          title={
            <span>
              Neighbourhood of <span className="font-mono">{selected.label}</span>
            </span>
          }
          actions={
            <Link to={`/app/intelligence?entity=${encodeURIComponent(selected.id)}`} className="text-xs underline underline-offset-4">
              Open in intelligence
            </Link>
          }
        >
          <Neighbourhood entityId={selected.id} label={selected.label} onSelect={(id, label) => setRoot({ id, label })} />
        </Card>
      ) : null}
    </>
  );
}
