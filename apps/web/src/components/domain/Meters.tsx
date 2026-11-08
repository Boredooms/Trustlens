import { SIGNAL_GROUP_LABEL } from "@/lib/copy";
import type { Coverage } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

export interface ScoreDialProps {
  score: number | null | undefined;
  className?: string;
}

/** Mono, tabular "62/100". Never animates a count-up. */
export function ScoreDial({ score, className }: ScoreDialProps) {
  const has = typeof score === "number" && Number.isFinite(score);
  return (
    <p className={cn("font-mono tabular text-4xl font-medium leading-none", className)}>
      <span className="sr-only">Risk score </span>
      {has ? Math.round(score) : "—"}
      <span className="text-base text-muted">/100</span>
    </p>
  );
}

export interface CoverageMeterProps {
  coverage: Coverage | null | undefined;
  /** Show the collected/unavailable/skipped group lists below the bar. */
  showGroups?: boolean;
  className?: string;
}

function GroupList({ title, groups }: { title: string; groups: string[] }) {
  return (
    <div>
      <dt className="text-xs text-muted">{title}</dt>
      <dd className="mt-0.5 text-xs text-foreground">
        {groups.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          groups.map((g) => SIGNAL_GROUP_LABEL[g] ?? g).join(", ")
        )}
      </dd>
    </div>
  );
}

/** role="meter" with aria-valuetext — shows how much was actually checked, never certainty beyond it. */
export function CoverageMeter({ coverage, showGroups = false, className }: CoverageMeterProps) {
  const pct = Math.max(0, Math.min(100, Math.round(coverage?.percent ?? 0)));
  const known = coverage !== null && coverage !== undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">Coverage</span>
        <span className="font-mono tabular text-sm">{known ? `${pct}%` : "—"}</span>
      </div>
      <div
        role="meter"
        aria-label="Coverage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={known ? `${pct} percent of checks ran` : "Coverage not reported"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary"
      >
        <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      {showGroups && coverage ? (
        <dl className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <GroupList title="Collected" groups={coverage.collected ?? []} />
          <GroupList title="Unavailable" groups={coverage.unavailable ?? []} />
          <GroupList title="Skipped" groups={coverage.skipped ?? []} />
        </dl>
      ) : null}
    </div>
  );
}

export interface ConfidenceBarProps {
  /** 0.0–1.0 */
  value: number | null | undefined;
  label?: string;
  className?: string;
}

/** Confidence is a number with a bar, never a vibe. */
export function ConfidenceBar({ value, label = "Confidence", className }: ConfidenceBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct} percent`}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-secondary"
      >
        <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono tabular text-xs">{pct}%</span>
    </div>
  );
}
