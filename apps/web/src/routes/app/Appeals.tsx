import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Forbidden } from "@/components/layout/Guards";
import { StatusPill } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { isAnalystRole, useAppeals, useMe } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { isForbidden } from "@/lib/api/errors";
import { APPEAL_STATUS_LABEL } from "@/lib/copy";

const STATUSES = ["", "challenge_verified", "pending_challenge", "approved", "rejected", "expired"] as const;

export default function Appeals() {
  const me = useMe();
  const allowed = isAnalystRole(me.data?.role ?? null);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const q = useAppeals({ status: status || undefined, limit: 25, cursor }, allowed);
  const rows = listData(q.data);
  const next = q.data?.page?.next_cursor ?? null;

  return (
    <>
      <PageHeader
        title="Appeals"
        subtitle="Site owners who say a decision is wrong. Approve only after they have proven control of the domain."
      />
      {me.isPending ? (
        <SkeletonRows rows={3} label="Checking your access" />
      ) : !allowed ? (
        <Forbidden what="appeals" />
      ) : (
        <section aria-label="Appeal queue" className="rounded-md border border-border bg-surface">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-end">
            <Field label="Status" className="sm:w-64">
              <Select
                value={status}
                onChange={(e) => {
                  setCursors([]);
                  const p = new URLSearchParams(params);
                  if (e.target.value) p.set("status", e.target.value);
                  else p.delete("status");
                  setParams(p, { replace: true });
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s ? APPEAL_STATUS_LABEL[s] ?? s : "All statuses"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {q.isPending ? (
            <div className="p-5">
              <SkeletonRows rows={4} label="Loading appeals" />
            </div>
          ) : q.isError ? (
            isForbidden(q.error) ? (
              <div className="p-5">
                <Forbidden what="appeals" />
              </div>
            ) : (
              <ErrorState className="m-5" error={q.error} title="We could not load appeals" onRetry={() => void q.refetch()} retrying={q.isFetching} />
            )
          ) : rows.length === 0 ? (
            <EmptyState
              className="px-5"
              title={status ? "No appeals with this status" : "No appeals"}
              description="Owners appeal from the public appeal page, linked from every block and warning."
            />
          ) : (
            <>
              <Table caption="Appeals">
                <thead>
                  <tr>
                    <Th>Domain</Th>
                    <Th>Status</Th>
                    <Th align="right" className="hidden md:table-cell">
                      Open reports
                    </Th>
                    <Th align="right" className="hidden lg:table-cell">
                      Reputation
                    </Th>
                    <Th className="hidden sm:table-cell">Received</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <Tr key={a.id}>
                      <Td className="break-all font-mono text-xs">
                        <Link to={`/app/appeals/${a.id}`} className="hover:underline">
                          {a.domain}
                        </Link>
                      </Td>
                      <Td>
                        <StatusPill status={a.status} />
                      </Td>
                      <Td align="right" className="hidden font-mono md:table-cell">
                        {a.open_reports}
                      </Td>
                      <Td align="right" className="hidden font-mono lg:table-cell">
                        {a.current_reputation ?? "—"}
                      </Td>
                      <Td className="hidden text-muted-strong sm:table-cell">
                        <TimeText iso={a.created_at} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {next || cursors.length > 0 ? (
                <div className="flex justify-between gap-3 border-t border-border px-5 py-3">
                  <Button size="sm" variant="ghost" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
                    Previous
                  </Button>
                  <Button size="sm" disabled={!next} loading={q.isFetching} onClick={() => next && setCursors((c) => [...c, next])}>
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </>
  );
}
