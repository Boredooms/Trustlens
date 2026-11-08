import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Extra inline content next to the title (badges). */
  meta?: ReactNode;
}

let firstMount = true;

/**
 * Consistent page header. On route change the <h1> receives focus (ACCESSIBILITY §3) and the
 * document title updates. The very first page load does not steal focus from the skip link.
 */
export function PageHeader({ title, subtitle, actions, breadcrumbs, meta }: PageHeaderProps) {
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
  return (
    <header className="mb-8 flex flex-col gap-4">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {breadcrumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.to ? (
                  <Link to={c.to} className="rounded-sm hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
                {i < breadcrumbs.length - 1 ? (
                  <ChevronRight aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 ref={ref} tabIndex={-1} className="break-words text-3xl font-medium tracking-tight">
              {title}
            </h1>
            {meta}
          </div>
          {subtitle ? <div className="mt-2 max-w-reading text-sm text-muted-strong">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
