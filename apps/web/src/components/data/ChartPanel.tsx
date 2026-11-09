import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonChart } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, type EmptyKind } from "@/components/ui/States";
import { ChartContextPopover, type ChartContextPopoverProps } from "./ChartContextPopover";

export type ChartPanelState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown; onRetry?: () => void; retrying?: boolean }
  | { kind: "empty" | "no-data"; title: string; description?: ReactNode; action?: ReactNode }
  | { kind: "ready" };

export interface ChartPanelProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  state: ChartPanelState;
  /**
   * The chart in one sentence, always visible above the plot (DESIGN_SYSTEM §7.8: every chart has a
   * text summary, for screen readers and for people who never hover).
   */
  summary?: ReactNode;
  /** Values for the "Numbers" popover. Omit only for charts that already print every value. */
  numbers?: Omit<ChartContextPopoverProps, "title">;
  /** Provenance in the footer, e.g. "From your last 40 finished scans · GET /scans". */
  source?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * Shared chart frame: one header grammar, one summary line, one numbers popover, one set of states.
 * The plot itself is `aria-hidden` by convention in each chart; the summary and the numbers table are
 * the accessible representation.
 */
export function ChartPanel({ title, description, icon, state, summary, numbers, source, actions, className, children }: ChartPanelProps) {
  const ready = state.kind === "ready";
  return (
    <Card
      title={title}
      description={description}
      icon={icon}
      className={className}
      actions={
        <>
          {actions}
          {ready && numbers ? <ChartContextPopover title={title} {...numbers} /> : null}
        </>
      }
      footer={source ? <span>{source}</span> : undefined}
    >
      {state.kind === "loading" ? (
        <SkeletonChart label={`Loading ${title}`} />
      ) : state.kind === "error" ? (
        <ErrorState error={state.error} title={`We could not load ${title.toLowerCase()}`} onRetry={state.onRetry} retrying={state.retrying} compact />
      ) : state.kind === "empty" || state.kind === "no-data" ? (
        <EmptyState kind={state.kind as EmptyKind} title={state.title} description={state.description} action={state.action} />
      ) : (
        <div className="flex flex-col gap-4">
          {summary ? <p className="text-sm text-muted-strong">{summary}</p> : null}
          {children}
        </div>
      )}
    </Card>
  );
}
