import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { DECISION_COPY } from "@/lib/copy";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScanInput } from "@/components/domain/ScanInput";
import { VerdictBadge, StatusPill } from "@/components/domain/Badges";
import { TimeText, UrlText } from "@/components/domain/Text";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCreateScan, useScans } from "@/lib/query/hooks";
import { isApiError } from "@/lib/api/errors";
import { DECISIONS, SIGNAL_GROUPS } from "@/lib/api/enums";
import { INTENT_LABEL, SIGNAL_GROUP_EXPLAINER, SIGNAL_GROUP_LABEL } from "@/lib/copy";
import { useRecentStore } from "@/stores/recent";

const URL_FIELD_CODES = new Set(["INVALID_URL", "UNSUPPORTED_SCHEME", "URL_HAS_CREDENTIALS", "TARGET_NOT_ALLOWED", "UNSUPPORTED_PORT"]);

const DECISION_FILTERS = ["", ...DECISIONS] as const;

/** Decision + text filters, stored in the URL (?decision=BLOCK&q=northstar) so links and Back work. */
function ScanFilters() {
  const [params, setParams] = useSearchParams();
  const decision = params.get("decision") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const update = (key: "decision" | "q", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="group" aria-label="Filter by decision" className="flex flex-wrap gap-1">
        {DECISION_FILTERS.map((d) => (
          <button
            key={d || "all"}
            type="button"
            aria-pressed={decision === d}
            onClick={() => update("decision", d)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-fast",
              decision === d ? "border-border-strong bg-surface-secondary text-foreground" : "border-border text-muted-strong hover:text-foreground",
            )}
          >
            {d ? DECISION_COPY[d].label : "All"}
          </button>
        ))}
      </div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update("q", q.trim());
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="scan-q" className="sr-only">
          Search scanned addresses
        </label>
        <Input id="scan-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search addresses" className="h-8 w-56" />
      </form>
    </div>
  );
}

function RecentScans() {
  const [params] = useSearchParams();
  const decision = params.get("decision") ?? undefined;
  const q = params.get("q") ?? undefined;
  const query = useScans({ limit: 20, decision: decision || undefined, q: q || undefined });
  if (query.isPending)
    return (
      <div className="p-5">
        <SkeletonRows rows={6} label="Loading recent scans" />
      </div>
    );
  if (query.isError)
    return (
      <ErrorState
        className="m-5"
        error={query.error}
        title="We could not load recent scans"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        compact
      />
    );
  const rows = query.data.data ?? [];
  if (rows.length === 0)
    return decision || q ? (
      <EmptyState className="px-5" title="No scans match these filters" description="Clear the decision or search to see every scan." />
    ) : (
      <EmptyState
        kind="no-data"
        className="px-5"
        title="No scans yet"
        description="Run your first scan above. Try the seeded lookalike apply.northstar-admissions.example with intent Payment."
      />
    );
  return (
    <Table caption="Recent scans">
      <thead>
        <tr>
          <Th>Address</Th>
          <Th>Decision</Th>
          <Th className="hidden md:table-cell">Intent</Th>
          <Th align="right" className="hidden sm:table-cell">
            Score
          </Th>
          <Th align="right">When</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <Tr key={s.id}>
            <Td className="max-w-0 w-1/2">
              <Link to={`/app/scan/${s.id}`} className="block truncate rounded-sm hover:underline">
                <UrlText url={s.url} max={48} />
              </Link>
            </Td>
            <Td>
              {s.decision ? (
                <VerdictBadge decision={s.decision} riskLevel={s.risk_level} size="sm" />
              ) : (
                <StatusPill status={s.status} />
              )}
            </Td>
            <Td className="hidden text-muted-strong md:table-cell">{INTENT_LABEL[s.intent] ?? s.intent}</Td>
            <Td align="right" className="hidden font-mono sm:table-cell">
              {typeof s.risk_score === "number" ? `${s.risk_score}/100` : "—"}
            </Td>
            <Td align="right" className="whitespace-nowrap text-muted-strong">
              <TimeText iso={s.created_at} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function ScanIndex() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateScan();
  const addRecent = useRecentStore((s) => s.add);
  const err = create.error;
  const urlError = isApiError(err) && URL_FIELD_CODES.has(err.code) ? err.message : null;

  return (
    <>
      <PageHeader
        title="Scan"
        subtitle="Check whether a page is authorised to ask for what it asks for. The report opens as soon as the scan starts."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-8">
          <Card title="New scan">
            <ScanInput
              layout="stacked"
              initialUrl={params.get("url") ?? ""}
              initialIntent={params.get("intent") ?? undefined}
              submitting={create.isPending}
              serverError={urlError}
              onSubmit={({ url, intent }) =>
                create.mutate(
                  { url, intent },
                  {
                    onSuccess: (res) => {
                      addRecent({ scanId: res.id, url, intent, at: new Date().toISOString() });
                      navigate(`/app/scan/${res.id}`);
                    },
                  },
                )
              }
            />
            {err && !urlError ? <ErrorState error={err} title="The scan did not start" className="mt-4" compact /> : null}
          </Card>
          <Card title="Scan history" description="Your scans, newest first. Filters stay in the address bar." bodyClassName="p-0">
            <ScanFilters />
            <RecentScans />
          </Card>
        </div>
        <aside className="lg:col-span-4" aria-labelledby="checked-title">
          <section className="sheen rounded-lg border border-border bg-surface p-5 shadow-card">
            <h2 id="checked-title" className="text-sm font-medium">
              What will be checked
            </h2>
            <ol className="mt-4 flex flex-col gap-4">
              {SIGNAL_GROUPS.map((g, i) => (
                <li key={g} className="flex gap-3">
                  <span className="font-mono tabular text-xs text-muted">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{SIGNAL_GROUP_LABEL[g]}</p>
                    <p className="mt-0.5 text-xs text-muted-strong">{SIGNAL_GROUP_EXPLAINER[g]}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-border pt-4 text-xs text-muted">
              Coverage tells you how many of these ran. A result is never stronger than its coverage.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
