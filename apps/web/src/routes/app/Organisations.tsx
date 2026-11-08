import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/domain/Badges";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCreateOrganisation, useOrganisations, useRole } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import { detailList, toApiError } from "@/lib/api/errors";
import type { OrganisationCreateBody } from "@/lib/api/types";
import { ORG_ROLE_LABEL, SECTORS } from "@/lib/copy";
import { toast } from "@/stores/toast";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
  name: string;
  legal_name: string;
  country: string;
  sector: string;
  support_email: string;
}

const EMPTY: Draft = { name: "", legal_name: "", country: "", sector: "", support_email: "" };

export function validateOrganisation(d: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const name = d.name.trim();
  if (name.length < 2) errors.name = "Enter the organisation name (at least 2 characters).";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
  if (d.legal_name.trim().length > 200) errors.legal_name = "Keep the legal name under 200 characters.";
  if (d.country.trim() && !/^[A-Za-z]{2}$/.test(d.country.trim())) errors.country = "Use the two-letter country code, for example IN.";
  if (d.support_email.trim() && !EMAIL.test(d.support_email.trim())) errors.support_email = "Enter a valid email address.";
  return errors;
}

function CreateOrganisationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateOrganisation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);
  const errors = validateOrganisation(draft);
  const serverField = (field: string) =>
    create.isError ? detailList(toApiError(create.error)).find((d) => d.field === field)?.issue ?? null : null;
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      create.reset();
      setDraft(EMPTY);
      setTouched(false);
    }
  };

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const body: OrganisationCreateBody = { name: draft.name.trim() };
    if (draft.legal_name.trim()) body.legal_name = draft.legal_name.trim();
    if (draft.country.trim()) body.country = draft.country.trim().toUpperCase();
    if (draft.sector) body.sector = draft.sector;
    if (draft.support_email.trim()) body.support_email = draft.support_email.trim();
    create.mutate(body, {
      onSuccess: (org) => {
        toast.success("Organisation created", "It stays a draft until a domain is verified and you publish it.");
        close(false);
        if (org?.id) navigate(`/app/organisations/${org.id}?tab=domains`);
      },
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!create.isPending}
      title="Create organisation"
      description="Self-declared details are evidence, not authority. Verified domains and attested payees are what TrustLens enforces."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Create organisation
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
        <Field label="Display name" required error={(touched ? errors.name : null) ?? serverField("name")}>
          <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} maxLength={120} autoComplete="organization" />
        </Field>
        <Field label="Legal name" error={(touched ? errors.legal_name : null) ?? serverField("legal_name")}>
          <Input value={draft.legal_name} onChange={(e) => set("legal_name")(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Country" help="Two-letter code" error={(touched ? errors.country : null) ?? serverField("country")}>
            <Input value={draft.country} onChange={(e) => set("country")(e.target.value)} maxLength={2} autoComplete="country" />
          </Field>
          <Field
            label="Sector"
            help={draft.sector === "fintech" ? "Financial profiles need operator review before they can be published." : undefined}
            error={serverField("sector")}
          >
            <Select value={draft.sector} onChange={(e) => set("sector")(e.target.value)}>
              <option value="">Not specified</option>
              {SECTORS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Support email" error={(touched ? errors.support_email : null) ?? serverField("support_email")}>
          <Input
            type="email"
            value={draft.support_email}
            onChange={(e) => set("support_email")(e.target.value)}
            autoComplete="email"
          />
        </Field>
        {create.isError && !detailList(toApiError(create.error)).some((d) => d.field) ? (
          <ErrorState error={create.error} title="The organisation was not created" compact />
        ) : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default function Organisations() {
  const q = useOrganisations();
  const role = useRole();
  const rows = listData(q.data);
  const [creating, setCreating] = useState(false);
  const createButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus aria-hidden className="h-4 w-4" strokeWidth={1.5} />
      Create organisation
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Organisations"
        subtitle="Verified trust profiles: the domains and payment recipients an organisation has proven it controls."
        actions={role ? createButton : null}
      />
      <section aria-label="Organisation list" className="rounded-md border border-border bg-surface">
        {q.isPending ? (
          <div className="p-5">
            <SkeletonRows rows={3} label="Loading organisations" />
          </div>
        ) : q.isError ? (
          <ErrorState className="m-5" error={q.error} title="We could not load organisations" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : rows.length === 0 ? (
          <EmptyState
            className="px-5"
            title="You are not a member of any organisation"
            description="Create a profile for your organisation, then prove control of its domains so TrustLens can tell real pages from lookalikes."
            action={createButton}
          />
        ) : (
          <Table caption="Organisations">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Verified domains
                </Th>
                <Th align="right" className="hidden lg:table-cell">
                  Members
                </Th>
                <Th className="hidden md:table-cell">Your role</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <Link to={`/app/organisations/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill status={o.status} />
                  </Td>
                  <Td align="right" className="hidden font-mono sm:table-cell">
                    {o.verified_domains_count ?? "—"}
                  </Td>
                  <Td align="right" className="hidden font-mono lg:table-cell">
                    {o.members_count ?? "—"}
                  </Td>
                  <Td className="hidden text-muted-strong md:table-cell">{o.role ? (ORG_ROLE_LABEL[o.role] ?? o.role) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <CreateOrganisationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
