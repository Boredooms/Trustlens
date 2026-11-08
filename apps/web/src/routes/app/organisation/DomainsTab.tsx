import { useState } from "react";
import { Plus } from "lucide-react";
import { StatusPill } from "@/components/domain/Badges";
import { ChallengePanel } from "@/components/domain/ChallengePanel";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useAddDomain, useDomainChallenge, useOrgDomains, useRemoveDomain, useVerifyDomain } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { detailList, toApiError } from "@/lib/api/errors";
import type { DomainChallenge, OrgDomain } from "@/lib/api/types";
import { DOMAIN_KIND_LABEL } from "@/lib/copy";
import { normaliseDomainInput } from "@/lib/validation/domain";
import { toast } from "@/stores/toast";

const KINDS = ["official", "login", "application", "payment"] as const;

function DomainKindLabel({ kind }: { kind: string }) {
  return <>{DOMAIN_KIND_LABEL[kind] ?? kind}</>;
}

function AddDomainDialog({ orgId, open, onOpenChange, onAdded }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void; onAdded: (d: OrgDomain) => void }) {
  const add = useAddDomain(orgId);
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<string>("official");
  const [touched, setTouched] = useState(false);
  const norm = normaliseDomainInput(domain);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      add.reset();
      setDomain("");
      setKind("official");
      setTouched(false);
    }
  };
  const submit = () => {
    setTouched(true);
    if (norm.error) return;
    add.mutate(
      { domain: norm.value, kind },
      {
        onSuccess: (d) => {
          toast.success("Domain added", "Publish the challenge, then run the check.");
          close(false);
          if (d) onAdded(d);
        },
      },
    );
  };
  const serverIssue = add.isError ? detailList(toApiError(add.error)).find((d) => d.field === "domain")?.issue ?? null : null;
  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!add.isPending}
      title="Add a domain"
      description="You will prove control with a DNS TXT record or a file served over HTTPS. Nothing is trusted until the check passes."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={submit}>
            Add domain
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
        <Field
          label="Domain"
          required
          help={norm.value && !norm.error && norm.value !== domain.trim() ? `Will be saved as ${norm.value}` : "No scheme or path, for example northstar-demo.example."}
          error={(touched ? norm.error : null) ?? serverIssue}
        >
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="off" spellCheck={false} inputMode="url" />
        </Field>
        <Field label="What this domain is for">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {DOMAIN_KIND_LABEL[k] ?? k}
              </option>
            ))}
          </Select>
        </Field>
        {add.isError && !serverIssue ? <ErrorState error={add.error} title="The domain was not added" compact /> : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

function observedValue(e: unknown): string | null {
  const d = detailList(toApiError(e)).find((x) => typeof x.observed === "string" || typeof x.observed_value === "string");
  if (!d) return null;
  return String(d.observed ?? d.observed_value);
}

function VerifyDialog({ orgId, domain, onClose }: { orgId: string; domain: OrgDomain | null; onClose: () => void }) {
  const verify = useVerifyDomain(orgId);
  const reissue = useAddDomain(orgId);
  const cached = useDomainChallenge(orgId, domain?.id ?? "");
  const [fresh, setFresh] = useState<DomainChallenge[] | null>(null);
  const challenges = fresh ?? cached ?? domain?.challenges ?? null;
  const [method, setMethod] = useState<"dns_txt" | "http_file">("dns_txt");
  const close = () => {
    verify.reset();
    reissue.reset();
    setFresh(null);
    onClose();
  };
  const observed = verify.isError ? observedValue(verify.error) : null;
  return (
    <Modal
      open={domain !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      dismissable={!verify.isPending}
      title={domain ? `Verify ${domain.domain}` : "Verify domain"}
      description="Publish one of the challenges, then run the check. Each check counts as an attempt; at most 5 per hour."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={verify.isPending}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={verify.isPending}
            onClick={() =>
              domain &&
              verify.mutate(
                { domainId: domain.id, method },
                {
                  onSuccess: () => {
                    toast.success("Domain verified", `${domain.domain} is now authoritative for this organisation.`);
                    close();
                  },
                },
              )
            }
          >
            Verify now
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {challenges && challenges.length > 0 ? (
          <ChallengePanel challenges={challenges} />
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-4 text-sm">
            <p className="font-medium">The challenge value is shown only once</p>
            <p className="text-muted-strong">
              If you already published it, run the check. Otherwise get a new challenge; the previous value stops working.
            </p>
          </div>
        )}
        <div>
          <Button
            size="sm"
            loading={reissue.isPending}
            onClick={() =>
              domain &&
              reissue.mutate(
                { domain: domain.domain, kind: domain.kind },
                {
                  onSuccess: (d) => {
                    setFresh(d?.challenges ?? null);
                    verify.reset();
                    toast.info("New challenge issued", "The previous value no longer works.");
                  },
                },
              )
            }
          >
            Get a new challenge
          </Button>
          {reissue.isError ? <ErrorState className="mt-3" error={reissue.error} title="No new challenge was issued" compact /> : null}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium">Check using</legend>
          {(
            [
              ["dns_txt", "DNS TXT record"],
              ["http_file", "HTTPS file"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" name="verify-method" value={v} checked={method === v} onChange={() => setMethod(v)} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </fieldset>
        {verify.isError ? (
          <div className="flex flex-col gap-2">
            <ErrorState error={verify.error} title="The domain is not verified yet" compact />
            {observed ? (
              <p className="text-xs text-muted-strong">
                We saw <span className="break-all font-mono text-foreground">{observed}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function DomainsTab({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const q = useOrgDomains(orgId);
  const remove = useRemoveDomain(orgId);
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState<OrgDomain | null>(null);
  const [removing, setRemoving] = useState<OrgDomain | null>(null);
  const rows = listData(q.data);
  const addButton = canManage ? (
    <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
      <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      Add domain
    </Button>
  ) : null;

  return (
    <Card title="Domains" actions={addButton} bodyClassName="p-0">
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={3} label="Loading domains" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load domains" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          className="px-5"
          title="No domains claimed"
          description="Add the domains this organisation uses and prove control with a DNS TXT record or a file over HTTPS."
          action={addButton}
        />
      ) : (
        <Table caption="Domains">
          <thead>
            <tr>
              <Th>Domain</Th>
              <Th className="hidden sm:table-cell">Kind</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Verified</Th>
              <Th className="hidden lg:table-cell">Expires</Th>
              {canManage ? (
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <Tr key={d.id}>
                <Td className="break-all font-mono text-xs">{d.domain}</Td>
                <Td className="hidden text-muted-strong sm:table-cell">
                  <DomainKindLabel kind={d.kind} />
                </Td>
                <Td>
                  <StatusPill status={d.status} />
                </Td>
                <Td className="hidden text-muted-strong md:table-cell">
                  <TimeText iso={d.verified_at} />
                </Td>
                <Td className="hidden text-muted-strong lg:table-cell">
                  <TimeText iso={d.expires_at} />
                </Td>
                {canManage ? (
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {d.status !== "revoked" ? (
                        <Button size="sm" variant="ghost" onClick={() => setVerifying(d)}>
                          {d.status === "verified" ? "Re-verify" : "Verify"}
                          <span className="sr-only"> {d.domain}</span>
                        </Button>
                      ) : null}
                      {d.status !== "revoked" ? (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>
                          Remove<span className="sr-only"> {d.domain}</span>
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {canManage ? <AddDomainDialog orgId={orgId} open={adding} onOpenChange={setAdding} onAdded={(d) => setVerifying(d)} /> : null}
      <VerifyDialog orgId={orgId} domain={verifying} onClose={() => setVerifying(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title="Remove this domain?"
        consequence={
          removing
            ? `${removing.domain} stops being authoritative immediately. Pages on it will no longer count as this organisation, and if it was the last verified domain the profile returns to draft.`
            : undefined
        }
        typedConfirmation={removing?.domain}
        confirmLabel="Remove domain"
        pending={remove.isPending}
        error={remove.isError ? remove.error : null}
        errorTitle="The domain was not removed"
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success("Domain removed", removing.domain);
              setRemoving(null);
            },
          })
        }
      />
    </Card>
  );
}
