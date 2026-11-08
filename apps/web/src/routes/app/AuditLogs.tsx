import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Forbidden } from "@/components/layout/Guards";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useAuditLogs, useMe } from "@/lib/query/hooks";
import { isForbidden } from "@/lib/api/errors";
import type { AuditFilters, AuditLogEntry } from "@/lib/api/types";
import { humanise } from "@/lib/format";

const ACTION_SUGGESTIONS = [
  "org.create",
  "org.update",
  "org.publish",
  "org.suspend",
  "org.member.invite",
  "org.member.remove",
  "domain.add",
  "domain.verify",
  "domain.revoke",
  "recipient.add",
  "recipient.verify",
  "recipient.reject",
  "recipient.revoke",
  "report.review",
  "api_key.create",
  "api_key.revoke",
];

/** `from`/`to` inputs are dates; the API receives ISO instants covering whole UTC days. */
export function toApiFilters(p: URLSearchParams): AuditFilters {
  const f: AuditFilters = { limit: 50 };
  const action = p.get("action");
  const actor = p.get("actor_id");
  const from = p.get("from");
  const to = p.get("to");
  if (action) f.action = action;
  if (actor) f.actor_id = actor;
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) f.from = `${from}T00:00:00Z`;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) f.to = `${to}T23:59:59Z`;
  return f;
}

function Changes({ entry }: { entry: AuditLogEntry }) {
  if (!entry.before && !entry.after) return <span className="text-muted">—</span>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none text-muted-strong hover:text-foreground">Show change</summary>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div>
          <p className="text-muted">Before</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-surface-secondary p-2 font-mono">
            {entry.before ? JSON.stringify(entry.before, null, 2) : "—"}
          </pre>
        </div>
        <div>
          <p className="text-muted">After</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-surface-secondary p-2 font-mono">
            {entry.after ? JSON.stringify(entry.after, null, 2) : "—"}
          </pre>
        </div>
      </div>
    </details>
  );
}

function actorLabel(e: AuditLogEntry): string {
  if (e.actor_email) return e.actor_email;
  const id = e.actor_user_id ?? e.actor_id;
  if (id) return id;
  return e.actor_kind ? humanise(e.actor_kind) : "System";
}

export default function AuditLogs() {
  const me = useMe();
  const isOperator = me.data?.role === "operator";
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState({
    action: params.get("action") ?? "",
    actor_id: params.get("actor_id") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  });
  const filters = toApiFilters(params);
  const q = useAuditLogs(filters, isOperator);
  const rows = q.data?.pages.flatMap((p) => p?.data ?? []) ?? [];
  const filtered = Boolean(filters.action || filters.actor_id || filters.from || filters.to);

  const apply = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v.trim()) p.set(k, v.trim());
    setParams(p, { replace: true });
  };
  const clear = () => {
    setDraft({ action: "", actor_id: "", from: "", to: "" });
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to profiles, domains, payees, members, keys and reviews. Values are redacted." />
      {me.isPending ? (
        <SkeletonRows rows={4} label="Checking your access" />
      ) : !isOperator ? (
        <Forbidden what="the audit log" needs="the operator role" />
      ) : (
        <section aria-label="Audit entries" className="rounded-md border border-border bg-surface">
          <form
            className="grid grid-cols-1 gap-3 border-b border-border px-5 py-4 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <Field label="Action">
              <Input value={draft.action} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))} list="audit-actions" placeholder="domain.verify" />
            </Field>
            <datalist id="audit-actions">
              {ACTION_SUGGESTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <Field label="Actor ID">
              <Input value={draft.actor_id} onChange={(e) => setDraft((d) => ({ ...d, actor_id: e.target.value }))} spellCheck={false} />
            </Field>
            <Field label="From">
              <Input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            </Field>
            <Field label="To">
              <Input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </Field>
            <div className="flex gap-2 md:pb-[22px]">
              <Button type="submit" variant="primary">
                Apply
              </Button>
              {filtered ? (
                <Button variant="ghost" onClick={clear}>
                  Clear
                </Button>
              ) : null}
            </div>
          </form>
          {q.isPending ? (
            <div className="p-5">
              <SkeletonRows rows={5} label="Loading audit entries" />
            </div>
          ) : q.isError ? (
            isForbidden(q.error) ? (
              <div className="p-5">
                <Forbidden what="the audit log" needs="the operator role" />
              </div>
            ) : (
              <ErrorState className="m-5" error={q.error} title="We could not load the audit log" onRetry={() => void q.refetch()} retrying={q.isFetching} />
            )
          ) : rows.length === 0 ? (
            <EmptyState
              className="px-5"
              title={filtered ? "No entries match these filters" : "No audit entries yet"}
              description={filtered ? "Widen the date range or clear the filters." : "Entries appear when profiles, keys or reviews change."}
            />
          ) : (
            <>
              <Table caption="Audit entries">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th className="hidden md:table-cell">Actor</Th>
                    <Th className="hidden lg:table-cell">Target</Th>
                    <Th>Change</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap text-muted-strong">
                        <TimeText iso={e.created_at} />
                      </Td>
                      <Td className="font-mono text-xs">{e.action}</Td>
                      <Td className="hidden break-all text-xs md:table-cell">{actorLabel(e)}</Td>
                      <Td className="hidden text-xs text-muted-strong lg:table-cell">
                        {e.target_type ? humanise(e.target_type) : "—"}
                        {e.target_id ? <span className="block break-all font-mono text-muted">{e.target_id}</span> : null}
                      </Td>
                      <Td>
                        <Changes entry={e} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
                <span>
                  Showing <span className="font-mono tabular text-foreground">{rows.length}</span> entries
                </span>
                {q.hasNextPage ? (
                  <Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                    Load more
                  </Button>
                ) : (
                  <span>End of the log</span>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
