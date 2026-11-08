import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { GraphListView } from "@/components/domain/GraphList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useGraph } from "@/lib/query/hooks";

export default function Intelligence() {
  const [params, setParams] = useSearchParams();
  const entity = params.get("entity");
  const depth = Math.min(3, Math.max(1, Number(params.get("depth") ?? 2) || 2));
  const [draft, setDraft] = useState(entity ?? "");
  const g = useGraph(entity, depth);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = draft.trim();
    if (!id) return;
    setParams({ entity: id, depth: String(depth) });
  };

  return (
    <>
      <PageHeader
        title="Intelligence"
        subtitle="Explore how an entity connects to domains, certificates, nameservers and payees. Weak links are shown, labelled and faded."
      />
      <Card className="mb-6">
        <form onSubmit={submit} className="flex flex-col gap-4 md:flex-row md:items-end">
          <Field label="Entity ID" className="flex-1" help="Open an entity from a campaign, or paste its ID.">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono" spellCheck={false} />
          </Field>
          <Field label="Depth" className="md:w-32">
            <Select
              value={String(depth)}
              onChange={(e) => entity && setParams({ entity, depth: e.target.value })}
            >
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
              <option value="3">3 hops</option>
            </Select>
          </Field>
          <div className="md:pb-5">
            <Button type="submit" variant="primary">
              Explore
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Neighbourhood (list view)">
        {!entity ? (
          <EmptyState
            title="Search an entity to explore its neighbourhood"
            description="The quickest start is a campaign: open one and pick a member."
          />
        ) : g.isPending ? (
          <SkeletonRows rows={6} label="Loading graph" />
        ) : g.isError ? (
          <ErrorState error={g.error} title="We could not load this neighbourhood" onRetry={() => void g.refetch()} retrying={g.isFetching} />
        ) : (
          <GraphListView graph={g.data} onSelectNode={(n) => { setDraft(n.id); setParams({ entity: n.id, depth: String(depth) }); }} />
        )}
      </Card>
    </>
  );
}
