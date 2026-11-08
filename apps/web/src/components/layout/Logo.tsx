import { Link } from "react-router-dom";
import { cn } from "@/lib/utils/cn";

export interface LogoProps {
  to?: string;
  /** Hide the word mark between md and xl (icon rail). */
  compactBelowXl?: boolean;
}

/** Word mark: a lens ring drawn with currentColor (no raster, no colour). */
export function Logo({ to = "/", compactBelowXl }: LogoProps) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 rounded-sm text-foreground" aria-label="TrustLens home">
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="11" cy="11" r="7" />
        <path d="M11 7v8M7 11h8" strokeLinecap="round" />
        <path d="M16.5 16.5L21 21" strokeLinecap="round" />
      </svg>
      <span className={cn("text-sm font-medium tracking-tight", compactBelowXl && "hidden xl:inline")}>TrustLens</span>
    </Link>
  );
}
