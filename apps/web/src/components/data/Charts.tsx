/**
 * TrustLens chart set, built on the vendored Bklit UI primitives (components/charts, @bklit registry).
 * One library, one grammar: token colours only (--chart-*), Bklit's Motion-based entrance (which
 * respects reduced motion through the root MotionConfig), and every plot `aria-hidden` because the
 * owning ChartPanel provides the text summary and the numbers table.
 */
import { useMemo } from "react";
import { curveMonotoneX } from "d3-shape";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import { DECISION_COPY } from "@/lib/copy";
import type { Decision } from "@/lib/api/enums";
import type { RiskPoint, VerdictSlice } from "@/lib/insights";
import { cn } from "@/lib/utils/cn";

/** Fixed decision → chart token (semantic colour is allowed for security states only). */
export const DECISION_CHART_COLOR: Record<Decision, string> = {
  BLOCK: "var(--chart-block)",
  WARN: "var(--chart-warn)",
  ALLOW: "var(--chart-allow)",
  REVIEW: "var(--chart-review)",
  UNKNOWN: "var(--chart-unknown)",
};

// ── Verdict distribution (ring) ──────────────────────────────────────────────

export interface VerdictRingProps {
  slices: VerdictSlice[];
  className?: string;
}

/**
 * One ring per decision that occurred, each filled to its share of the window. The legend beside it
 * repeats every count and percentage in text, so colour is never the only carrier.
 */
export function VerdictRing({ slices, className }: VerdictRingProps) {
  const present = slices.filter((s) => s.count > 0);
  const total = present.reduce((s, x) => s + x.count, 0);
  const data = present.map((s) => ({
    label: DECISION_COPY[s.decision].label,
    value: s.count,
    maxValue: Math.max(1, total),
    color: DECISION_CHART_COLOR[s.decision],
  }));
  return (
    <div className={cn("flex flex-col items-center gap-5", className)}>
      <div aria-hidden className="w-44 shrink-0">
        <RingChart data={data} size={176} strokeWidth={10} ringGap={5} baseInnerRadius={34}>
          {data.map((_, i) => (
            <Ring key={i} index={i} />
          ))}
          <RingCenter defaultLabel="scans" />
        </RingChart>
      </div>
      <ul className="flex w-full min-w-0 flex-col divide-y divide-border">
        {slices.map((s) => (
          <li key={s.decision} className="flex items-center gap-3 py-2 text-sm" data-decision={s.decision}>
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DECISION_CHART_COLOR[s.decision] }} />
            <span className={cn("min-w-0 flex-1 truncate", s.count === 0 && "text-muted")}>{DECISION_COPY[s.decision].label}</span>
            <span className="font-mono tabular text-foreground">{s.count}</span>
            <span className="w-12 text-right font-mono tabular text-xs text-muted">{s.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Risk over time (area) ────────────────────────────────────────────────────

export interface RiskTrendProps {
  points: RiskPoint[];
  /** Draw the mean as a dashed line (daily granularity only; per scan, mean equals the score). */
  showMean?: boolean;
  className?: string;
}

/** Highest risk score (filled) with the mean as a muted dashed line. y is 0–100, the engine's scale. */
export function RiskTrend({ points, showMean = true, className }: RiskTrendProps) {
  const data = useMemo(() => points.map((p) => ({ date: p.date, max: p.max, mean: p.mean, scans: p.scans })), [points]);
  return (
    <div aria-hidden className={cn("w-full", className)}>
      <AreaChart data={data} xDataKey="date" aspectRatio="2.2 / 1" margin={{ top: 16, right: 12, bottom: 32, left: 12 }}>
        <Grid horizontal numTicksRows={4} strokeOpacity={0.6} />
        {/* Monotone: the line never overshoots a real score between two points (honest interpolation). */}
        <Area dataKey="max" curve={curveMonotoneX} stroke="var(--chart-line-primary)" fill="var(--chart-line-primary)" fillOpacity={0.12} strokeWidth={1.75} showMarkers={data.length < 20} />
        {showMean ? (
          <Area dataKey="mean" curve={curveMonotoneX} stroke="var(--chart-line-secondary)" fill="transparent" fillOpacity={0} strokeWidth={1.25} dashArray="4 4" dashFromIndex={0} />
        ) : null}
        <XAxis />
        <ChartTooltip
          rows={(pt) =>
            showMean
              ? [
                  { color: "var(--chart-line-primary)", label: "Highest score", value: Number(pt.max ?? 0) },
                  { color: "var(--chart-line-secondary)", label: "Mean score", value: Number(pt.mean ?? 0) },
                  { color: "var(--chart-grid)", label: "Scans", value: Number(pt.scans ?? 0) },
                ]
              : [{ color: "var(--chart-line-primary)", label: "Risk score", value: Number(pt.max ?? 0) }]
          }
        />
      </AreaChart>
    </div>
  );
}

// ── Ranked bars (horizontal) ─────────────────────────────────────────────────

export interface RankedBarsProps {
  data: Array<{ label: string; value: number; secondary?: number }>;
  valueLabel: string;
  secondaryLabel?: string;
  className?: string;
}

/** Horizontal ranking (DESIGN_SYSTEM §7.8: bars for rankings). Optional second series is stacked. */
export function RankedBars({ data, valueLabel, secondaryLabel, className }: RankedBarsProps) {
  const rows = useMemo(
    () =>
      data.map((d) => ({
        name: d.label,
        primary: secondaryLabel ? Math.max(0, d.value - (d.secondary ?? 0)) : d.value,
        secondary: d.secondary ?? 0,
      })),
    [data, secondaryLabel],
  );
  const height = Math.max(120, rows.length * 36 + 24);
  return (
    <div aria-hidden className={cn("w-full", className)} style={{ height }}>
      <BarChart
        data={rows}
        xDataKey="name"
        orientation="horizontal"
        stacked={Boolean(secondaryLabel)}
        aspectRatio="auto"
        className="h-full"
        margin={{ top: 4, right: 12, bottom: 4, left: 196 }}
      >
        <Grid horizontal={false} vertical numTicksColumns={4} strokeOpacity={0.5} />
        {secondaryLabel ? <Bar dataKey="secondary" fill="var(--chart-block)" lineCap={3} /> : null}
        <Bar dataKey="primary" fill="var(--chart-1)" lineCap={3} />
        <BarYAxis showAllLabels />
        <ChartTooltip
          showCrosshair={false}
          rows={(pt) => [
            { color: "var(--chart-1)", label: valueLabel, value: Number(pt.primary ?? 0) + (secondaryLabel ? Number(pt.secondary ?? 0) : 0) },
            ...(secondaryLabel ? [{ color: "var(--chart-block)", label: secondaryLabel, value: Number(pt.secondary ?? 0) }] : []),
          ]}
        />
      </BarChart>
    </div>
  );
}
