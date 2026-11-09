/**
 * Reports — triage desk. Panels and states:
 *   Pipeline   counts per status from your latest 100 reports (loading · error · values)
 *   Filters    status chips in the URL (?status=)
 *   Queue      loading · error · empty (filtered) · no data (how reports arrive) · table
 * Analysts confirm or dismiss; a confirmed report adds reputation and can warn other users.
 */
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleDashed, Inbox, ScanEye, XCircle, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill, VerdictBadge } from "@/components/domain/Badges";
import { TimeText, UrlText } from "@/components/domain/Text";
import { AnimatedNumber, Stagger, StaggerItem } from "@/components/motion/Motion";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useReports } from "@/lib/query/hooks";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/api/enums";
import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

const STAGE: Record<Exclude<ReportStatus, "unknown">, { icon: LucideIcon; tone: string; bar: string; hint: string }> = {
  pending: { icon: Inbox, tone: "text-warning", bar: "bg-warning", hint: "waiting for an analyst" },
  reviewing: { icon: ScanEye, tone: "text-foreground", bar: "bg-foreground", hint: "an analyst is on it" },
  confirmed: { icon: CheckCircle2, tone: "text-danger", bar: "bg-danger", hint: "adds reputation, can warn others" },
  dismissed: { icon: XCircle, tone: "text-muted-strong", bar: "bg-border-strong", hint: "not supported by evidence" },
};

function Pipeline({ counts, total, loading, active, onSelect }: { counts: Record<string, number>; total: number; loading: boolean; active: string; onSelect: (s: string) => void }) {
  return (
    <Card title="Triage pipeline" description="Your latest 100 reports by stage. Select a stage to filter the queue." icon={CircleDashed}>
      <div className="flex flex-col gap-4">
        <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-surface-secondary">
          {REPORT_STATUSES.map((s) => (
            <span key={s} className={cn("h-full transition-[width] duration-slow ease-standard", STAGE[s].bar)} style={{ width: total ? `${((counts[s] ?? 0) / total) * 100}%` : "0%" }} />
          ))}
        </div>
        <Stagger as="ul" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {REPORT_STATUSES.map((s, i) => {
            const st = STAGE[s];
            return (
              <StaggerItem as="li" key={s} index={i}>
                <button
                  type="button"
                  aria-pressed={active === s}
                  onClick={() => onSelect(active === s ? "" : s)}
                  className={cn(
                    "sheen flex w-full flex-col gap-2 rounded-lg border p-4 text-left transition-[border-color,box-shadow] duration-fast",
                    active === s ? "border-border-strong shadow-raised" : "border-border hover:border-border-strong",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="label-eyebrow text-2xs">{humanise(s)}</span>
                    <st.icon aria-hidden className={cn("h-4 w-4", st.tone)} strokeWidth={1.5} />
                  </span>
                  <span className={cn("font-display text-4xl leading-none", st.tone)}>
                    <AnimatedNumber face="display" value={loading ? null : (counts[s] ?? 0)} />
                  </span>
                  <span className="text-2xs text-muted">{st.hint}</span>
                </button>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </Card>
  );
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const all = useReports({ limit: 100 });
  const q = useReports({ status: status || undefined, limit: 50 });
  const rows = q.data?.data ?? [];
  const allRows = all.data?.data ?? [];
  const counts = allRows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader
        eyebrow="Trust"
        title="Reports"
        subtitle="Community reports waiting for analyst review. A confirmed report adds reputation to the domain and can warn other users."
      />
      <div className="flex flex-col gap-6">
        {all.isError ? (
          <ErrorState error={all.error} title="We could not load the pipeline" onRetry={() => void all.refetch()} retrying={all.isFetching} compact />
        ) : (
          <Pipeline counts={counts} total={allRows.length} loading={all.isPending} active={status} onSelect={(s) => setParams(s ? { status: s } : {})} />
        )}

        <Card
          title="Queue"
          description={status ? `${humanise(status)} reports, newest first.` : "All reports, newest first."}
          bodyClassName="p-0"
          actions={
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {["", ...REPORT_STATUSES].map((s) => (
                <button
                  key={s || "all"}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setParams(s ? { status: s } : {})}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-fast",
                    status === s ? "border-border-strong bg-surface-secondary text-foreground" : "border-border text-muted-strong hover:text-foreground",
                  )}
                >
                  {s ? humanise(s) : "All"}
                </button>
              ))}
            </div>
          }
        >
          {q.isPending ? (
            <div className="p-5">
              <SkeletonRows rows={5} label="Loading reports" />
            </div>
          ) : q.isError ? (
            <ErrorState className="m-5" error={q.error} title="We could not load reports" onRetry={() => void q.refetch()} retrying={q.isFetching} />
          ) : rows.length === 0 ? (
            <EmptyState
              className="px-5"
              kind={status ? "empty" : "no-data"}
              title={status ? `No ${humanise(status).toLowerCase()} reports` : "Nothing waiting"}
              description={status ? "Try another status filter." : "Reports appear here when someone uses “Report this site” on a scan report or in the extension."}
            />
          ) : (
            <Table caption="Reports">
              <thead>
                <tr>
                  <Th>Address</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Linked decision</Th>
                  <Th className="hidden lg:table-cell">Channel</Th>
                  <Th align="right">Created</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="max-w-0 w-1/2">
                      <Link to={`/app/reports/${r.id}`} className="block truncate rounded-sm font-mono text-xs hover:underline">
                        <UrlText url={r.url} max={48} />
                      </Link>
                    </Td>
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td className="hidden md:table-cell">{r.decision ? <VerdictBadge decision={r.decision} size="sm" /> : <span className="text-muted">—</span>}</Td>
                    <Td className="hidden text-muted-strong lg:table-cell">{r.channel ? humanise(r.channel) : "—"}</Td>
                    <Td align="right" className="whitespace-nowrap text-muted-strong">
                      <TimeText iso={r.created_at} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
