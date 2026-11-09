import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The one button. Accepts both TrustLens variant names and the shadcn/ui names used by registry
 * components (shadcn `button.tsx` would collide with this file on case-insensitive file systems, so
 * the shadcn API lives here): default→primary, outline→secondary, destructive→danger; size
 * default→md, icon → square 36 px. `asChild` renders the child (e.g. a <Link>) with button styling.
 */
export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number] | "default" | "outline" | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "default" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Replaces the label with a spinner + "Working…" and disables the button. */
  loading?: boolean;
  /** Render the single child element with button classes (Radix Slot). */
  asChild?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,border-color,transform,box-shadow] duration-fast ease-standard active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

const variants: Record<(typeof BUTTON_VARIANTS)[number], string> = {
  primary: "bg-primary text-primary-foreground shadow-card hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-foreground shadow-card hover:border-border-strong hover:bg-surface-secondary",
  ghost: "bg-transparent text-muted-strong hover:bg-surface-secondary hover:text-foreground",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
  link: "bg-transparent px-0 text-foreground underline-offset-4 hover:underline",
};

const ALIAS: Record<string, (typeof BUTTON_VARIANTS)[number]> = { default: "primary", outline: "secondary", destructive: "danger" };

const sizes: Record<"sm" | "md" | "lg" | "icon", string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5",
  lg: "h-11 px-5 text-base",
  icon: "h-9 w-9 p-0",
};

function resolveVariant(v: ButtonVariant): (typeof BUTTON_VARIANTS)[number] {
  return ALIAS[v] ?? (v as (typeof BUTTON_VARIANTS)[number]);
}

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  const v = resolveVariant(variant);
  const s = size === "default" ? "md" : size;
  return cn(base, variants[v], v === "link" ? "h-auto" : sizes[s], extra);
}

/** shadcn-compatible alias: `buttonVariants({ variant, size, className })`. */
export function buttonVariants(opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return buttonClasses(opts.variant ?? "default", opts.size ?? "default", opts.className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", asChild = false, ...rest },
  ref,
) {
  if (asChild) {
    return (
      <Slot ref={ref} className={buttonClasses(variant, size, className)} {...rest}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
