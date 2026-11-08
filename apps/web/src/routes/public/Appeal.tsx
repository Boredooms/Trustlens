import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { ChallengePanel } from "@/components/domain/ChallengePanel";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Banner, ErrorState } from "@/components/ui/States";
import { useCreateAppeal, useVerifyAppeal } from "@/lib/query/hooks";
import { detailList, toApiError } from "@/lib/api/errors";
import type { AppealChallenge, AppealCreated, DomainChallenge } from "@/lib/api/types";
import { normaliseDomainInput } from "@/lib/validation/domain";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MSG_MIN = 10;
const MSG_MAX = 2000;

/** The appeal API names the HTTPS file's URL `record_name` and its body `record_value`. */
export function toDomainChallenge(c: AppealChallenge): DomainChallenge {
  if (c.method === "http_file") return { method: c.method, url: c.record_name, file_content: c.record_value, expires_at: c.expires_at ?? null };
  return { method: c.method, record_name: c.record_name, record_type: c.record_type ?? "TXT", record_value: c.record_value, expires_at: c.expires_at ?? null };
}

function AppealForm({ onCreated }: { onCreated: (a: AppealCreated, domain: string) => void }) {
  const [params] = useSearchParams();
  const create = useCreateAppeal();
  const [domain, setDomain] = useState(params.get("domain") ?? "");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<"dns_txt" | "http_file">("dns_txt");
  const [touched, setTouched] = useState(false);
  const norm = normaliseDomainInput(domain);
  const len = message.trim().length;
  const errors = {
    domain: norm.error,
    email: EMAIL.test(email.trim()) ? null : "Enter an email address at the domain if you can; we use it only about this appeal.",
    message: len < MSG_MIN ? `Explain in at least ${MSG_MIN} characters.` : len > MSG_MAX ? `Keep it under ${MSG_MAX} characters.` : null,
  };
  const server = (f: string) => (create.isError ? detailList(toApiError(create.error)).find((d) => d.field === f)?.issue ?? null : null);
  const submit = () => {
    setTouched(true);
    if (errors.domain || errors.email || errors.message) return;
    create.mutate(
      { domain: norm.value, email: email.trim(), message: message.trim(), challenge_method: method },
      { onSuccess: (a) => onCreated(a, norm.value) },
    );
  };
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Your domain" required help="The site TrustLens flagged, for example northstar-demo.example." error={(touched ? errors.domain : null) ?? server("domain")}>
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="url" spellCheck={false} />
      </Field>
      <Field label="Email" required error={(touched ? errors.email : null) ?? server("email")}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="What is wrong with the decision?" required counter={{ value: len, max: MSG_MAX }} error={(touched ? errors.message : null) ?? server("message")}>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">How you will prove you control the domain</legend>
        {(
          [
            ["dns_txt", "Add a DNS TXT record"],
            ["http_file", "Publish a file over HTTPS"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input type="radio" name="challenge_method" value={v} checked={method === v} onChange={() => setMethod(v)} className="h-4 w-4" />
            {label}
          </label>
        ))}
      </fieldset>
      {create.isError && !detailList(toApiError(create.error)).some((d) => d.field) ? (
        <ErrorState error={create.error} title="The appeal was not submitted" compact />
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Submit appeal
        </Button>
      </div>
    </form>
  );
}

function ChallengeStep({ appeal, domain }: { appeal: AppealCreated; domain: string }) {
  const verify = useVerifyAppeal();
  const result = verify.data;
  const verified = result?.verified || result?.status === "challenge_verified";
  return (
    <div className="flex flex-col gap-5">
      <Banner tone="neutral" title="Appeal received">
        Reference <span className="font-mono">{appeal.appeal_id}</span>. Prove you control <span className="font-mono">{domain}</span>, then run the check.
        The decision about your site does not change until an analyst reviews the appeal.
      </Banner>
      {appeal.challenge.instructions ? <p className="text-sm text-muted-strong">{appeal.challenge.instructions}</p> : null}
      <ChallengePanel challenges={[toDomainChallenge(appeal.challenge)]} />
      {verified ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-success p-4 text-sm">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.5} />
          <div>
            <p className="font-medium">Control of {domain} confirmed</p>
            <p className="mt-1 text-muted-strong">
              An analyst will review your appeal. If it is approved, the site’s reputation is reset and open reports against it are dismissed.
              You can remove the record or file after the review.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {result && !result.verified ? (
            <Banner title="Not confirmed yet">
              {result.message} <span className="text-muted">Attempts so far: {result.attempts}.</span>
            </Banner>
          ) : null}
          {verify.isError ? <ErrorState error={verify.error} title="The check did not run" compact /> : null}
          <div>
            <Button variant="primary" loading={verify.isPending} onClick={() => verify.mutate(appeal.appeal_id)}>
              Check now
            </Button>
          </div>
          <p className="text-xs text-muted">DNS changes can take a few minutes to appear. Keep this page open, or note the reference above.</p>
        </div>
      )}
    </div>
  );
}

/** Public `/appeal` (USER_JOURNEYS.md J10): no account needed. Appeals never auto-clear a block (BR-006). */
export function Appeal() {
  const [created, setCreated] = useState<{ appeal: AppealCreated; domain: string } | null>(null);
  useEffect(() => {
    document.title = "Appeal a decision · TrustLens";
  }, []);
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Appeal a decision about your site</h1>
        <p className="mt-2 text-sm text-muted-strong">
          If TrustLens warned people away from a site you run, prove you control the domain and tell us why the decision is wrong. An analyst reviews
          every appeal; nothing changes automatically.
        </p>
      </div>
      {created ? <ChallengeStep appeal={created.appeal} domain={created.domain} /> : <AppealForm onCreated={(appeal, domain) => setCreated({ appeal, domain })} />}
    </div>
  );
}
