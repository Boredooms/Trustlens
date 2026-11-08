import { useNavigate, useSearchParams, Link } from "react-router-dom";
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
import { SIGNAL_GROUPS } from "@/lib/api/enums";
import { INTENT_LABEL, SIGNAL_GROUP_EXPLAINER, SIGNAL_GROUP_LABEL } from "@/lib/copy";
import { useRecentStore } from "@/stores/recent";

const URL_FIELD_CODES = new Set(["INVALID_URL", "UNSUPPORTED_SCHEME", "URL_HAS_CREDENTIALS", "TARGET_NOT_ALLOWED", "UNSUPPORTED_PORT"]);

function RecentScans() {
  const query = useScans({ limit: 20 });
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
    return (
      <EmptyState
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
          <Card title="Recent scans" bodyClassName="p-0">
            <RecentScans />
          </Card>
        </div>
        <aside className="lg:col-span-4" aria-labelledby="checked-title">
          <section className="rounded-md border border-border bg-surface p-5">
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
