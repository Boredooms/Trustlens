import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Table2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

export interface ChartContextColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ChartContextPopoverProps {
  /** Chart title, used for the accessible name ("Numbers for Verdict distribution"). */
  title: string;
  columns: ChartContextColumn[];
  rows: Array<Record<string, ReactNode>>;
  /** Provenance under the table: what window, which endpoint. */
  note?: ReactNode;
}

/**
 * "Show me the numbers" for any chart (DASHBOARD_REBUILD §4). A Radix Popover with the exact values
 * the chart draws, as a real table: keyboard reachable, screen-reader readable, motion-free.
 */
export function ChartContextPopover({ title, columns, rows, note }: ChartContextPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger className={buttonClasses("ghost", "sm")} aria-label={`Numbers for ${title}`}>
        <Table2 aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        Numbers
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(92vw,360px)] rounded-lg border border-border bg-surface p-3 text-sm shadow-overlay"
        >
          <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
          <div className="scroll-thin max-h-72 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">Values shown in {title}</caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`border-b border-border pb-1.5 font-medium text-muted ${c.align === "right" ? "text-right" : ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className={`py-1.5 ${c.align === "right" ? "text-right font-mono tabular" : ""}`}>
                        {r[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {note ? <p className="mt-2 text-2xs text-muted">{note}</p> : null}
          <Popover.Arrow className="fill-[var(--border)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
