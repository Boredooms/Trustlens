import { memo, useId } from "react";
import { ChevronDown, ChevronRight, FileSearch } from "lucide-react";
import type { Evidence, Finding } from "@/lib/api/types";
import { humanise, percent, plural, stringifyValue } from "@/lib/format";
import { SIGNAL_GROUP_LABEL } from "@/lib/copy";
import { cn } from "@/lib/utils/cn";
import { SeverityBadge, SimulatedBadge } from "./Badges";

function toPairs(obj: Record<string, unknown> | null | undefined): Array<[string, string]> {
  if (!obj) return [];
  return Object.entries(obj).map(([k, v]) => [k, stringifyValue(v)]);
}

export interface ObservedExpectedProps {
  observed: Record<string, unknown> | null | undefined;
  expected: Record<string, unknown> | null | undefined;
  observedLabel?: string;
  expectedLabel?: string;
  className?: string;
}

/** The product's most persuasive moment: what the page did next to what the organisation registered. */
export function ObservedExpected({
  observed,
  expected,
  observedLabel = "Observed on this page",
  expectedLabel = "Registered by the organisation",
  className,
}: ObservedExpectedProps) {
  const o = toPairs(observed);
  const e = toPairs(expected);
  if (o.length === 0 && e.length === 0) return null;
  return (
    <div className={cn("grid grid-cols-1 overflow-hidden rounded-md border border-border sm:grid-cols-2", className)}>
      <div className="border-b border-border bg-danger-surface p-3 sm:border-b-0 sm:border-r">
        <p className="label-eyebrow">{observedLabel}</p>
        <PairList pairs={o} />
      </div>
      <div className="bg-surface p-3">
        <p className="label-eyebrow">{expectedLabel}</p>
        <PairList pairs={e} />
      </div>
    </div>
  );
}

function PairList({ pairs }: { pairs: Array<[string, string]> }) {
  if (pairs.length === 0) return <p className="mt-1 text-sm text-muted">Nothing recorded</p>;
  return (
    <dl className="mt-1 flex flex-col gap-1">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-xs text-muted">{humanise(k)}</dt>
          <dd className="break-all font-mono text-code text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface FindingRowProps {
  finding: Finding;
  evidence: Evidence[];
  expanded: boolean;
  onToggle: () => void;
  onOpenEvidence: (evidenceId: string | null) => void;
  highlighted?: boolean;
}

/** Severity, title, detail, observed vs expected, evidence count; expands to code, rule and confidence. */
export const FindingRow = memo(function FindingRow({
  finding,
  evidence,
  expanded,
  onToggle,
  onOpenEvidence,
  highlighted,
}: FindingRowProps) {
  const panelId = useId();
  const refs = finding.evidence_refs ?? [];
  const linked = evidence.filter((e) => refs.includes(e.id));
  return (
    <li
      id={`finding-${finding.id}`}
      data-code={finding.code}
      className={cn(
        "scroll-mt-24 border-b border-border last:border-b-0",
        highlighted && "border-l-2 border-l-primary bg-surface-secondary",
      )}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <SeverityBadge severity={finding.severity} />
          {finding.simulated ? <SimulatedBadge /> : null}
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-foreground">{finding.title}</h4>
            <p className="mt-1 max-w-prose text-sm text-muted-strong">{finding.detail}</p>
          </div>
        </div>
        <ObservedExpected observed={finding.observed} expected={finding.expected} />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-sm text-muted-strong hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            ) : (
              <ChevronRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {expanded ? "Hide details" : "Details"}
          </button>
          <button
            type="button"
            onClick={() => onOpenEvidence(refs[0] ?? null)}
            className="inline-flex items-center gap-1 rounded-sm text-muted-strong hover:text-foreground"
          >
            <FileSearch aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            {plural(refs.length, "evidence item")}
          </button>
        </div>
        {expanded ? (
          <div id={panelId} className="rounded-md border border-border bg-surface-secondary p-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Code</dt>
              <dd className="font-mono text-foreground">{finding.code}</dd>
              <dt className="text-muted">Rule</dt>
              <dd className="font-mono text-foreground">{finding.rule_id ?? "—"}</dd>
              <dt className="text-muted">Confidence</dt>
              <dd className="font-mono tabular text-foreground">{percent(finding.confidence)}</dd>
              <dt className="text-muted">Signal group</dt>
              <dd className="text-foreground">{SIGNAL_GROUP_LABEL[finding.signal_group] ?? finding.signal_group}</dd>
            </dl>
            {linked.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                {linked.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="font-mono text-muted">{ev.source}</span>
                    <button
                      type="button"
                      className="text-left text-foreground underline-offset-4 hover:underline"
                      onClick={() => onOpenEvidence(ev.id)}
                    >
                      {ev.summary}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
});
