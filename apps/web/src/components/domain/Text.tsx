import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { absoluteTime, displayUrl, relativeTime, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export interface UrlTextProps {
  url: string;
  max?: number;
  className?: string;
}

/** Middle-truncated URL in mono; full value on hover. */
export function UrlText({ url, max = 56, className }: UrlTextProps) {
  const shown = displayUrl(url);
  return (
    <span title={url} className={cn("font-mono text-code", className)}>
      {truncateMiddle(shown, max)}
    </span>
  );
}

export interface TimeTextProps {
  iso: string | null | undefined;
  mode?: "relative" | "absolute";
  className?: string;
}

/** Relative for recency, absolute (with time zone) on hover or in detail views. */
export function TimeText({ iso, mode = "relative", className }: TimeTextProps) {
  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className={cn("tabular", className)}>
      {mode === "relative" ? relativeTime(iso) : absoluteTime(iso)}
    </time>
  );
}

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = "Copy", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-strong hover:bg-surface-secondary hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
