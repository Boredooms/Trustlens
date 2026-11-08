import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill, VerdictBadge } from "@/components/domain/Badges";
import { TimeText, UrlText } from "@/components/domain/Text";
import { Field, Select } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useReports } from "@/lib/query/hooks";
import { REPORT_STATUSES } from "@/lib/api/enums";
import { humanise } from "@/lib/format";

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const q = useReports({ status: status || undefined, limit: 50 });
  const rows = q.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Community reports waiting for analyst review. A confirmed report adds reputation to the domain and can warn other users."
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Field label="Status" className="w-48">
          <Select
            value={status}
            onChange={(e) => {
              const v = e.target.value;
              setParams(v ? { status: v } : {});
            }}
          >
            <option value="">All statuses</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanise(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <section aria-label="Report list" className="rounded-md border border-border bg-surface">
        {q.isPending ? (
          <div className="p-5">
            <SkeletonRows rows={5} label="Loading reports" />
          </div>
        ) : q.isError ? (
          <ErrorState className="m-5" error={q.error} title="We could not load reports" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : rows.length === 0 ? (
          <EmptyState
            className="px-5"
            title={status ? `No ${humanise(status).toLowerCase()} reports` : "Nothing waiting"}
            description={
              status
                ? "Try another status filter."
                : "Reports appear here when someone uses “Report this site” on a scan report or in the extension."
            }
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
                    <Link to={`/app/reports/${r.id}`} className="block truncate rounded-sm hover:underline">
                      <UrlText url={r.url} max={48} />
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill status={r.status} />
                  </Td>
                  <Td className="hidden md:table-cell">
                    {r.decision ? <VerdictBadge decision={r.decision} size="sm" /> : <span className="text-muted">—</span>}
                  </Td>
                  <Td className="hidden text-muted-strong lg:table-cell">{r.channel ? humanise(r.channel) : "—"}</Td>
                  <Td align="right" className="whitespace-nowrap text-muted-strong">
                    <TimeText iso={r.created_at} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
