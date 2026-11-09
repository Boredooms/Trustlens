import { m } from "motion/react";
import { toDecision, toRiskLevel } from "@/lib/api/enums";
import { DECISION_COPY, RISK_LEVEL_LABEL } from "@/lib/copy";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils/cn";
import { AnimatedNumber } from "@/components/motion/Motion";
import { DECISION_CHART_COLOR } from "@/components/data/Charts";

export interface RiskScoreRingProps {
  score: number | null | undefined;
  /** The engine's decision. The ring colour follows the decision, never the score alone. */
  decision: unknown;
  riskLevel?: unknown;
  size?: number;
  className?: string;
}

/**
 * Score gauge for the engine's 0–100 risk score. Owns: an accessible `role="meter"` with value text
 * ("Risk score 81 of 100, critical, blocked"), a mono tabular number that rolls on update, and an arc
 * that draws once on mount (opacity only with reduced motion). A missing score shows "—", not 0.
 */
export function RiskScoreRing({ score, decision, riskLevel, size = 128, className }: RiskScoreRingProps) {
  const has = typeof score === "number" && Number.isFinite(score);
  const value = has ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const d = toDecision(decision);
  const level = RISK_LEVEL_LABEL[toRiskLevel(riskLevel)];
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="meter"
      aria-label="Risk score"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={has ? value : undefined}
      aria-valuetext={has ? `Risk score ${value} of 100, ${level.toLowerCase()}, ${DECISION_COPY[d].label.toLowerCase()}` : "Risk score not reported"}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-secondary)" strokeWidth={stroke} />
        {has ? (
          <m.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={DECISION_CHART_COLOR[d]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - value / 100) }}
            transition={transitions.panel}
          />
        ) : null}
      </svg>
      <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[2.5rem] leading-none">
          <AnimatedNumber face="display" value={has ? value : null} />
        </span>
        <span className="mt-1 font-mono text-2xs text-muted">/100</span>
      </div>
    </div>
  );
}
