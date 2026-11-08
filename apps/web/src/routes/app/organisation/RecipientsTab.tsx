import { useState } from "react";
import { Plus } from "lucide-react";
import { StatusPill } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useAddRecipient, useOrgRecipients, useRemoveRecipient, useVerifyRecipient } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { detailList, toApiError } from "@/lib/api/errors";
import type { OrgRecipient } from "@/lib/api/types";
import { RECIPIENT_TYPE_LABEL } from "@/lib/copy";
import { toast } from "@/stores/toast";

const TYPES = ["upi_vpa", "iban", "bank_account", "wallet_address", "payment_link"] as const;

const PLACEHOLDER: Record<string, string> = {
  upi_vpa: "fees@northstar-demo",
  iban: "GB82 WEST 1234 5698 7654 32",
  bank_account: "1234 5678 9012",
  wallet_address: "0x…",
  payment_link: "https://pay.example.com/northstar",
};

/** Live preview mirroring API_CONTRACTS.md §13 normalisation. The server stays authoritative. */
export function previewRecipient(type: string, raw: string): { value: string; error: string | null } {
  const v = raw.trim();
  if (!v) return { value: "", error: null };
  switch (type) {
    case "upi_vpa":
      return /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z-]{1,31}$/.test(v)
        ? { value: v.toLowerCase(), error: null }
        : { value: v.toLowerCase(), error: "A UPI ID looks like name@bank." };
    case "iban": {
      const c = v.replace(/\s+/g, "").toUpperCase();
      return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(c) ? { value: c, error: null } : { value: c, error: "An IBAN starts with a country code and two check digits." };
    }
    case "bank_account": {
      const c = v.replace(/[\s-]/g, "").toUpperCase();
      return /^[A-Z0-9]{6,34}$/.test(c) ? { value: c, error: null } : { value: c, error: "Use 6–34 letters and digits." };
    }
    case "wallet_address":
      return /^[A-Za-z0-9]{20,100}$/.test(v) ? { value: v, error: null } : { value: v, error: "Use the full address without spaces." };
    case "payment_link":
      return v.toLowerCase().startsWith("https://") ? { value: v.toLowerCase(), error: null } : { value: v, error: "Payment links must start with https://." };
    default:
      return { value: v, error: null };
  }
}

function AddRecipientDialog({ orgId, open, onOpenChange }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const add = useAddRecipient(orgId);
  const [type, setType] = useState<string>("upi_vpa");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [touched, setTouched] = useState(false);
  const preview = previewRecipient(type, value);
  const emptyError = !value.trim() ? "Enter the payment address." : null;
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      add.reset();
      setValue("");
      setLabel("");
      setTouched(false);
    }
  };
  const submit = () => {
    setTouched(true);
    if (emptyError || preview.error) return;
    add.mutate(
      { recipient_type: type, value: value.trim(), ...(label.trim() ? { label: label.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success("Payment recipient added", "It counts once an analyst attests it.");
          close(false);
        },
      },
    );
  };
  const serverIssue = add.isError ? detailList(toApiError(add.error)).find((d) => d.field === "value")?.issue ?? null : null;
  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!add.isPending}
      title="Add a payment recipient"
      description="New recipients start as pending attestation. Payee checks only use attested recipients."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={submit}>
            Add recipient
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
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {RECIPIENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Payment address"
          required
          help={preview.value && !preview.error ? <>Will be stored as <span className="font-mono">{preview.value}</span></> : undefined}
          error={(touched ? (emptyError ?? preview.error) : null) ?? serverIssue}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={PLACEHOLDER[type]} autoComplete="off" spellCheck={false} maxLength={200} />
        </Field>
        <Field label="Label" help="Where this address is used, for example Tuition fees.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        </Field>
        {add.isError && !serverIssue ? <ErrorState error={add.error} title="The recipient was not added" compact /> : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

function AttestDialog({ orgId, recipient, onClose }: { orgId: string; recipient: OrgRecipient | null; onClose: () => void }) {
  const verify = useVerifyRecipient(orgId);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [touched, setTouched] = useState(false);
  const len = reason.trim().length;
  const reasonError = len < 10 ? "Explain how you confirmed it in at least 10 characters." : len > 500 ? "Keep it under 500 characters." : null;
  const close = () => {
    verify.reset();
    setReason("");
    setEvidence("");
    setTouched(false);
    onClose();
  };
  const act = (action: "verify" | "reject") => {
    setTouched(true);
    if (reasonError || !recipient) return;
    verify.mutate(
      { recipientId: recipient.id, body: { action, reason: reason.trim(), ...(evidence.trim() ? { evidence_ref: evidence.trim() } : {}) } },
      {
        onSuccess: () => {
          toast.success(action === "verify" ? "Recipient attested" : "Recipient rejected", recipient.handle);
          close();
        },
      },
    );
  };
  return (
    <Modal
      open={recipient !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      dismissable={!verify.isPending}
      title="Attest payment recipient"
      description={
        recipient ? (
          <>
            Confirm <span className="font-mono">{recipient.handle}</span> belongs to this organisation, using a source outside this form (a signed letter, a call to a known number). Your identity is recorded.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={verify.isPending}>
            Cancel
          </Button>
          <Button onClick={() => act("reject")} disabled={verify.isPending}>
            Reject
          </Button>
          <Button variant="primary" loading={verify.isPending} onClick={() => act("verify")}>
            Attest
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" required counter={{ value: len, max: 500 }} error={touched ? reasonError : null}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Evidence reference" help="Optional: ticket or document reference.">
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={200} />
        </Field>
        {verify.isError ? <ErrorState error={verify.error} title="The attestation was not recorded" compact /> : null}
      </div>
    </Modal>
  );
}

export function RecipientsTab({ orgId, canManage, canAttest }: { orgId: string; canManage: boolean; canAttest: boolean }) {
  const q = useOrgRecipients(orgId);
  const remove = useRemoveRecipient(orgId);
  const [adding, setAdding] = useState(false);
  const [attesting, setAttesting] = useState<OrgRecipient | null>(null);
  const [removing, setRemoving] = useState<OrgRecipient | null>(null);
  const rows = listData(q.data);
  const showActions = canManage || canAttest;
  const addButton = canManage ? (
    <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
      <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      Add recipient
    </Button>
  ) : null;

  return (
    <Card title="Payment recipients" actions={addButton} bodyClassName="p-0">
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={2} label="Loading recipients" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load payment recipients" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          className="px-5"
          title="No payment recipients registered"
          description="Without registered recipients, payee checks for this organisation return “could not verify”, never a block."
          action={addButton}
        />
      ) : (
        <Table caption="Payment recipients">
          <thead>
            <tr>
              <Th>Handle</Th>
              <Th className="hidden sm:table-cell">Type</Th>
              <Th className="hidden md:table-cell">Label</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">Verified</Th>
              {showActions ? (
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="break-all font-mono text-xs">{r.handle}</Td>
                <Td className="hidden text-muted-strong sm:table-cell">{RECIPIENT_TYPE_LABEL[r.type] ?? r.type}</Td>
                <Td className="hidden text-muted-strong md:table-cell">{r.label ?? "—"}</Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
                <Td className="hidden text-muted-strong lg:table-cell">
                  <TimeText iso={r.verified_at} />
                </Td>
                {showActions ? (
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {canAttest && r.status === "pending_attestation" ? (
                        <Button size="sm" variant="ghost" onClick={() => setAttesting(r)}>
                          Attest<span className="sr-only"> {r.handle}</span>
                        </Button>
                      ) : null}
                      {canManage && r.status !== "revoked" ? (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
                          Remove<span className="sr-only"> {r.handle}</span>
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
      {canManage ? <AddRecipientDialog orgId={orgId} open={adding} onOpenChange={setAdding} /> : null}
      <AttestDialog orgId={orgId} recipient={attesting} onClose={() => setAttesting(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title="Revoke this payment recipient?"
        consequence={
          removing
            ? `From the next check, pages asking for payment to ${removing.handle} are treated as an unregistered payee for this organisation.`
            : undefined
        }
        confirmLabel="Revoke recipient"
        pending={remove.isPending}
        error={remove.isError ? remove.error : null}
        errorTitle="The recipient was not revoked"
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success("Payment recipient revoked", removing.handle);
              setRemoving(null);
            },
          })
        }
      />
    </Card>
  );
}
