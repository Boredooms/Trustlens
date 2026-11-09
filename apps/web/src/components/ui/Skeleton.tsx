import { cn } from "@/lib/utils/cn";

export interface SkeletonProps {
  className?: string;
}

/**
 * Placeholder shaped like the final content. A slow, low-contrast sweep (`.skeleton-sweep` in
 * globals.css) shows that something is loading; reduced motion stops it (static block).
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn("skeleton-sweep rounded-sm bg-surface-secondary", className)} />;
}

export interface SkeletonRowsProps {
  rows?: number;
  label?: string;
}

/** List-shaped loading state: label · value · trailing meta per row. */
export function SkeletonRows({ rows = 5, label = "Loading" }: SkeletonRowsProps) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Alias that matches the component inventory name (`SkeletonList`). */
export const SkeletonList = SkeletonRows;

export interface SkeletonChartProps {
  label?: string;
  className?: string;
}

/** Chart-shaped loading state: baseline plus bars of varying height (no fake data values shown). */
export function SkeletonChart({ label = "Loading chart", className }: SkeletonChartProps) {
  const heights = ["h-1/3", "h-2/3", "h-1/2", "h-3/4", "h-2/5", "h-3/5", "h-1/2"];
  return (
    <div role="status" aria-label={label} className={cn("flex h-40 items-end gap-2 border-b border-border", className)}>
      {heights.map((h, i) => (
        <Skeleton key={i} className={cn("flex-1 rounded-b-none", h)} />
      ))}
    </div>
  );
}
