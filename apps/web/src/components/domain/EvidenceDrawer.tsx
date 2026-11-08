import { useEffect, useRef } from "react";
import type { Evidence } from "@/lib/api/types";
import { Drawer } from "@/components/ui/Overlay";
import { EmptyState } from "@/components/ui/States";
import { cn } from "@/lib/utils/cn";
import { SimulatedBadge } from "./Badges";
import { CopyButton, TimeText } from "./Text";

export interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: Evidence[];
  focusId: string | null;
}

/** Source, timestamp and summary for each evidence row. Raw headers/cookies are never shown. */
export function EvidenceDrawer({ open, onOpenChange, evidence, focusId }: EvidenceDrawerProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!open || !focusId) return;
    const t = setTimeout(() => {
      listRef.current?.querySelector(`[data-evidence="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "center" });
    }, 50);
    return () => clearTimeout(t);
  }, [open, focusId]);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Evidence"
      description={`${evidence.length} item${evidence.length === 1 ? "" : "s"} collected by this scan.`}
    >
      {evidence.length === 0 ? (
        <EmptyState
          title="No evidence recorded"
          description="This scan did not store evidence rows, usually because the checks that produce them did not run."
        />
      ) : (
        <ol ref={listRef} className="flex flex-col gap-3">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              data-evidence={ev.id}
              className={cn(
                "rounded-md border border-border p-3",
                ev.id === focusId && "border-l-2 border-l-primary bg-surface-secondary",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase text-muted-strong">{ev.source}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {ev.simulated ? <SimulatedBadge /> : null}
                  <TimeText iso={ev.observed_at} mode="absolute" />
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{ev.summary}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-2xs text-muted">{ev.id}</span>
                <CopyButton value={ev.summary} label="Copy summary" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
