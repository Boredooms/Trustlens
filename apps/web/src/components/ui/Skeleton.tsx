import { cn } from "@/lib/utils/cn";

export interface SkeletonProps {
  className?: string;
}

/** Static placeholder block shaped like the final content (no shimmer — motion is reserved). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn("rounded-sm bg-surface-secondary", className)} />;
}

export interface SkeletonRowsProps {
  rows?: number;
  label?: string;
}

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
