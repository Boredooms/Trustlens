import { cn } from "@/lib/utils/cn";

type Decision = "BLOCK" | "WARN" | "ALLOW" | "REVIEW" | "UNKNOWN";

const STAMP: Record<Decision, { label: string; tone: string; rule: string }> = {
  BLOCK: { label: "Payment stopped", tone: "text-danger border-danger", rule: "border-danger" },
  WARN: { label: "Confirm first", tone: "text-warning border-warning", rule: "border-warning" },
  REVIEW: { label: "Unverified", tone: "text-unknown border-unknown", rule: "border-unknown" },
  ALLOW: { label: "No known threat", tone: "text-success border-success", rule: "border-success" },
  UNKNOWN: { label: "Not checked", tone: "text-unknown border-unknown", rule: "border-unknown" },
};

export interface BlockSlipProps {
  demand: string;
  registered: string;
  decision?: Decision;
  coverage?: string;
  className?: string;
  /** Rotate the stamp; the hero uses a slight tilt, inner sections keep it straight. */
  tilt?: boolean;
}

/**
 * The signature element: a payment slip where what the page asked for is printed next to what the
 * organisation actually registered, with the rule's verdict stamped across it.
 */
export function BlockSlip({
  demand,
  registered,
  decision = "BLOCK",
  coverage = "coverage 85%",
  className,
  tilt = false,
}: BlockSlipProps) {
  const stamp = STAMP[decision];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-surface shadow-raised",
        className,
      )}
    >
      {/* perforated top edge */}
      <div
        aria-hidden
        className="h-2 w-full"
        style={{
          backgroundImage:
            "radial-gradient(circle at 6px 0, transparent 5px, var(--border) 5px, var(--border) 6px, transparent 6px)",
          backgroundSize: "12px 12px",
          backgroundRepeat: "repeat-x",
        }}
      />
      <div className="px-5 pb-5 pt-2 sm:px-6">
        <p className="label-eyebrow">This page asked for</p>
        <p className="mt-1 font-mono text-lg tracking-tight">{demand}</p>

        <div className={cn("my-4 border-t border-dashed", stamp.rule)} />

        <p className="label-eyebrow">The organisation registered</p>
        <p className="mt-1 font-mono text-lg tracking-tight">{registered}</p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-wider",
              stamp.tone,
              tilt && "-rotate-2",
            )}
          >
            {decision}
            <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
            {stamp.label}
          </span>
          <span className="font-mono text-2xs text-muted">{coverage}</span>
        </div>
      </div>
    </div>
  );
}
