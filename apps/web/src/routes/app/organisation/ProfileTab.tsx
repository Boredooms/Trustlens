import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Banner, ErrorState } from "@/components/ui/States";
import { useUpdateOrganisation } from "@/lib/query/hooks";
import { detailList, toApiError } from "@/lib/api/errors";
import type { Organisation, OrganisationUpdateBody } from "@/lib/api/types";
import { ERROR_HINT, LOGIN_HOSTS_MODE_LABEL, SECTORS } from "@/lib/copy";
import { humanise } from "@/lib/format";
import { toast } from "@/stores/toast";
import { LogoCard } from "./LogoCard";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOKENS = 20;

interface Draft {
  name: string;
  legal_name: string;
  country: string;
  sector: string;
  support_email: string;
  brand_tokens: string[];
  login_hosts_mode: string;
}

function toDraft(o: Organisation): Draft {
  return {
    name: o.name,
    legal_name: o.legal_name ?? "",
    country: o.country ?? "",
    sector: o.sector ?? "",
    support_email: o.support_email ?? "",
    brand_tokens: o.brand_tokens ?? [],
    login_hosts_mode: o.login_hosts_mode ?? "domain_wildcard",
  };
}

/** Only fields that changed are sent (PATCH semantics). Cleared optional text fields are not sent. */
export function diffProfile(o: Organisation, d: Draft): OrganisationUpdateBody {
  const body: OrganisationUpdateBody = {};
  const base = toDraft(o);
  if (d.name.trim() !== base.name) body.name = d.name.trim();
  if (d.legal_name.trim() && d.legal_name.trim() !== base.legal_name) body.legal_name = d.legal_name.trim();
  if (d.country.trim() && d.country.trim().toUpperCase() !== base.country.toUpperCase()) body.country = d.country.trim().toUpperCase();
  if (d.sector && d.sector !== base.sector) body.sector = d.sector;
  if (d.support_email.trim() && d.support_email.trim() !== base.support_email) body.support_email = d.support_email.trim();
  if (JSON.stringify(d.brand_tokens) !== JSON.stringify(base.brand_tokens)) body.brand_tokens = d.brand_tokens;
  if (d.login_hosts_mode !== base.login_hosts_mode) body.login_hosts_mode = d.login_hosts_mode;
  return body;
}

function validate(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (d.name.trim().length < 2 || d.name.trim().length > 120) e.name = "The name must be 2–120 characters.";
  if (d.legal_name.trim() && d.legal_name.trim().length < 2) e.legal_name = "The legal name must be at least 2 characters.";
  if (d.country.trim() && !/^[A-Za-z]{2}$/.test(d.country.trim())) e.country = "Use the two-letter country code, for example IN.";
  if (d.support_email.trim() && !EMAIL.test(d.support_email.trim())) e.support_email = "Enter a valid email address.";
  return e;
}

function TokenInput({ tokens, onChange, disabled }: { tokens: string[]; onChange: (t: string[]) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const t = value.trim().toLowerCase();
    if (!t) return;
    if (t.length < 2 || t.length > 40) return setError("Each brand name must be 2–40 characters.");
    if (tokens.includes(t)) return setError("That name is already listed.");
    if (tokens.length >= MAX_TOKENS) return setError(`Up to ${MAX_TOKENS} names.`);
    onChange([...tokens, t]);
    setValue("");
    setError(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !value && tokens.length > 0) {
      onChange(tokens.slice(0, -1));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {tokens.length > 0 ? (
        <ul aria-label="Brand names" className="flex flex-wrap gap-1.5">
          {tokens.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
              {t}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() => onChange(tokens.filter((x) => x !== t))}
                  className="rounded-full p-0.5 text-muted-strong hover:bg-surface-secondary hover:text-foreground"
                >
                  <X aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {disabled ? null : (
        <Field label="Add a brand name" help="Names and aliases people use for the organisation. Press Enter to add." error={error}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} onBlur={add} maxLength={40} />
        </Field>
      )}
    </div>
  );
}

function ReadOnly({ o }: { o: Organisation }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted">Legal name</dt>
      <dd>{o.legal_name ?? "—"}</dd>
      <dt className="text-muted">Country</dt>
      <dd>{o.country ?? "—"}</dd>
      <dt className="text-muted">Sector</dt>
      <dd>{o.sector ? (SECTORS.find(([v]) => v === o.sector)?.[1] ?? humanise(o.sector)) : "—"}</dd>
      <dt className="text-muted">Support email</dt>
      <dd className="break-all font-mono text-xs">{o.support_email ?? "—"}</dd>
      <dt className="text-muted">Login hosts</dt>
      <dd>{o.login_hosts_mode ? (LOGIN_HOSTS_MODE_LABEL[o.login_hosts_mode] ?? o.login_hosts_mode) : "—"}</dd>
      <dt className="text-muted">Brand names</dt>
      <dd className="flex flex-wrap gap-1">
        {(o.brand_tokens ?? []).length === 0
          ? "—"
          : (o.brand_tokens ?? []).map((t) => (
              <span key={t} className="rounded-full border border-border px-2 py-0.5 text-xs">
                {t}
              </span>
            ))}
      </dd>
    </dl>
  );
}

function ProfileForm({ o }: { o: Organisation }) {
  const update = useUpdateOrganisation(o.id);
  const [draft, setDraft] = useState<Draft>(() => toDraft(o));
  const [touched, setTouched] = useState(false);
  const errors = validate(draft);
  const changes = diffProfile(o, draft);
  const dirty = Object.keys(changes).length > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const serverField = (field: string) =>
    update.isError ? detailList(toApiError(update.error)).find((d) => d.field === field)?.issue ?? null : null;
  const fieldError = (k: keyof Draft) => (touched ? errors[k] : null) ?? serverField(k);

  const save = () => {
    setTouched(true);
    if (Object.keys(errors).length > 0 || !dirty) return;
    update.mutate(changes, {
      onSuccess: (next) => {
        toast.success("Profile saved");
        if (next) setDraft(toDraft(next));
        setTouched(false);
      },
    });
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Display name" required error={fieldError("name")}>
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Legal name" error={fieldError("legal_name")}>
          <Input value={draft.legal_name} onChange={(e) => set("legal_name", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Country" help="Two-letter code" error={fieldError("country")}>
          <Input value={draft.country} onChange={(e) => set("country", e.target.value)} maxLength={2} />
        </Field>
        <Field label="Sector" error={fieldError("sector")}>
          <Select value={draft.sector} onChange={(e) => set("sector", e.target.value)}>
            <option value="">Not specified</option>
            {SECTORS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Support email" error={fieldError("support_email")} className="md:col-span-2">
          <Input type="email" value={draft.support_email} onChange={(e) => set("support_email", e.target.value)} />
        </Field>
      </div>
      <TokenInput tokens={draft.brand_tokens} onChange={(t) => set("brand_tokens", t)} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">Approved login hosts</legend>
        <p className="text-xs text-muted">Which hosts may receive passwords for this organisation.</p>
        {Object.entries(LOGIN_HOSTS_MODE_LABEL).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="login_hosts_mode"
              value={v}
              checked={draft.login_hosts_mode === v}
              onChange={() => set("login_hosts_mode", v)}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      {update.isError && !detailList(toApiError(update.error)).some((d) => d.field) ? (
        <ErrorState error={update.error} title="The profile was not saved" compact />
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty}>
          Save changes
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(toDraft(o))} disabled={update.isPending}>
            Discard
          </Button>
        ) : (
          <span className="text-xs text-muted">No unsaved changes</span>
        )}
      </div>
    </form>
  );
}

type StatusAction = { status: string; title: string; consequence: string; label: string; tone: "primary" | "danger"; done: string };

function statusActions(o: Organisation, platformRole: string | null, canManage: boolean): StatusAction[] {
  const out: StatusAction[] = [];
  if (canManage && (o.status === "draft" || (o.status === "suspended" && platformRole === "operator"))) {
    out.push({
      status: "active",
      title: o.status === "draft" ? "Publish this profile?" : "Reactivate this profile?",
      consequence:
        "Verified domains and attested payees become authoritative: lookalike pages that claim this organisation will be blocked or warned against.",
      label: o.status === "draft" ? "Publish profile" : "Reactivate profile",
      tone: "primary",
      done: o.status === "draft" ? "Profile published" : "Profile reactivated",
    });
  }
  if (platformRole === "operator" && o.status === "active") {
    out.push({
      status: "suspended",
      title: "Suspend this profile?",
      consequence:
        "The profile leaves the public projection and new identity checks treat claims of this organisation as unverifiable. Existing scans are unchanged.",
      label: "Suspend profile",
      tone: "danger",
      done: "Profile suspended",
    });
  }
  return out;
}

export function ProfileTab({ o, canManage, platformRole }: { o: Organisation; canManage: boolean; platformRole: string | null }) {
  const update = useUpdateOrganisation(o.id);
  const [pending, setPending] = useState<StatusAction | null>(null);
  const actions = statusActions(o, platformRole, canManage);
  const verified = (o.domains ?? []).filter((d) => d.status === "verified").length;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <Card title="Profile" className="xl:col-span-8">
        {canManage ? <ProfileForm key={o.updated_at ?? o.id} o={o} /> : <ReadOnly o={o} />}
        {!canManage ? (
          <p className="mt-4 text-xs text-muted">Only organisation administrators can change the profile.</p>
        ) : null}
      </Card>
      <Card title="Publication" className="xl:col-span-4">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-strong">
            {o.status === "draft"
              ? "Draft profiles are not used for identity checks. Publish once at least one domain is verified."
              : o.status === "active"
                ? "This profile is published. Identity and payment checks use its verified domains and payees."
                : "This profile is suspended and excluded from identity checks."}
          </p>
          <p className="text-xs text-muted">
            Verified domains: <span className="font-mono text-foreground">{o.domains ? verified : "—"}</span>
          </p>
          {o.status === "draft" && o.domains && verified === 0 ? (
            <Banner tone="neutral" title="Verify a domain first">
              {ERROR_HINT.NO_VERIFIED_DOMAIN}
            </Banner>
          ) : null}
          {actions.map((a) => (
            <Button key={a.status} variant={a.tone === "danger" ? "secondary" : "primary"} onClick={() => setPending(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      </Card>
      <div className="xl:col-span-8">
        <LogoCard o={o} canManage={canManage} />
      </div>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            update.reset();
          }
        }}
        title={pending?.title ?? ""}
        consequence={pending?.consequence}
        confirmLabel={pending?.label ?? "Confirm"}
        tone={pending?.tone ?? "primary"}
        pending={update.isPending}
        error={update.isError ? update.error : null}
        errorTitle="The status did not change"
        onConfirm={() => {
          if (!pending) return;
          const a = pending;
          update.mutate(
            { status: a.status },
            {
              onSuccess: () => {
                toast.success(a.done);
                setPending(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
