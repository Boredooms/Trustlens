import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCreateMonitor, useDeleteMonitor } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { detailList, toApiError } from "@/lib/api/errors";
import type { CertificateMonitor, List } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/stores/toast";

export function expiryTone(days: number | null | undefined): string {
  if (days === null || days === undefined) return "text-muted";
  if (days <= 7) return "text-danger";
  if (days <= 30) return "text-warning";
  return "text-foreground";
}

export interface OrgOption {
  id: string;
  name: string;
  /** Verified domains to suggest; free text is still allowed. */
  domains?: string[];
}

function AddMonitorDialog({
  open,
  onOpenChange,
  orgs,
  fixedOrgId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgs: OrgOption[];
  fixedOrgId?: string;
}) {
  const create = useCreateMonitor();
  const [orgId, setOrgId] = useState(fixedOrgId ?? orgs[0]?.id ?? "");
  const [domain, setDomain] = useState("");
  const [touched, setTouched] = useState(false);
  const suggestions = orgs.find((o) => o.id === orgId)?.domains ?? [];
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const domainError = !clean.includes(".") ? "Enter a domain, for example login.northstar-demo.example." : null;
  const orgError = !orgId ? "Choose an organisation." : null;
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      create.reset();
      setDomain("");
      setTouched(false);
    }
  };
  const submit = () => {
    setTouched(true);
    if (domainError || orgError) return;
    create.mutate(
      { organisation_id: orgId, domain: clean },
      {
        onSuccess: () => {
          toast.success("Monitor added", `${clean} is checked for certificate changes and expiry.`);
          close(false);
        },
      },
    );
  };
  const serverIssue = create.isError ? detailList(toApiError(create.error)).find((d) => d.field === "domain")?.issue ?? null : null;
  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!create.isPending}
      title="Monitor a domain’s certificate"
      description="TrustLens checks the certificate regularly and alerts before it expires or when the issuer has an incident."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Add monitor
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {fixedOrgId ? null : (
          <Field label="Organisation" required error={touched ? orgError : null}>
            <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.length === 0 ? <option value="">No organisation you administer</option> : null}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Domain" required error={(touched ? domainError : null) ?? serverIssue}>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} list="monitor-domain-suggestions" autoComplete="off" spellCheck={false} />
        </Field>
        {suggestions.length > 0 ? (
          <datalist id="monitor-domain-suggestions">
            {suggestions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        ) : null}
        {create.isError && !serverIssue ? <ErrorState error={create.error} title="The monitor was not added" compact /> : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export interface MonitorsTableProps {
  query: {
    data: List<CertificateMonitor> | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
  /** Organisations the caller may add monitors for (admins/operators). Empty hides "Add monitor". */
  manageableOrgs: OrgOption[];
  fixedOrgId?: string;
  /** Monitor ids the caller may remove. */
  canRemove: (m: CertificateMonitor) => boolean;
}

/** UI_UX_SPECIFICATIONS.md §13 Monitors: domain, last checked, current cert, add/remove. */
export function MonitorsTable({ query: q, manageableOrgs, fixedOrgId, canRemove }: MonitorsTableProps) {
  const del = useDeleteMonitor();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CertificateMonitor | null>(null);
  const rows = listData(q.data);
  const canAdd = manageableOrgs.length > 0;
  const addButton = canAdd ? (
    <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
      <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      Add monitor
    </Button>
  ) : null;
  const anyRemovable = rows.some(canRemove);

  return (
    <div>
      {canAdd && rows.length > 0 ? <div className="flex justify-end border-b border-border px-5 py-3">{addButton}</div> : null}
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={3} label="Loading monitors" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load certificate monitors" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          className="px-5"
          title="No monitored domains"
          description="Monitor a domain to be warned before its certificate expires or when its issuer has an incident."
          action={addButton}
        />
      ) : (
        <Table caption="Certificate monitors">
          <thead>
            <tr>
              <Th>Domain</Th>
              <Th align="right">Days to expiry</Th>
              <Th className="hidden md:table-cell">Last checked</Th>
              <Th className="hidden lg:table-cell">Current certificate</Th>
              {anyRemovable ? (
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <Tr key={m.id}>
                <Td className="font-mono text-xs">{m.domain}</Td>
                <Td align="right" className={cn("font-mono", expiryTone(m.days_to_expiry))}>
                  {m.days_to_expiry === null ? "—" : `${m.days_to_expiry} days`}
                  {m.days_to_expiry !== null && m.days_to_expiry <= 30 ? <span className="sr-only"> — expiring soon</span> : null}
                </Td>
                <Td className="hidden text-muted-strong md:table-cell">
                  <TimeText iso={m.last_checked_at} />
                </Td>
                <Td className="hidden font-mono text-xs lg:table-cell">
                  {m.current_certificate_id ? (
                    <Link to={`/app/certificates/${m.current_certificate_id}`} className="text-muted-strong underline-offset-4 hover:text-foreground hover:underline">
                      {m.issuer_cn ?? m.current_certificate_id}
                    </Link>
                  ) : (
                    <span className="text-muted">Not checked yet</span>
                  )}
                </Td>
                {anyRemovable ? (
                  <Td align="right">
                    {canRemove(m) ? (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                        Remove<span className="sr-only"> monitor for {m.domain}</span>
                      </Button>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {canAdd ? <AddMonitorDialog open={adding} onOpenChange={setAdding} orgs={manageableOrgs} fixedOrgId={fixedOrgId} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            del.reset();
          }
        }}
        title="Stop monitoring this domain?"
        consequence={removing ? `You will no longer be warned about certificate expiry or issuer incidents for ${removing.domain}.` : undefined}
        confirmLabel="Remove monitor"
        pending={del.isPending}
        error={del.isError ? del.error : null}
        errorTitle="The monitor was not removed"
        onConfirm={() =>
          removing &&
          del.mutate(removing.id, {
            onSuccess: () => {
              toast.success("Monitor removed", removing.domain);
              setRemoving(null);
            },
          })
        }
      />
    </div>
  );
}
