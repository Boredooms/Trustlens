import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type ToastTone } from "@/stores/toast";
import { cn } from "@/lib/utils/cn";

const ICON: Record<ToastTone, typeof Info> = { success: CheckCircle2, danger: AlertTriangle, neutral: Info };
const ICON_TONE: Record<ToastTone, string> = {
  success: "text-success",
  danger: "text-danger",
  neutral: "text-muted-strong",
};

/** Polite live region, bottom-right; each toast has a close button and auto-dismisses after 5 s. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 shadow-overlay"
          >
            <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_TONE[t.tone])} strokeWidth={1.5} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-foreground">{t.title}</p>
              {t.description ? <p className="mt-0.5 break-words text-muted-strong">{t.description}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="rounded-sm p-0.5 text-muted-strong hover:bg-surface-secondary hover:text-foreground"
            >
              <X aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
