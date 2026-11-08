import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const control =
  "w-full rounded-sm border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted focus-visible:border-border-strong aria-[invalid=true]:border-danger disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
  },
);

export interface FieldProps {
  label: string;
  /** Child control; receives id, aria-describedby and aria-invalid. */
  children: ReactElement;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  counter?: { value: number; max: number };
  className?: string;
}

/** Label + help + error wrapper (DESIGN_SYSTEM.md §7.2, ACCESSIBILITY §5). */
export function Field({ label, children, help, error, required, counter, className }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy = [help ? helpId : null, counter ? counterId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        required,
      })
    : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
        {required ? <span className="ml-1 font-normal text-muted">(required)</span> : null}
      </label>
      {child}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {help ? (
            <p id={helpId} className="text-xs text-muted">
              {help}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} className="flex items-center gap-1 text-xs text-danger">
              <AlertCircle aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              {error}
            </p>
          ) : null}
        </div>
        {counter ? (
          <p
            id={counterId}
            className={cn("tabular text-xs", counter.value > counter.max ? "text-danger" : "text-muted")}
          >
            {counter.value}/{counter.max}
          </p>
        ) : null}
      </div>
    </div>
  );
}
