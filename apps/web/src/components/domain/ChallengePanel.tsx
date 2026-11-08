import type { DomainChallenge } from "@/lib/api/types";
import { CopyButton, TimeText } from "./Text";

function Row({ label, value, copyLabel }: { label: string; value: string | undefined; copyLabel: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="flex items-start justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-2">
        <span className="min-w-0 break-all font-mono text-xs">{value}</span>
        <CopyButton value={value} label={copyLabel} className="shrink-0" />
      </dd>
    </div>
  );
}

export interface ChallengePanelProps {
  challenges: DomainChallenge[];
  /** Only show one method (e.g. an appeal created for dns_txt). */
  method?: string;
}

/** ORGANISATION_TRUST_PROFILES.md §4.1 — DNS TXT record and HTTPS file instructions with copy buttons. */
export function ChallengePanel({ challenges, method }: ChallengePanelProps) {
  const list = method ? challenges.filter((c) => c.method === method) : challenges;
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {list.map((c) => (
        <section key={c.method} aria-label={c.method === "dns_txt" ? "DNS TXT record" : "HTTPS file"} className="rounded-md border border-border bg-surface-secondary p-4">
          <h3 className="text-sm font-medium">
            {c.method === "dns_txt" ? "Option 1 · Add a DNS TXT record" : "Option 2 · Publish a file over HTTPS"}
          </h3>
          <p className="mt-1 text-xs text-muted-strong">
            {c.method === "dns_txt"
              ? "Create this record at your DNS provider. Changes can take a few minutes to appear."
              : "Serve this exact text at the address below, over HTTPS with a valid certificate."}
          </p>
          <dl className="mt-3 flex flex-col gap-3">
            {c.method === "dns_txt" ? (
              <>
                <Row label="Record name" value={c.record_name} copyLabel="Copy name" />
                <Row label="Record type" value={c.record_type ?? "TXT"} copyLabel="Copy type" />
                <Row label="Record value" value={c.record_value} copyLabel="Copy value" />
              </>
            ) : (
              <>
                <Row label="File address" value={c.url} copyLabel="Copy address" />
                <Row label="File content" value={c.file_content ?? c.record_value} copyLabel="Copy content" />
              </>
            )}
          </dl>
          {c.expires_at ? (
            <p className="mt-3 text-xs text-muted">
              Valid until <TimeText iso={c.expires_at} mode="absolute" />
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
