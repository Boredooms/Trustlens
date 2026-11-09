/**
 * Investigation assistant for a scan report — the visible face of lib/agents.
 *
 *   Ask       questions answered by explainScan(): a client-side reshape of THIS scan's reasons,
 *             findings, evidence and coverage. Every line cites a finding code / evidence id that
 *             exists on the scan (citationsResolve guards the render). No model is called here;
 *             "Ask the AI" starts the server-side investigation (LLM narrative, cited, decision-locked).
 *   Context   coordinator orbits: prior scans of the domain (+ what changed), community reports,
 *             campaigns listing the domain. Labelled as linked context, never as a verdict.
 *   Next      proposeActions(): suggestions the person executes; each choice is recorded in the trace.
 *   Trace     every fetch / derivation / chosen action with source, status, timing and request ids.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { m } from "motion/react";
import { Activity, ArrowRight, Bot, Compass, FileWarning, Link2, ListChecks, MessageCircleQuestion, NotebookPen, RotateCw, Sparkles, Waypoints, type LucideIcon } from "lucide-react";
import type { Scan } from "@/lib/api/types";
import { DECISION_COPY } from "@/lib/copy";
import { toDecision } from "@/lib/api/enums";
import { useScanContext } from "@/lib/agents/coordinator";
import { QUESTIONS, citationsResolve, explainScan, type Citation, type QuestionId } from "@/lib/agents/explain";
import { proposeActions, type ProposedAction } from "@/lib/agents/actions";
import { actionStep, type TraceStep } from "@/lib/agents/trace";
import { transitions, variants } from "@/lib/motion";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TabList, tabIds } from "@/components/ui/Tabs";
import { Stagger, StaggerItem } from "@/components/motion/Motion";
import { StatusPill, VerdictBadge } from "./Badges";
import { TimeText } from "./Text";

type Tab = "ask" | "context" | "next" | "trace";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "context", label: "Linked context" },
  { id: "next", label: "Next steps" },
  { id: "trace", label: "Trace" },
];

const ACTION_ICON: Record<ProposedAction["kind"], LucideIcon> = {
  investigate: Sparkles,
  report: FileWarning,
  rescan: RotateCw,
  note: NotebookPen,
  campaign: Waypoints,
  appeal: Compass,
};

export interface ScanAssistantProps {
  scan: Scan;
  onInvestigate: () => void;
  investigating: boolean;
  onReport: () => void;
  onRescan: () => void;
  onFocusNotes: () => void;
  onOpenFinding: (findingId: string) => void;
  onOpenEvidence: (evidenceId: string) => void;
}

function CitationChip({ c, onOpenFinding, onOpenEvidence }: { c: Citation; onOpenFinding: (id: string) => void; onOpenEvidence: (id: string) => void }) {
  const label = c.kind === "finding" ? c.code : c.kind === "evidence" ? `evidence · ${c.label}` : c.label;
  const clickable = c.kind === "finding" || c.kind === "evidence";
  const cls = "inline-flex items-center gap-1 rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-2xs text-muted-strong";
  if (!clickable) return <span className={cls}>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => (c.kind === "finding" ? onOpenFinding(c.id) : onOpenEvidence(c.id))}
      className={cn(cls, "transition-colors duration-fast hover:border-border-strong hover:text-foreground")}
      title={c.label}
    >
      <Link2 aria-hidden className="h-2.5 w-2.5" strokeWidth={1.75} />
      {label}
      <span className="sr-only">: {c.label}</span>
    </button>
  );
}

function TraceRow({ s }: { s: TraceStep }) {
  const tone = s.status === "ok" ? "bg-success" : s.status === "empty" ? "bg-border-strong" : s.status === "error" ? "bg-danger" : "bg-warning";
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5 border-b border-border py-2 last:border-0">
      <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 rounded-full", tone)} />
      <div className="min-w-0">
        <p className="text-sm text-foreground">{s.label}</p>
        <p className="font-mono text-2xs text-muted">
          {s.kind} · {s.source}
          {s.errorCode ? ` · ${s.errorCode}` : ""}
          {s.requestIds.length ? ` · ${s.requestIds.join(", ")}` : ""}
        </p>
        {s.note ? <p className="text-2xs text-muted">{s.note}</p> : null}
      </div>
      <div className="text-right font-mono text-2xs text-muted-strong">
        <span className="block">{s.status}</span>
        <span className="block">
          {s.count !== undefined ? `${s.count} · ` : ""}
          {s.durationMs} ms
        </span>
      </div>
    </li>
  );
}

export function ScanAssistant({ scan, onInvestigate, investigating, onReport, onRescan, onFocusNotes, onOpenFinding, onOpenEvidence }: ScanAssistantProps) {
  const [tab, setTab] = useState<Tab>("ask");
  const [question, setQuestion] = useState<QuestionId>("meaning");
  const [chosen, setChosen] = useState<TraceStep[]>([]);
  const ctx = useScanContext(scan, true);
  const explanation = useMemo(() => explainScan(scan, question), [scan, question]);
  const resolves = useMemo(() => citationsResolve(scan, explanation), [scan, explanation]);
  const actions = useMemo(() => proposeActions(scan, ctx.data), [scan, ctx.data]);
  const trace = useMemo(
    () => [...(ctx.data?.trace ?? []), { id: "explain", kind: "derive", label: `Explained “${QUESTIONS.find((q) => q.id === question)?.label}”`, source: "local · already-loaded scan", status: resolves ? "ok" : "error", startedAt: Date.now(), durationMs: 0, count: explanation.lines.length, requestIds: [], note: resolves ? "Every citation resolves to this scan." : "A citation did not resolve; the answer was withheld." } as TraceStep, ...chosen],
    [ctx.data, question, resolves, explanation.lines.length, chosen],
  );

  const run = (a: ProposedAction) => {
    setChosen((c) => [...c, actionStep(`You chose: ${a.label}`, a.kind === "campaign" ? "navigation" : a.kind === "note" ? "notes editor" : `dashboard → API (${a.kind})`)]);
    if (a.kind === "investigate") onInvestigate();
    else if (a.kind === "report") onReport();
    else if (a.kind === "rescan") onRescan();
    else if (a.kind === "note") onFocusNotes();
  };

  const prior = ctx.data?.prior;
  const ids = (t: Tab) => tabIds("assistant", t);
  return (
    <Card
      title="Investigation assistant"
      description="Explains and connects this scan. It cites the engine's evidence and never changes the decision."
      icon={Bot}
      actions={
        <Button size="sm" variant="primary" loading={investigating} onClick={onInvestigate}>
          <Sparkles aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          Ask the AI
        </Button>
      }
      footer={
        <span className="flex items-center gap-1.5">
          <Activity aria-hidden className="h-3 w-3" strokeWidth={1.5} />
          {ctx.isFetching ? "Gathering linked context…" : `${trace.length} trace steps · ${ctx.data ? "context assembled" : "context pending"}`}
        </span>
      }
    >
      <TabList label="Assistant" tabs={TABS} value={tab} onChange={setTab} idPrefix="assistant" />

      {tab === "ask" ? (
        <div role="tabpanel" id={ids("ask").panel} aria-labelledby={ids("ask").tab} className="flex flex-col gap-4">
          <div role="group" aria-label="Questions" className="flex flex-wrap gap-1.5">
            {QUESTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                aria-pressed={question === q.id}
                onClick={() => setQuestion(q.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-fast",
                  question === q.id ? "border-border-strong bg-surface-secondary text-foreground" : "border-border text-muted-strong hover:text-foreground",
                )}
              >
                <MessageCircleQuestion aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                {q.label}
              </button>
            ))}
          </div>
          {resolves ? (
            <Stagger as="ol" className="flex flex-col gap-3" key={question}>
              {explanation.lines.map((l, i) => (
                <StaggerItem as="li" key={i} index={i} className="flex gap-3">
                  <span aria-hidden className="mt-0.5 font-mono text-2xs text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="text-sm leading-6 text-foreground">{l.text}</p>
                    {l.cites.length ? (
                      <div className="flex flex-wrap gap-1">
                        {l.cites.map((c, j) => (
                          <CitationChip key={`${c.kind}-${c.id}-${j}`} c={c} onOpenFinding={onOpenFinding} onOpenEvidence={onOpenEvidence} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          ) : (
            <ErrorState error={new Error("citation")} title="This explanation was withheld because a citation did not resolve" compact />
          )}
          {explanation.unavailable.length ? (
            <div className="rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-muted-strong">
              <p className="mb-1 font-medium text-foreground">Not known from this scan</p>
              <ul className="list-disc pl-4">
                {explanation.unavailable.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-2xs text-muted">Assembled in your browser from this scan's stored results — no model was called. “Ask the AI” writes a cited narrative on the server.</p>
        </div>
      ) : null}

      {tab === "context" ? (
        <div role="tabpanel" id={ids("context").panel} aria-labelledby={ids("context").tab}>
          {ctx.isPending ? (
            <SkeletonRows rows={3} label="Gathering linked context" />
          ) : ctx.isError ? (
            <ErrorState error={ctx.error} title="Linked context did not load" onRetry={() => void ctx.refetch()} retrying={ctx.isFetching} compact />
          ) : (
            <div className="flex flex-col gap-5">
              <section aria-label="Prior scans">
                <p className="label-eyebrow mb-2">Prior scans of {ctx.data.domain || "this domain"}</p>
                {prior?.change ? (
                  <m.div initial="hidden" animate="visible" variants={variants.enter} className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-secondary px-3 py-2 text-sm">
                    <span className="text-muted-strong">What changed:</span>
                    <VerdictBadge decision={prior.change.from} size="sm" />
                    <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                    <VerdictBadge decision={prior.change.to} size="sm" />
                    {prior.change.scoreDelta !== null ? (
                      <span className={cn("font-mono text-xs", prior.change.scoreDelta > 0 ? "text-danger" : prior.change.scoreDelta < 0 ? "text-success" : "text-muted")}>
                        score {prior.change.scoreDelta > 0 ? "+" : ""}
                        {prior.change.scoreDelta}
                      </span>
                    ) : null}
                    <span className="text-2xs text-muted">stored decisions, not re-scored</span>
                  </m.div>
                ) : null}
                {prior && prior.rows.length ? (
                  <ul className="divide-y divide-border">
                    {prior.rows.slice(0, 5).map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
                        <Link to={`/app/scan/${r.id}`} className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">
                          {r.url}
                        </Link>
                        <VerdictBadge decision={r.decision} riskLevel={r.risk_level} size="sm" />
                        <span className="w-20 text-right text-2xs text-muted">
                          <TimeText iso={r.created_at} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No earlier scan of this domain" description="This is the first time you checked it." />
                )}
              </section>
              <section aria-label="Community reports">
                <p className="label-eyebrow mb-2">Community reports</p>
                {ctx.data.reports === null ? (
                  <p className="text-sm text-muted-strong">Reports could not be checked (see Trace).</p>
                ) : ctx.data.reports.length ? (
                  <ul className="divide-y divide-border">
                    {ctx.data.reports.slice(0, 5).map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
                        <Link to={`/app/reports/${r.id}`} className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">
                          {r.url}
                        </Link>
                        <StatusPill status={r.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No report about this domain in your reports" />
                )}
              </section>
              <section aria-label="Campaigns">
                <p className="label-eyebrow mb-2">Campaigns</p>
                {ctx.data.campaigns === null ? (
                  <p className="text-sm text-muted-strong">Campaigns could not be checked (see Trace).</p>
                ) : ctx.data.campaigns.length ? (
                  <ul className="flex flex-col gap-2">
                    {ctx.data.campaigns.map((c) => (
                      <li key={c.id}>
                        <Link to={`/app/campaigns/${c.id}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:border-border-strong">
                          <span>
                            {c.name}
                            <span className="block font-mono text-2xs text-muted">member {c.matchedMember}</span>
                          </span>
                          <span className="font-mono text-xs text-muted-strong">{Math.round(c.confidence * 100)}%</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Not part of a known campaign" description="Checked the 5 most recent campaigns." />
                )}
              </section>
              <p className="text-2xs text-muted">Linked context from stored data. It is not a verdict and does not change {DECISION_COPY[toDecision(scan.decision)].label.toLowerCase()}.</p>
            </div>
          )}
        </div>
      ) : null}

      {tab === "next" ? (
        <div role="tabpanel" id={ids("next").panel} aria-labelledby={ids("next").tab}>
          {actions.length === 0 ? (
            <EmptyState title="No suggestions while the scan is running" />
          ) : (
            <Stagger as="ul" className="flex flex-col gap-2">
              {actions.map((a, i) => {
                const Icon = ACTION_ICON[a.kind];
                const body = (
                  <>
                    <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-secondary">
                      <Icon className="h-4 w-4 text-muted-strong" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">{a.label}</span>
                      <span className="block text-xs text-muted-strong">{a.reason}</span>
                    </span>
                    <ListChecks aria-hidden className="h-4 w-4 text-muted" strokeWidth={1.5} />
                  </>
                );
                return (
                  <StaggerItem as="li" key={a.id} index={i}>
                    {a.to ? (
                      <Link to={a.to} onClick={() => run(a)} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors duration-fast hover:border-border-strong hover:bg-surface-secondary">
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => run(a)} className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors duration-fast hover:border-border-strong hover:bg-surface-secondary">
                        {body}
                      </button>
                    )}
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
          <p className="mt-3 text-2xs text-muted">Suggestions only. You run each one; the API audits what it does.</p>
        </div>
      ) : null}

      {tab === "trace" ? (
        <m.div role="tabpanel" id={ids("trace").panel} aria-labelledby={ids("trace").tab} layout transition={transitions.layout}>
          <ul>
            {trace.map((s) => (
              <TraceRow key={s.id} s={s} />
            ))}
          </ul>
          <p className="mt-2 text-2xs text-muted">Endpoint templates and request ids only — no addresses, message text or tokens are recorded.</p>
        </m.div>
      ) : null}
    </Card>
  );
}
