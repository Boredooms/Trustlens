import { env, clerkEnabled } from "@/lib/env";
import { getAuthToken, refreshAuthToken, reportAuthFailure } from "@/lib/auth/token";
import { ApiError } from "./errors";
import type { ErrorEnvelope } from "./types";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Adds an Idempotency-Key header (API_CONTRACTS.md §9). */
  idempotent?: boolean;
  /** Return the raw Response (used for file downloads). */
  raw?: boolean;
  /** Set false for endpoints that must not carry credentials. Default true. */
  auth?: boolean;
}

const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;

/** Builds `/api/v1/...` URLs from a template and encoded segments — never raw string concatenation of input. */
export function path(strings: TemplateStringsArray, ...params: Array<string | number>): string {
  let out = strings[0] ?? "";
  params.forEach((p, i) => {
    out += encodeURIComponent(String(p)) + (strings[i + 1] ?? "");
  });
  return out;
}

function buildUrl(p: string, query?: Record<string, QueryValue>): string {
  const url = new URL(env.apiBaseUrl + p);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `web-${crypto.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function parseError(res: Response): Promise<ApiError> {
  const headerId = res.headers.get("X-Request-Id");
  let envelope: Partial<ErrorEnvelope> | null = null;
  try {
    envelope = (await res.json()) as Partial<ErrorEnvelope>;
  } catch {
    envelope = null;
  }
  const err = envelope?.error;
  if (err && typeof err.code === "string") {
    return new ApiError({
      code: err.code,
      status: res.status,
      message: typeof err.message === "string" && err.message ? err.message : defaultMessage(res.status),
      requestId: err.request_id ?? headerId,
      details: err.details ?? null,
    });
  }
  return new ApiError({
    code: res.status === 503 ? "NOT_READY" : `HTTP_${res.status}`,
    status: res.status,
    message: defaultMessage(res.status),
    requestId: headerId,
  });
}

function defaultMessage(status: number): string {
  if (status === 401) return "Your session is not valid. Sign in again.";
  if (status === 403) return "Your account does not have access to this.";
  if (status === 404) return "We could not find that. It may not exist or may not be visible to you.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status === 503) return "The analysis engine is starting up.";
  if (status >= 500) return "The TrustLens API failed to handle this request.";
  return "The request could not be completed.";
}

async function send(method: Method, p: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Client": `web/${env.appVersion}`,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotent) headers["Idempotency-Key"] = newIdempotencyKey();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(buildUrl(p, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const timedOut = controller.signal.aborted;
    throw new ApiError({
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      status: 0,
      message: timedOut
        ? "The TrustLens API took too long to answer."
        : "We could not reach the TrustLens API. It may be waking up or offline.",
    });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Observability hook for the agent layer's trace panel (lib/agents/trace.ts). Listeners receive the
 * method, the path WITHOUT its query string, status, duration and the server's request id. Never the
 * token, headers, query values or bodies, so nothing user-entered (URLs, messages) leaves this module.
 */
export interface ApiEvent {
  method: Method;
  path: string;
  status: number;
  durationMs: number;
  requestId: string | null;
}

const apiListeners = new Set<(e: ApiEvent) => void>();

export function onApiEvent(listener: (e: ApiEvent) => void): () => void {
  apiListeners.add(listener);
  return () => apiListeners.delete(listener);
}

function emit(e: ApiEvent) {
  for (const l of apiListeners) {
    try {
      l(e);
    } catch {
      /* an observer must never break a request */
    }
  }
}

interface ResponseMeta {
  status: number;
  requestId: string | null;
}

export async function request<T>(method: Method, p: string, opts: RequestOptions = {}): Promise<T> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const meta: ResponseMeta = { status: 0, requestId: null };
  try {
    const out = await requestInner<T>(method, p, opts, meta);
    if (apiListeners.size) emit({ method, path: p, status: meta.status, durationMs: elapsed(started), requestId: meta.requestId });
    return out;
  } catch (e) {
    if (apiListeners.size) {
      const err = e as Partial<ApiError>;
      emit({ method, path: p, status: typeof err.status === "number" ? err.status : 0, durationMs: elapsed(started), requestId: err.requestId ?? null });
    }
    throw e;
  }
}

function elapsed(started: number): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return Math.round(now - started);
}

async function requestInner<T>(method: Method, p: string, opts: RequestOptions, meta: ResponseMeta): Promise<T> {
  const useAuth = opts.auth !== false;
  let token = useAuth ? await getAuthToken() : null;
  let res = await send(method, p, opts, token);

  if (res.status === 401 && useAuth && token) {
    const err = await parseError(res.clone());
    // Only session tokens are refreshed; a machine-key 401 is a configuration error, not a refresh loop.
    if (clerkEnabled && err.code === "INVALID_TOKEN") {
      token = await refreshAuthToken();
      if (token) res = await send(method, p, opts, token);
      if (!token || res.status === 401) {
        reportAuthFailure();
      }
    }
  }

  if (!res.ok) throw await parseError(res);
  meta.status = res.status;
  meta.requestId = res.headers.get("X-Request-Id");
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      code: "INVALID_RESPONSE",
      status: res.status,
      message: "The API returned a response the dashboard could not read.",
      requestId: res.headers.get("X-Request-Id"),
    });
  }
}

/** Authenticated file download (e.g. investigation markdown export). */
export async function downloadFile(p: string, fallbackName: string): Promise<void> {
  const res = await request<Response>("GET", p, { raw: true });
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
