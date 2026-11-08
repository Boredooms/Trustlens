import { useEffect, useState } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { FlaskConical, WifiOff } from "lucide-react";
import { env } from "@/lib/env";
import { COPY } from "@/lib/copy";
import { isWakingError } from "@/lib/api/errors";
import { Button } from "@/components/ui/Button";

/** Shown on every page when VITE_DEMO_MODE=true. */
export function DemoBanner() {
  if (!env.demoMode) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-border bg-surface-secondary px-4 py-1.5 text-xs text-muted-strong">
      <FlaskConical aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      <span>Demo environment. Organisations, sites and incidents here are seeded demonstration data.</span>
    </div>
  );
}

function isWakingQuery(q: Query): boolean {
  return q.state.status === "error" && isWakingError(q.state.error);
}

/**
 * Cold start / network banner. Derived from the query cache (not a store): if any query failed with
 * 503 or no response, offer a retry that refetches only those queries and keeps everything else.
 */
export function EngineBanner() {
  const qc = useQueryClient();
  const [waking, setWaking] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const cache = qc.getQueryCache();
    const check = () => setWaking(cache.getAll().some(isWakingQuery));
    check();
    return cache.subscribe(check);
  }, [qc]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (offline) {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border bg-warning-surface px-6 py-2 text-sm">
        <WifiOff aria-hidden className="h-4 w-4 text-warning" strokeWidth={1.5} />
        You are offline — results may be stale.
      </div>
    );
  }
  if (!waking) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warning-surface px-6 py-2 text-sm"
    >
      <span>{COPY.coldStart}</span>
      <Button
        size="sm"
        loading={retrying}
        onClick={() => {
          setRetrying(true);
          void qc.refetchQueries({ predicate: isWakingQuery }).finally(() => setRetrying(false));
        }}
      >
        Retry now
      </Button>
    </div>
  );
}
