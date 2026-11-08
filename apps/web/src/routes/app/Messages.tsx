import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeverityBadge, SimulatedBadge, VerdictBadge } from "@/components/domain/Badges";
import { ObservedExpected } from "@/components/domain/FindingRow";
import { CoverageMeter } from "@/components/domain/Meters";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Banner, ErrorState } from "@/components/ui/States";
import { messages, RISK_CLASS_LABEL, SAMPLE_MESSAGES, type MessageAnalysis } from "@/lib/api/messages";

const MAX = 20_000;
type Channel = "email" | "sms" | "dm" | "other";

function Result({ a }: { a: MessageAnalysis }) {
  const scored = a.findings.filter((f) => f.severity !== "info");
  return (
    <div className="flex flex-col gap-6">
      <Card title="Assessment">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge decision={a.decision} riskLevel={a.risk_level} size="lg" />
            <span className="text-sm font-medium">{RISK_CLASS_LABEL[a.risk_class] ?? a.risk_class}</span>
            <span className="text-sm text-muted">score {a.risk_score}</span>
            {a.simulated ? <SimulatedBadge /> : null}
          </div>
          {a.caveat ? <p className="text-sm text-muted-strong">{a.caveat}</p> : null}
          {a.overrides.length > 0 ? (
            <p className="text-xs text-muted">
              Decision policy applied: <span className="font-mono">{a.overrides.join(", ")}</span>
              {a.overrides.includes("O-8") ? " (language alone is never treated as proof)" : null}
            </p>
          ) : null}
          {a.reasons.length > 0 ? (
            <ul className="list-disc pl-5 text-sm">
              {a.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <CoverageMeter coverage={a.coverage} />
        </div>
      </Card>

      <Card title="Explanation">
        <div className="flex flex-col gap-4">
          {a.narrative.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-sm font-medium">{s.heading}</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-strong">
                {s.claims.map((c) => (
                  <li key={c.text}>
                    {c.text} {c.refs.length ? <span className="font-mono text-xs text-muted">[{c.refs.join(", ")}]</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-muted">
            Written by the {a.narrative.source === "llm" ? "language model from the findings above (claims without evidence are dropped)" : "deterministic template"}. The decision comes from rules, never from the model.
          </p>
        </div>
      </Card>

      <Card title={`Findings (${scored.length})`}>
        <ul className="flex flex-col gap-4">
          {a.findings.map((f, i) => (
            <li key={f.code} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted">F-{i + 1}</span>
                <SeverityBadge severity={f.severity} />
                <span className="text-sm font-medium">{f.title}</span>
                <span className="font-mono text-xs text-muted">{f.code}</span>
              </div>
              <p className="text-sm text-muted-strong">{f.detail}</p>
              {f.observed || f.expected ? (
                <ObservedExpected observed={f.observed} expected={f.expected} observedLabel="Observed in the message" />
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Links">
        {a.links.length === 0 ? (
          <p className="text-sm text-muted">The message contains no links.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {a.links.map((l, i) => (
              <li key={l.url} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono text-xs text-muted">E-{i + 1}</span>
                <span className="break-all font-mono text-xs">{l.url}</span>
                {l.decision ? <VerdictBadge decision={l.decision} size="sm" /> : <span className="text-xs text-muted">not assessed ({l.error})</span>}
                {l.scan_id ? (
                  <Link to={`/app/scan/${l.scan_id}`} className="underline underline-offset-4">
                    Open the scan report
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Indicators and correlation">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Claimed organisation</dt>
          <dd>{a.claimed_organisation ? `${a.claimed_organisation.name} (verified: ${a.claimed_organisation.verified_domains.join(", ")})` : "none detected"}</dd>
          <dt className="text-muted">Sender domain</dt>
          <dd className="font-mono">{a.indicators.sender_domain ?? "—"}</dd>
          <dt className="text-muted">Payment addresses</dt>
          <dd className="font-mono">{a.indicators.payees.map((p) => p.value).join(", ") || "—"}</dd>
          <dt className="text-muted">Emails (masked)</dt>
          <dd className="font-mono">{a.indicators.emails.join(", ") || "—"}</dd>
          <dt className="text-muted">Phone numbers</dt>
          <dd>{a.indicators.phones.length ? `${a.indicators.phones.length} found (not stored)` : "—"}</dd>
          <dt className="text-muted">Seen before</dt>
          <dd>
            {a.correlation.same_text_count > 0 ? `${a.correlation.same_text_count} earlier analyses of this exact text` : "first time"}
            {a.correlation.shared_link_domains.length
              ? `; link domains seen before: ${a.correlation.shared_link_domains.map((d) => `${String(d.domain)} (${String(d.earlier_analyses)})`).join(", ")}`
              : ""}
          </dd>
        </dl>
      </Card>
    </div>
  );
}

export default function Messages() {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<Channel>("other");
  const [touched, setTouched] = useState(false);
  const analyse = useMutation({ mutationFn: messages.analyse });
  const len = text.length;
  const problem = text.trim().length === 0 ? "Paste the message you received." : len > MAX ? `Keep it under ${MAX.toLocaleString()} characters.` : null;
  const submit = () => {
    setTouched(true);
    if (!problem) analyse.mutate({ text, channel });
  };

  return (
    <>
      <PageHeader
        title="Analyse a message"
        subtitle="Paste a suspicious email, SMS or chat message. We extract its links, payment addresses and requests, check them against verified organisation profiles, and assess every link."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <Card title="Message">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Field label="Message text" required error={touched ? problem : null} counter={{ value: len, max: MAX }} help="Never paste passwords or one-time codes. We store a hash of the text, not the text.">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-xs" spellCheck={false} />
              </Field>
              <Field label="Where you received it">
                <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="dm">Chat / DM</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <div>
                <Button type="submit" variant="primary" loading={analyse.isPending}>
                  Analyse message
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Try a sample (simulated)">
            <div className="flex flex-wrap gap-2">
              {SAMPLE_MESSAGES.map((s) => (
                <Button
                  key={s.label}
                  size="sm"
                  onClick={() => {
                    setText(s.text);
                    setChannel(s.channel);
                    analyse.reset();
                  }}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          {analyse.isPending ? <Banner tone="neutral" title="Analysing">Extracting indicators and assessing each link. This can take a few seconds.</Banner> : null}
          {analyse.isError ? <ErrorState error={analyse.error} title="The message was not analysed" /> : null}
          {analyse.data ? <Result a={analyse.data} /> : null}
          {!analyse.data && !analyse.isPending && !analyse.isError ? (
            <p className="text-sm text-muted">Results appear here. Urgent wording alone never makes a message “malicious”: we need evidence such as a link or payee the organisation does not use.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
