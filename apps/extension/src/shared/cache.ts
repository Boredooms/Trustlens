// Verdict cache freshness (BROWSER_PROTECTION_LOGIC.md §3, API_CONTRACTS.md §12).
// A cached result older than 10 minutes — or a miss, or a corrupt entry — is never used as a
// decision: callers render UNKNOWN ("re-checking…") and refresh.
import type { CheckResult } from "./types";

export const VERDICT_TTL_MS = 10 * 60 * 1000;

export interface CachedVerdict {
  result: CheckResult;
  cachedAt: number;
}

export type CacheRead =
  | { state: "fresh"; result: CheckResult; ageMs: number }
  | { state: "stale"; ageMs: number }
  | { state: "miss" };

export function readCache(entry: unknown, now: number = Date.now()): CacheRead {
  if (!entry || typeof entry !== "object") return { state: "miss" };
  const e = entry as Partial<CachedVerdict>;
  if (typeof e.cachedAt !== "number" || !Number.isFinite(e.cachedAt) || !e.result || typeof e.result !== "object") {
    return { state: "miss" };
  }
  const ageMs = now - e.cachedAt;
  // A timestamp from the future is as untrustworthy as an old one.
  if (ageMs < 0 || ageMs > VERDICT_TTL_MS) return { state: "stale", ageMs };
  // Only real server assessments are cached for reuse; failures are always retried.
  if (e.result.kind !== "assessment") return { state: "miss" };
  return { state: "fresh", result: e.result, ageMs };
}

/** Whether a fresh check result should be written to the cache at all. */
export function isCacheable(result: CheckResult): boolean {
  return result.kind === "assessment";
}
