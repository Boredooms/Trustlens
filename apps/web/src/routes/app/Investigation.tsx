/**
 * Investigation — the narrative an analyst reads next to the rule-decided verdict. Panels and states:
 *   Decision context  the engine's verdict + score ring (never changed by the narrative)
 *   KPI row           steps done · run time · references · dropped claims
 *   Narrative         writing (skeleton) · empty · sections with resolvable citation chips
 *   Step timings      Bklit bars · running · empty · numbers popover
 *   Notes             private block editor (loading · error · saved)
 *   Steps / References timeline and resolved citations
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bot, CheckCircle2, Circle, Clock, Download, FileText, Link2, ListChecks, Loader2, Timer, Unlink, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChartPanel } from "@/components/data/ChartPanel";
import { RankedBars } from "@/components/data/Charts";
import { VerdictBadge } from "@/components/domain/Badges";
import { NotesPanel } from "@/components/domain/NotesPanel";
import { RiskScoreRing } from "@/components/domain/RiskScoreRing";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card, StatTile } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui/Overlay";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { useInvestigation, useScanSnapshot } from "@/lib/query/hooks";
import { api } from "@/lib/api/endpoints";
import { isNotFound } from "@/lib/api/errors";
import { isTerminalStatus, toRiskLevel } from "@/lib/api/enums";
import type { Evidence, Finding, InvestigationReference, InvestigationStep } from "@/lib/api/types";
import { COPY, RISK_LEVEL_LABEL } from "@/lib/copy";
import { durationMs, humanise, plural } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

function StepIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 aria-hidden className="h-4 w-4 text-foreground" strokeWidth={1.5} />;
  if (status === "failed") return <XCircle aria-hidden className="h-4 w-4 text-danger" strokeWidth={1.5} />;
  if (status === "running") return <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-strong" strokeWidth={1.5} />;
  return <Circle aria-hidden className="h-4 w-4 text-border-strong" strokeWidth={1.5} />;
}

function Timeline({ steps }: { steps: InvestigationStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-muted">Steps appear here as the investigation runs.</p>;
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} className="relative flex items-center gap-3 py-2">
          <StepIcon status={s.status} />
          <span className="text-sm">{humanise(s.name)}</span>
          <span className="sr-only">: {s.status}</span>
          <span className="ml-auto font-mono tabular text-xs text-muted">
            {s.status === "completed" || s.status === "failed" ? durationMs(s.duration_ms) : humanise(s.status)}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface ResolvedRef {
  ref: InvestigationReference | undefined;
  finding?: Finding;
  evidence?: Evidence;
}

function describeRef(r: ResolvedRef, id: string): string {
  if (r.finding) return `Finding · ${r.finding.title}`;
  if (r.evidence) return `Evidence · ${r.evidence.source}: ${r.evidence.summary}`;
  if (r.ref?.label) return `${humanise(r.ref.kind)} · ${r.ref.label}`;
  if (r.ref) return `${humanise(r.ref.kind)} ${r.ref.finding_id ?? r.ref.evidence_id ?? r.ref.entity_id ?? ""}`.trim();
  return `Reference ${id} could not be resolved`;
}

function RefChip({ id, resolved, scanId }: { id: string; resolved: ResolvedRef; scanId: string }) {
  const text = describeRef(resolved, id);
  const findingId = resolved.ref?.kind === "finding" ? resolved.ref.finding_id : undefined;
  const cls =
    "mx-0.5 inline-flex items-center rounded-sm border border-border-strong px-1 font-mono text-xs leading-5 text-foreground hover:bg-surface-secondary";
  return (
    <Tooltip content={text}>
      {findingId ? (
        <Link to={`/app/scan/${scanId}?finding=${encodeURIComponent(findingId)}`} className={cls} aria-label={`[${id}] ${text}`}>
          [{id}]
        </Link>
      ) : (
        <button type="button" className={cls} aria-label={`[${id}] ${text}`}>
          [{id}]
        </button>
      )}
    </Tooltip>
  );
}

export default function InvestigationView() {
  const { investigationId = "" } = useParams();
  const q = useInvestigation(investigationId);
  const scanQ = useScanSnapshot(q.data?.scan_id);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading investigation" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title="Investigation" />
        {isNotFound(q.error) ? (
          <EmptyState title="This investigation does not exist or is not visible to you" />
        ) : (
          <ErrorState error={q.error} title="We could not load this investigation" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );
  }

  const inv = q.data;
  const terminal = isTerminalStatus(inv.status);
  const refs = new Map((inv.references ?? []).map((r) => [r.id, r]));
  const findings = new Map((scanQ.data?.findings ?? []).map((f) => [f.id, f]));
  const evidence = new Map((scanQ.data?.evidence ?? []).map((e) => [e.id, e]));
  const resolve = (id: string): ResolvedRef => {
    const ref = refs.get(id);
    return {
      ref,
      finding: ref?.finding_id ? findings.get(ref.finding_id) : undefined,
      evidence: ref?.evidence_id ? evidence.get(ref.evidence_id) : undefined,
    };
  };
  const sections = inv.narrative?.sections ?? [];
  const dropped = inv.dropped_claims?.length ?? 0;
  const aiUsed = inv.ai?.generated === true;
  const ctx = inv.decision_context;
  const steps = inv.steps ?? [];
  const doneSteps = steps.filter((s) => s.status === "completed").length;
  const failedSteps = steps.filter((s) => s.status === "failed").length;
  const timed = steps.filter((s) => typeof s.duration_ms === "number" && (s.status === "completed" || s.status === "failed"));
  const totalMs = timed.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  const slowest = timed.slice().sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0];
  const refCount = (inv.references ?? []).length;

  return (
    <>
      <PageHeader
        title="Investigation"
        breadcrumbs={[
          { label: "Scan", to: "/app/scan" },
          { label: "Report", to: `/app/scan/${inv.scan_id}` },
          { label: "Investigation" },
        ]}
        subtitle={
          <span>
            Started <TimeText iso={inv.created_at} />
            {inv.completed_at ? (
              <>
                {" "}
                · finished <TimeText iso={inv.completed_at} />
              </>
            ) : null}
          </span>
        }
        actions={
          <Button
            variant="secondary"
            disabled={!terminal}
            loading={exporting}
            onClick={() => {
              setExporting(true);
              setExportError(null);
              api.investigations
                .export(inv.id)
                .catch((e: unknown) => setExportError(e))
                .finally(() => setExporting(false));
            }}
          >
            <Download aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            Export Markdown
          </Button>
        }
      />
      {q.isError ? (
        <Banner className="mb-6" title="Lost contact with the API — showing the last known state">
          The investigation keeps running on the server.
        </Banner>
      ) : null}
      {exportError ? <ErrorState error={exportError} title="The export did not download" className="mb-6" compact /> : null}
      {q.timedOut ? (
        <Banner
          className="mb-6"
          title="This investigation is taking longer than usual"
          action={
            <Button size="sm" onClick={() => { q.keepWaiting(); void q.refetch(); }}>
              Keep checking
            </Button>
          }
        >
          We stopped checking after two minutes. The findings in the scan report are complete regardless.
        </Banner>
      ) : null}
      {inv.status === "failed" ? (
        <Banner tone="danger" className="mb-6" title="The investigation failed">
          No narrative was produced. The decision and findings in the scan report are unaffected.
        </Banner>
      ) : null}

      {ctx ? (
        <section aria-labelledby="ctx-title" className="mesh-panel mb-6 rounded-xl border border-border p-6 shadow-raised">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0">
              <p className="label-eyebrow">Decision — unchanged</p>
              <div className="mt-2">
                <VerdictBadge decision={ctx.decision} riskLevel={ctx.risk_level} size="lg" />
              </div>
              <h2 id="ctx-title" className="mt-3 text-sm text-muted-strong">
                {COPY.rulesDecide}
              </h2>
              <p className="mt-1 text-xs text-muted">
                Risk level {RISK_LEVEL_LABEL[toRiskLevel(ctx.risk_level)]} ·{" "}
                <Link to={`/app/scan/${inv.scan_id}`} className="underline underline-offset-4">
                  open the scan report
                </Link>
              </p>
            </div>
            <RiskScoreRing score={ctx.risk_score} decision={ctx.decision} riskLevel={ctx.risk_level} size={112} />
          </div>
        </section>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Steps done"
          icon={ListChecks}
          value={steps.length ? `${doneSteps}/${steps.length}` : "—"}
          hint={failedSteps ? `${failedSteps} failed` : humanise(inv.status)}
          tone={failedSteps ? "danger" : "neutral"}
        />
        <StatTile label="Run time" icon={Timer} value={timed.length ? durationMs(totalMs) : "—"} hint={slowest ? `Slowest: ${humanise(slowest.name)}` : "No timed steps yet"} />
        <StatTile label="References" icon={Link2} value={refCount} hint="Citations into the scan" />
        <StatTile
          label="Dropped claims"
          icon={Unlink}
          value={dropped}
          hint="Uncited claims removed"
          tone={dropped ? "warning" : "neutral"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">

          <section aria-labelledby="narrative-title" className="rounded-md border border-border bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h2 id="narrative-title" className="text-sm font-medium">
                Narrative
              </h2>
              {inv.ai ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs",
                    aiUsed ? "border-border-strong text-foreground" : "border-border text-muted-strong",
                  )}
                >
                  {aiUsed ? (
                    <Bot aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <FileText aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {aiUsed ? COPY.aiNarrative : COPY.templateNarrative}
                </span>
              ) : null}
            </header>
            <div className="flex flex-col gap-8 p-5">
              {!terminal && sections.length === 0 ? (
                <div role="status" aria-label="Writing narrative" className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              ) : sections.length === 0 ? (
                <EmptyState
                  title="No narrative"
                  description="The investigation finished without narrative sections. The findings in the scan report still explain the decision."
                />
              ) : (
                sections.map((sec, si) => (
                  <section key={si} aria-labelledby={`sec-${si}`}>
                    <h3 id={`sec-${si}`} className="text-lg font-medium">
                      {sec.heading}
                    </h3>
                    <ul className="mt-3 flex max-w-prose flex-col gap-3">
                      {sec.claims.map((c, ci) => (
                        <li key={ci} className="text-sm leading-relaxed">
                          {c.text}{" "}
                          {c.refs.map((r) => (
                            <RefChip key={r} id={r} resolved={resolve(r)} scanId={inv.scan_id} />
                          ))}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
              <span>
                Every claim must cite a finding, evidence row or entity. Claims without one are removed:{" "}
                <span className="font-mono tabular text-foreground">{dropped}</span>{" "}
                {dropped === 1 ? "claim was" : "claims were"} dropped.
              </span>
              {inv.ai?.generated && inv.ai.model ? (
                <span className="font-mono">
                  {inv.ai.model} · {inv.ai.prompt_version ?? "—"}
                </span>
              ) : null}
            </footer>
          </section>

          <ChartPanel
            title="Step timings"
            description="Where the investigation spent its time."
            icon={Clock}
            state={
              timed.length
                ? { kind: "ready" }
                : terminal
                  ? { kind: "empty", title: "No timed steps recorded" }
                  : { kind: "loading" }
            }
            summary={slowest ? <>Slowest: <span className="text-foreground">{humanise(slowest.name)}</span> ({durationMs(slowest.duration_ms)}).</> : null}
            numbers={{
              columns: [
                { key: "step", label: "Step" },
                { key: "status", label: "Status" },
                { key: "ms", label: "Duration", align: "right" },
              ],
              rows: timed.map((s) => ({ step: humanise(s.name), status: humanise(s.status), ms: durationMs(s.duration_ms) })),
            }}
            source="GET /investigations/{id} · steps"
          >
            <RankedBars data={timed.map((s) => ({ label: humanise(s.name), value: s.duration_ms ?? 0 }))} valueLabel="Milliseconds" />
          </ChartPanel>

          <NotesPanel subjectType="investigation" subjectId={inv.id} title="Analyst notes" />
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:col-span-4" aria-label="Investigation progress">
          <Card title="Steps" actions={<span className="text-xs text-muted">{humanise(inv.status)}</span>}>
            <Timeline steps={steps} />
          </Card>
          <Card title="References">
            {(inv.references ?? []).length === 0 ? (
              <p className="text-sm text-muted">No references yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(inv.references ?? []).map((r) => (
                  <li key={r.id} className="flex gap-2 text-xs">
                    <span className="font-mono text-foreground">[{r.id}]</span>
                    <span className="text-muted-strong">{describeRef(resolve(r.id), r.id)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">{plural(refCount, "reference")} resolved against the scan.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
