import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Replaces the label with a spinner + "Working…" and disables the button. */
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-border bg-transparent text-foreground hover:bg-surface-secondary",
  ghost: "bg-transparent text-muted-strong hover:bg-surface-secondary hover:text-foreground",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
  link: "bg-transparent px-0 text-foreground underline-offset-4 hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5",
  lg: "h-11 px-5 text-base",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cn(base, variants[variant], variant === "link" ? "h-auto" : sizes[size], extra);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
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
