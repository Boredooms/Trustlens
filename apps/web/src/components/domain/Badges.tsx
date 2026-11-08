import { FlaskConical, Search, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, type LucideIcon } from "lucide-react";
import { DECISION_COPY, RISK_LEVEL_LABEL, SEVERITY_LABEL, COPY } from "@/lib/copy";
import { toDecision, toRiskLevel, toSeverity, type Decision, type Severity } from "@/lib/api/enums";
import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

// DESIGN_SYSTEM.md §2.3 — fixed decision → colour/icon mapping.
const DECISION_STYLE: Record<Decision, { icon: LucideIcon; cls: string }> = {
  BLOCK: { icon: ShieldX, cls: "bg-danger-surface text-danger border-danger" },
  WARN: { icon: ShieldAlert, cls: "bg-warning-surface text-warning border-warning" },
  // ALLOW is an outline — never a filled green badge.
  ALLOW: { icon: ShieldCheck, cls: "bg-transparent text-success border-success" },
  REVIEW: { icon: Search, cls: "bg-unknown-surface text-unknown border-border-strong" },
  UNKNOWN: { icon: ShieldQuestion, cls: "bg-unknown-surface text-unknown border-border-strong" },
};

export interface VerdictBadgeProps {
  /** Raw wire value; unknown values render as UNKNOWN. */
  decision: unknown;
  riskLevel?: unknown;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Text + icon + colour; exposes one screen-reader string ("Decision: blocked. Risk: critical."). */
export function VerdictBadge({ decision, riskLevel, size = "md", className }: VerdictBadgeProps) {
  const d = toDecision(decision);
  const { icon: Icon, cls } = DECISION_STYLE[d];
  const label = DECISION_COPY[d].label;
  const sr = riskLevel !== undefined ? COPY.verdictSr(label, RISK_LEVEL_LABEL[toRiskLevel(riskLevel)]) : `Decision: ${label.toLowerCase()}.`;
  return (
    <span
      role="img"
      aria-label={sr}
      data-decision={d}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border font-medium",
        size === "sm" && "px-1.5 py-0.5 text-xs",
        size === "md" && "px-2 py-1 text-xs",
        size === "lg" && "px-3 py-1.5 text-sm",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={1.5} />
      <span aria-hidden>{label}</span>
    </span>
  );
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-danger",
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-unknown",
  info: "bg-border-strong",
};

export interface SeverityBadgeProps {
  severity: unknown;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const s = toSeverity(severity);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-border px-1.5 py-0.5 text-xs text-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[s])} />
      <span>
        <span className="sr-only">Severity: </span>
        {SEVERITY_LABEL[s]}
      </span>
    </span>
  );
}

export interface SimulatedBadgeProps {
  className?: string;
}

/** Mandatory on every simulated surface. Non-dismissible; tooltip via title. */
export function SimulatedBadge({ className }: SimulatedBadgeProps) {
  return (
    <span
      title={COPY.simulatedTitle}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-warning bg-warning-surface px-1.5 py-0.5 text-xs font-medium text-warning",
        className,
      )}
    >
      <FlaskConical aria-hidden className="h-3 w-3" strokeWidth={1.5} />
      Simulated
      <span className="sr-only">. {COPY.simulatedTitle}.</span>
    </span>
  );
}

const PILL_TONE: Record<string, string> = {
  verified: "border-success text-success",
  active: "border-success text-success",
  confirmed: "border-danger text-danger",
  failed: "border-danger text-danger",
  revoked: "border-danger text-danger",
  expired: "border-warning text-warning",
  pending: "border-border-strong text-muted-strong",
  pending_attestation: "border-border-strong text-muted-strong",
  verifying: "border-border-strong text-muted-strong",
  reviewing: "border-warning text-warning",
  dismissed: "border-border-strong text-muted-strong",
  draft: "border-border-strong text-muted-strong",
  suspended: "border-warning text-warning",
  rejected: "border-danger text-danger",
  approved: "border-success text-success",
  pending_challenge: "border-border-strong text-muted-strong",
  challenge_verified: "border-warning text-warning",
};

export interface StatusPillProps {
  status: string | null | undefined;
  className?: string;
}

/** Status chip: text always present, colour only reinforces. */
export function StatusPill({ status, className }: StatusPillProps) {
  const s = status ?? "unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs",
        PILL_TONE[s] ?? "border-border-strong text-muted-strong",
        className,
      )}
    >
      {humanise(s)}
    </span>
  );
}

export interface RiskLevelTextProps {
  level: unknown;
}

export function RiskLevelText({ level }: RiskLevelTextProps) {
  return <span>{RISK_LEVEL_LABEL[toRiskLevel(level)]}</span>;
}
