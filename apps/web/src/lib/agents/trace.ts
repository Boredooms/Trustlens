/**
 * Observability for agent-assisted views. Every orbit the coordinator runs, every explanation it
 * assembles and every action the user picks becomes a TraceStep, shown in the Trace panel so a person
 * can see where each piece of information came from.
 *
 * What a step may hold: a label, the endpoint *template* (e.g. "GET /api/v1/scans?q"), status, timing,
 * a count, the server request id and an error code. What it must never hold: URLs, domains, message
 * text, tokens, finding details or any other user/scan content. Steps live in memory only; nothing is
 * logged, persisted or sent anywhere.
 */
import { onApiEvent, type ApiEvent } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";

export type TraceKind = "fetch" | "derive" | "action";
export type TraceStatus = "ok" | "empty" | "error" | "skipped";

export interface TraceStep {
  id: string;
  kind: TraceKind;
  label: string;
  /** Endpoint template or "local" for derivations that read only the already-loaded scan. */
  source: string;
  status: TraceStatus;
  startedAt: number;
  durationMs: number;
  count?: number;
  requestIds: string[];
  errorCode?: string;
  note?: string;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Run one fetch orbit and record it. `pathPrefix` scopes which API events belong to this step so
 * parallel orbits do not steal each other's request ids.
 */
export async function traced<T>(
  opts: { label: string; source: string; pathPrefix: string; count?: (v: T) => number },
  fn: () => Promise<T>,
): Promise<{ value: T | null; step: TraceStep }> {
  const requestIds: string[] = [];
  const off = onApiEvent((e: ApiEvent) => {
    if (e.path.startsWith(opts.pathPrefix) && e.requestId) requestIds.push(e.requestId);
  });
  const startedAt = Date.now();
  const t0 = now();
  try {
    const value = await fn();
    const count = opts.count ? opts.count(value) : undefined;
    return {
      value,
      step: {
        id: nextId("fetch"),
        kind: "fetch",
        label: opts.label,
        source: opts.source,
        status: count === 0 ? "empty" : "ok",
        startedAt,
        durationMs: Math.round(now() - t0),
        count,
        requestIds,
      },
    };
  } catch (e) {
    return {
      value: null,
      step: {
        id: nextId("fetch"),
        kind: "fetch",
        label: opts.label,
        source: opts.source,
        status: "error",
        startedAt,
        durationMs: Math.round(now() - t0),
        requestIds: isApiError(e) && e.requestId ? [...new Set([...requestIds, e.requestId])] : requestIds,
        errorCode: isApiError(e) ? e.code : "UNKNOWN_ERROR",
      },
    };
  } finally {
    off();
  }
}

export function derivedStep(label: string, count: number, note?: string): TraceStep {
  return {
    id: nextId("derive"),
    kind: "derive",
    label,
    source: "local · already-loaded scan",
    status: count === 0 ? "empty" : "ok",
    startedAt: Date.now(),
    durationMs: 0,
    count,
    requestIds: [],
    note,
  };
}

export function skippedStep(label: string, source: string, note: string): TraceStep {
  return { id: nextId("skip"), kind: "fetch", label, source, status: "skipped", startedAt: Date.now(), durationMs: 0, requestIds: [], note };
}

/** The user chose a proposed action. Recorded here; the action itself is audited by the API it calls. */
export function actionStep(label: string, source: string): TraceStep {
  return { id: nextId("action"), kind: "action", label, source, status: "ok", startedAt: Date.now(), durationMs: 0, requestIds: [] };
}
