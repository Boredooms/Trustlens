import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Info, RotateCw, Sprout, type LucideIcon } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ERROR_HINT } from "@/lib/copy";
import { detailList, isWakingError, toApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";
import { SkeletonRows } from "./Skeleton";

/**
 * Four first-class states every panel owns (DASHBOARD_REBUILD §2):
 *   loading      — <SkeletonRows/SkeletonChart> shaped like the content
 *   error        — <ErrorState>: what failed, a retry, the request id
 *   empty        — <EmptyState kind="empty">: data exists, none matches this view/filter
 *   no data yet  — <EmptyState kind="no-data">: a new account; says how to produce the first item
 */
export type EmptyKind = "empty" | "no-data";

export interface EmptyStateProps {
  title: string;
  /** One sentence explaining why it is empty. */
  description?: ReactNode;
  /** The action that fills it. */
  action?: ReactNode;
  className?: string;
  kind?: EmptyKind;
  icon?: LucideIcon;
  /** Compact = inline inside a panel row list; default = centred block. */
  compact?: boolean;
}

export function EmptyState({ title, description, action, className, kind = "empty", icon, compact = true }: EmptyStateProps) {
  const Icon = icon ?? (kind === "no-data" ? Sprout : Inbox);
  return (
    <div
      data-state={kind}
      className={cn(
        "flex gap-3",
        compact ? "items-start py-4" : "flex-col items-center justify-center py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted",
          kind === "no-data" ? "border-dashed border-border-strong bg-transparent" : "border-border bg-surface-secondary",
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <div className={cn("flex min-w-0 flex-col gap-1", !compact && "items-center")}>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <div className="max-w-prose text-sm text-muted-strong">{description}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export interface QueryViewProps<T> {
  query: Pick<UseQueryResult<T>, "isPending" | "isError" | "error" | "data" | "refetch" | "isFetching">;
  /** What failed, in user terms, e.g. "recent scans". */
  what: string;
  /** True when the loaded data has nothing to show. */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Renders exactly one of loading / error / empty / content for a TanStack query. Never swallows an
 * error: it always shows ErrorState with a retry and the request id.
 */
export function QueryView<T>({ query, what, isEmpty, empty, loading, children }: QueryViewProps<T>) {
  if (query.isPending) return <>{loading ?? <SkeletonRows rows={4} label={`Loading ${what}`} />}</>;
  if (query.isError || query.data === undefined) {
    return (
      <ErrorState
        error={query.error}
        title={`We could not load ${what}`}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        compact
      />
    );
  }
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title={`No ${what}`} />}</>;
  return <>{children(query.data)}</>;
}

export interface ErrorStateProps {
  error: unknown;
  /** What failed, in user terms: "We could not load recent scans." */
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}

/** What failed, what it means, a retry, and the request ID in a "Technical details" disclosure. */
export function ErrorState({ error, title, onRetry, retrying, className, compact }: ErrorStateProps) {
  const e = toApiError(error);
  const hint = ERROR_HINT[e.code];
  const details = detailList(e);
  const heading = title ?? (isWakingError(e) ? "The analysis engine is not answering yet" : "Something did not load");
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-surface",
        compact ? "p-3" : "p-5",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle aria-hidden className="h-4 w-4 text-danger" strokeWidth={1.5} />
        {heading}
      </p>
      <p className="max-w-prose text-sm text-muted-strong">{e.message}</p>
      {hint && hint !== e.message ? <p className="max-w-prose text-sm text-muted-strong">{hint}</p> : null}
      {details.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-muted-strong">
          {details.map((d, i) => (
            <li key={i}>
              {d.field ? <span className="font-mono">{d.field}</span> : null}
              {d.field ? ": " : null}
              {d.issue ?? JSON.stringify(d)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        {onRetry ? (
          <Button size="sm" onClick={onRetry} loading={retrying}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            Try again
          </Button>
        ) : null}
        <TechnicalDetails code={e.code} status={e.status} requestId={e.requestId} />
      </div>
    </div>
  );
}

export interface TechnicalDetailsProps {
  code: string;
  status: number;
  requestId: string | null;
}

export function TechnicalDetails({ code, status, requestId }: TechnicalDetailsProps) {
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none rounded-sm hover:text-foreground">Technical details</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        <dt>code</dt>
        <dd className="text-foreground">{code}</dd>
        <dt>status</dt>
        <dd className="text-foreground">{status > 0 ? status : "no response"}</dd>
        <dt>request_id</dt>
        <dd className="break-all text-foreground">{requestId ?? "not provided"}</dd>
      </dl>
    </details>
  );
}

export type BannerTone = "warning" | "danger" | "neutral";

export interface BannerProps {
  tone?: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const tones: Record<BannerTone, string> = {
  warning: "border-warning bg-warning-surface text-foreground",
  danger: "border-danger bg-danger-surface text-foreground",
  neutral: "border-border bg-surface-secondary text-foreground",
};

const iconTones: Record<BannerTone, string> = {
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted-strong",
};

/** Degraded-state banner: partial data with an explicit explanation. */
export function Banner({ tone = "warning", title, children, action, className }: BannerProps) {
  const Icon = tone === "neutral" ? Info : AlertTriangle;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", tones[tone], className)}>
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", iconTones[tone])} strokeWidth={1.5} />
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-1 text-muted-strong">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
