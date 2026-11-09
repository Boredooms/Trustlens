import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion/Motion";
import { cn } from "@/lib/utils/cn";

export type AlertTone = "danger" | "warning" | "neutral" | "success";

export interface StatusItem {
  id: string;
  tone: AlertTone;
  icon: LucideIcon;
  title: string;
  detail?: ReactNode;
  to?: string;
  /** Where the item comes from ("Report queue", "Certificate monitor") — shown, never implied. */
  source: string;
}

const TONE_ICON: Record<AlertTone, string> = {
  danger: "border-danger text-danger bg-danger-surface",
  warning: "border-warning text-warning bg-warning-surface",
  neutral: "border-border text-muted-strong bg-surface-secondary",
  success: "border-success text-success bg-success-surface",
};

export interface StatusCenterProps {
  items: StatusItem[];
  /** Shown when there is nothing to act on. Never an empty box. */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  className?: string;
}

/**
 * AlertRail / status center: a short list of things that need a person (pending reviews, expiring
 * certificates, blocked scans today). Each row names its source. Items come from stored API data;
 * the rail never derives a new security judgement.
 */
export function StatusCenter({ items, emptyTitle = "Nothing needs you right now", emptyDescription, className }: StatusCenterProps) {
  if (items.length === 0) {
    return (
      <div className={cn("flex items-start gap-3 py-2", className)}>
        <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-success" />
        <div>
          <p className="text-sm font-medium">{emptyTitle}</p>
          {emptyDescription ? <p className="mt-0.5 text-sm text-muted-strong">{emptyDescription}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <Stagger as="ul" className={cn("-my-1 flex flex-col", className)}>
      {items.map((it, i) => {
        const body = (
          <>
            <span aria-hidden className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border", TONE_ICON[it.tone])}>
              <it.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-foreground">{it.title}</span>
              {it.detail ? <span className="block text-xs text-muted-strong">{it.detail}</span> : null}
              <span className="mt-0.5 block text-2xs uppercase tracking-wide text-muted">{it.source}</span>
            </span>
            {it.to ? <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} /> : null}
          </>
        );
        return (
          <StaggerItem as="li" key={it.id} index={i}>
            {it.to ? (
              <Link
                to={it.to}
                className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-surface-secondary"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3 py-2">{body}</div>
            )}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
