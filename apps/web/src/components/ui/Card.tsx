import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Right-aligned header content (actions, counts). */
  actions?: ReactNode;
  headingLevel?: "h2" | "h3";
  bodyClassName?: string;
}

/** 1 px border, flat surface, 20 px padding, no shadow. Never nest one Card inside another. */
export function Card({ title, actions, headingLevel = "h2", className, bodyClassName, children, ...rest }: CardProps) {
  const Heading = headingLevel;
  return (
    <section className={cn("rounded-md border border-border bg-surface", className)} {...rest}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          {title ? <Heading className="text-sm font-medium">{title}</Heading> : <span />}
          {actions}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
