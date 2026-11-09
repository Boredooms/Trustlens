import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { m } from "motion/react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { variants } from "@/lib/motion";

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  /** The one-line purpose of the page. */
  subtitle?: ReactNode;
  /** Toolbar: always right-aligned on desktop, wraps below the title on mobile. */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Extra inline content next to the title (badges). */
  meta?: ReactNode;
  /** Small section label above the title ("Investigate", "Trust"). */
  eyebrow?: string;
  /** Restore path: where "Back" goes (defaults to the last breadcrumb with a link). */
  backTo?: { to: string; label: string };
}

let firstMount = true;

/**
 * Consistent page header. On route change the <h1> receives focus (ACCESSIBILITY §3) and the
 * document title updates. The very first page load does not steal focus from the skip link.
 */
export function PageHeader({ title, subtitle, actions, breadcrumbs, meta, eyebrow, backTo }: PageHeaderProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · TrustLens`;
  }, [title]);
  useEffect(() => {
    if (firstMount) {
      firstMount = false;
      return;
    }
    ref.current?.focus({ preventScroll: false });
  }, []);
  const back =
    backTo ??
    (() => {
      const linked = [...(breadcrumbs ?? [])].reverse().find((c) => c.to);
      return linked?.to ? { to: linked.to, label: linked.label } : undefined;
    })();
  return (
    <m.header initial="hidden" animate="visible" variants={variants.enter} className="mb-8 flex flex-col gap-4">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="flex items-center gap-3">
          {back ? (
            <Link
              to={back.to}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-strong transition-colors duration-fast hover:bg-surface-secondary hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="sr-only">Back to {back.label}</span>
            </Link>
          ) : null}
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {breadcrumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {c.to ? (
                    <Link to={c.to} className="rounded-sm hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-muted-strong">
                      {c.label}
                    </span>
                  )}
                  {i < breadcrumbs.length - 1 ? <ChevronRight aria-hidden className="h-3 w-3" strokeWidth={1.5} /> : null}
                </li>
              ))}
            </ol>
          </nav>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="label-eyebrow mb-2">{eyebrow}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <h1 ref={ref} tabIndex={-1} className="font-display break-words text-4xl font-normal leading-[1.05] md:text-[2.75rem]">
              {title}
            </h1>
            {meta}
          </div>
          {subtitle ? <div className="mt-2 max-w-reading text-sm text-muted-strong">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </m.header>
  );
}
