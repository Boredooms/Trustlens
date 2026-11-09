import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type CardVariant = "default" | "raised" | "inset" | "plain";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** One-line purpose under the title ("what this panel tells you"). */
  description?: ReactNode;
  /** Optional leading icon in the header. Decorative; the title carries the meaning. */
  icon?: LucideIcon;
  /** Right-aligned header content (actions, counts). Toolbar placement is always here. */
  actions?: ReactNode;
  /** Footer row (secondary links, provenance such as "From your last 40 scans"). */
  footer?: ReactNode;
  headingLevel?: "h2" | "h3";
  bodyClassName?: string;
  variant?: CardVariant;
}

const VARIANT: Record<CardVariant, string> = {
  default: "border border-border bg-surface shadow-card",
  raised: "border border-border bg-surface-raised shadow-raised",
  inset: "border border-border bg-surface-secondary",
  plain: "border border-transparent bg-transparent",
};

/**
 * The one panel surface (DESIGN_SYSTEM.md §7.1, v1.1). Hairline border, token depth, 20 px padding.
 * Owns: header (icon · title · purpose · toolbar), body, optional footer. Never nest one Card in another;
 * use `variant="inset"` blocks inside instead.
 */
export function Card({
  title,
  description,
  icon: Icon,
  actions,
  footer,
  headingLevel = "h2",
  className,
  bodyClassName,
  variant = "default",
  children,
  ...rest
}: CardProps) {
  const Heading = headingLevel;
  const hasHeader = Boolean(title || actions || description);
  return (
    <section className={cn("relative min-w-0 rounded-lg", VARIANT[variant], className)} {...rest}>
      {hasHeader ? (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon ? (
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-secondary text-muted-strong"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <Heading className="text-sm font-medium leading-6 text-foreground">{title}</Heading> : null}
              {description ? <p className="text-xs leading-5 text-muted">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-xs text-muted">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small context under the number: "of 40 scans", "+2 since yesterday". */
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "danger" | "warning" | "success";
  className?: string;
}

const TONE: Record<NonNullable<StatTileProps["tone"]>, string> = {
  neutral: "text-foreground",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
};

/** KPI tile: label, a mono tabular number, context. Colour only reinforces the label. */
export function StatTile({ label, value, hint, icon: Icon, tone = "neutral", className }: StatTileProps) {
  return (
    <div className={cn("sheen flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="label-eyebrow">{label}</span>
        {Icon ? (
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-secondary">
            <Icon className="h-3.5 w-3.5 text-muted-strong" strokeWidth={1.5} />
          </span>
        ) : null}
      </div>
      <div className={cn("font-display text-[2.75rem] leading-none", TONE[tone])}>{value}</div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// ── shadcn/ui Card parts ──────────────────────────────────────────────────────
// Registry components (app-1, 21st.dev blocks) compose cards from these parts. They live here because
// a shadcn `card.tsx` would collide with this file on case-insensitive file systems. Same tokens and
// depth as <Card>, so both compositions look identical.

export const CardRoot = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-w-0 rounded-lg border border-border bg-card text-card-foreground shadow-card", className)} {...props} />
);

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />
);

export const CardTitle = ({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-sm font-medium leading-6 text-foreground", className)} {...props}>
    {children}
  </h3>
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-xs leading-5 text-muted", className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5 pt-0", className)} {...props} />
);

export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center border-t border-border px-5 py-3 text-xs text-muted", className)} {...props} />
);
