/**
 * Messages — scam analysis console. Panels and the states each owns:
 *   Console        input (validation, counter, channel, samples) · analysing (sweep) · error (retry)
 *   Read-back      the pasted text with SERVER-extracted indicators marked (after analysis)
 *   Verdict        decision, risk class, score ring, O-8 policy note, caveat, coverage
 *   Findings       engine findings with observed vs expected
 *   Links          each link's own scan decision, with a route to its report
 *   Indicators     claimed organisation, sender domain, payees, masked emails, correlation
 *   Explanation    narrative (model or template, labelled)
 * Urgent wording alone is never proof (O-8); the decision always comes from the rules engine.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { FileSearch, Fingerprint, Link2, ListTree, MessageSquareWarning, ScrollText, Send, ShieldQuestion } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeverityBadge, SimulatedBadge, VerdictBadge } from "@/components/domain/Badges";
import { ObservedExpected } from "@/components/domain/FindingRow";
import { CoverageMeter } from "@/components/domain/Meters";
import { RiskScoreRing } from "@/components/domain/RiskScoreRing";
import { IndicatorHighlights, type Indicator } from "@/components/domain/IndicatorHighlights";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { messages, RISK_CLASS_LABEL, SAMPLE_MESSAGES, type MessageAnalysis } from "@/lib/api/messages";
import { cn } from "@/lib/utils/cn";

const MAX = 20_000;
type Channel = "email" | "sms" | "dm" | "other";

function indicatorsOf(a: MessageAnalysis): Indicator[] {
  const out: Indicator[] = [];
  for (const u of a.indicators.urls) out.push({ value: u, kind: "url" });
  for (const l of a.links) out.push({ value: l.url, kind: "url" });
  for (const p of a.indicators.payees) if (p.value) out.push({ value: p.value, kind: "payee" });
  if (a.indicators.sender_domain) out.push({ value: a.indicators.sender_domain, kind: "domain" });
  return out.filter((i) => i.value);
}

function VerdictHero({ a }: { a: MessageAnalysis }) {
  return (
    <section aria-label="Assessment" className="mesh-panel rounded-xl border border-border p-6 shadow-raised">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="label-eyebrow">Message decision</p>
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge decision={a.decision} riskLevel={a.risk_level} size="lg" />
            {a.simulated ? <SimulatedBadge /> : null}
          </div>
          <p className="font-display text-4xl leading-none">{RISK_CLASS_LABEL[a.risk_class] ?? a.risk_class}</p>
          {a.caveat ? <p className="max-w-prose text-sm text-muted-strong">{a.caveat}</p> : null}
          {a.overrides.length > 0 ? (
            <p className="text-xs text-muted">
              Decision policy applied: <span className="font-mono">{a.overrides.join(", ")}</span>
              {a.overrides.includes("O-8") ? " (language alone is never treated as proof)" : null}
            </p>
          ) : null}
          {a.reasons.length > 0 ? (
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm marker:font-mono marker:text-muted">
              {a.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 md:w-56 md:items-end">
          <RiskScoreRing score={a.risk_score} decision={a.decision} riskLevel={a.risk_level} />
          <CoverageMeter coverage={a.coverage} className="w-full" />
        </div>
      </div>
    </section>
  );
}

function Result({ a, text }: { a: MessageAnalysis; text: string }) {
  const scored = a.findings.filter((f) => f.severity !== "info");
  const indicators = indicatorsOf(a);
  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem index={0}>
        <VerdictHero a={a} />
      </StaggerItem>

      {text ? (
        <StaggerItem index={1}>
          <Card title="Read-back" description="Your message with the indicators the analysis extracted marked." icon={Fingerprint}>
            <IndicatorHighlights text={text} indicators={indicators} className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 scroll-thin" />
            <p className="mt-3 flex flex-wrap gap-3 text-2xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="indicator-mark" data-kind="url">link</span> link / domain
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="indicator-mark" data-kind="payee">payee</span> payment address
              </span>
            </p>
          </Card>
        </StaggerItem>
      ) : null}

      <StaggerItem index={2}>
        <Card title={`Findings (${scored.length})`} icon={ListTree} description="What the rules found in the message itself.">
          {a.findings.length === 0 ? (
            <EmptyState title="No finding" description="Nothing in the message matched a rule. That is not a guarantee — see coverage." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {a.findings.map((f, i) => (
                <li key={f.code} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">F-{i + 1}</span>
                    <SeverityBadge severity={f.severity} />
                    <span className="text-sm font-medium">{f.title}</span>
                    <span className="font-mono text-xs text-muted">{f.code}</span>
                  </div>
                  <p className="text-sm text-muted-strong">{f.detail}</p>
                  {f.observed || f.expected ? <ObservedExpected observed={f.observed} expected={f.expected} observedLabel="Observed in the message" /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </StaggerItem>

      <StaggerItem index={3}>
        <Card title="Links" icon={Link2} description="Every link is assessed by the full scan pipeline." bodyClassName="p-0">
          {a.links.length === 0 ? (
            <div className="p-5">
              <EmptyState title="The message contains no links" />
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Links in the message</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-medium">Ref</th>
                  <th scope="col" className="py-2 font-medium">Address</th>
                  <th scope="col" className="py-2 font-medium">Decision</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Report</th>
                </tr>
              </thead>
              <tbody>
                {a.links.map((l, i) => (
                  <tr key={l.url} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">E-{i + 1}</td>
                    <td className="max-w-0 py-2.5">
                      <span className="block truncate font-mono text-xs" title={l.url}>
                        {l.url}
                      </span>
                    </td>
                    <td className="py-2.5">{l.decision ? <VerdictBadge decision={l.decision} size="sm" /> : <span className="text-xs text-muted">not assessed ({l.error})</span>}</td>
                    <td className="px-5 py-2.5 text-right">
                      {l.scan_id ? (
                        <Link to={`/app/scan/${l.scan_id}`} className="text-xs underline underline-offset-4">
                          Open the scan report
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </StaggerItem>

      <StaggerItem index={4}>
        <Card title="Indicators and correlation" icon={FileSearch} description="Extracted values (emails masked, phone numbers never stored).">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {(
              [
                ["Claimed organisation", a.claimed_organisation ? `${a.claimed_organisation.name} (verified: ${a.claimed_organisation.verified_domains.join(", ")})` : "none detected"],
                ["Sender domain", a.indicators.sender_domain ?? "—"],
                ["Payment addresses", a.indicators.payees.map((p) => p.value).join(", ") || "—"],
                ["Emails (masked)", a.indicators.emails.join(", ") || "—"],
                ["Phone numbers", a.indicators.phones.length ? `${a.indicators.phones.length} found (not stored)` : "—"],
                [
                  "Seen before",
                  `${a.correlation.same_text_count > 0 ? `${a.correlation.same_text_count} earlier analyses of this exact text` : "first time"}${
                    a.correlation.shared_link_domains.length
                      ? `; link domains seen before: ${a.correlation.shared_link_domains.map((d) => `${String(d.domain)} (${String(d.earlier_analyses)})`).join(", ")}`
                      : ""
                  }`,
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-md border border-border bg-surface-secondary px-3 py-2">
                <dt className="label-eyebrow text-2xs">{k}</dt>
                <dd className="mt-1 break-words font-mono text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </StaggerItem>

      <StaggerItem index={5}>
        <Card title="Explanation" icon={ScrollText}>
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
      </StaggerItem>
    </Stagger>
  );
}

function Analysing() {
  return (
    <div role="status" aria-label="Analysing" className="flex flex-col gap-4">
      <div className="mesh-panel flex flex-col gap-3 rounded-xl border border-border p-6">
        <p className="label-eyebrow">Analysing</p>
        <p className="text-sm text-muted-strong">Extracting indicators and assessing each link through the scan pipeline. This can take a few seconds.</p>
        <Skeleton className="h-10 w-48" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

export default function Messages() {
  const [text, setText] = useState("");
  const [analysedText, setAnalysedText] = useState("");
  const [channel, setChannel] = useState<Channel>("other");
  const [touched, setTouched] = useState(false);
  const analyse = useMutation({ mutationFn: messages.analyse });
  const len = text.length;
  const problem = text.trim().length === 0 ? "Paste the message you received." : len > MAX ? `Keep it under ${MAX.toLocaleString()} characters.` : null;
  const submit = () => {
    setTouched(true);
    if (!problem) {
      setAnalysedText(text);
      analyse.mutate({ text, channel });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Investigate"
        title="Analyse a message"
        subtitle="Paste a suspicious email, SMS or chat message. We extract its links, payment addresses and requests, check them against verified organisation profiles, and assess every link."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <Reveal>
            <Card title="Message" icon={MessageSquareWarning} description="Stored as a hash, never as text.">
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
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Where you received it" className="min-w-40 flex-1">
                    <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                      <option value="dm">Chat / DM</option>
                      <option value="other">Other</option>
                    </Select>
                  </Field>
                  <Button type="submit" variant="primary" loading={analyse.isPending} className="mb-[1px]">
                    <Send aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Analyse message
                  </Button>
                </div>
              </form>
            </Card>
          </Reveal>
          <Reveal delay={0.04}>
            <Card title="Try a sample (simulated)" description="Recorded demonstration messages, labelled as such.">
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
          </Reveal>
          <Card variant="inset" className="hidden xl:block">
            <div className="flex gap-3 text-xs text-muted-strong">
              <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
              <p>Urgent wording alone never makes a message “malicious”: the engine needs evidence such as a link or payee the organisation does not use (policy O-8).</p>
            </div>
          </Card>
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4 xl:col-span-7")}>
          {analyse.isPending ? <Analysing /> : null}
          {analyse.isError ? <ErrorState error={analyse.error} title="The message was not analysed" onRetry={submit} /> : null}
          {analyse.data ? <Result a={analyse.data} text={analysedText} /> : null}
          {!analyse.data && !analyse.isPending && !analyse.isError ? (
            <Card variant="plain">
              <EmptyState
                kind="no-data"
                compact={false}
                title="Results appear here"
                description="Paste a message or pick a sample. Each link inside it gets its own scan report."
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
