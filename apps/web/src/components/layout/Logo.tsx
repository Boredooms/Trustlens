import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";

export interface LogoProps {
  to?: string;
  /** Hide the word mark between md and xl (icon rail). */
  compactBelowXl?: boolean;
  /** Hide the word mark entirely (collapsed sidebar). */
  hideWordmark?: boolean;
}

/** Word mark: a lens ring drawn with currentColor inside a mesh-lit tile (no raster). */
export function Logo({ to = "/", compactBelowXl, hideWordmark }: LogoProps) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 rounded-md text-foreground" aria-label="TrustLens home">
      <span aria-hidden className="mesh-panel inline-flex h-7 w-7 items-center justify-center rounded-md border border-border shadow-card">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="11" cy="11" r="7" />
          <path d="M11 7v8M7 11h8" strokeLinecap="round" />
          <path d="M16.5 16.5L21 21" strokeLinecap="round" />
        </svg>
      </span>
      <span className={cn("font-display text-xl leading-none tracking-tight", compactBelowXl && "hidden xl:inline", hideWordmark && "sr-only")}>
        TrustLens
      </span>
    </Link>
  );
}
