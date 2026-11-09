// Typed calls to the TrustLens API (EXTENSION_API_INTEGRATION.md). Every request goes through
// `apiFetch`, which hardcodes the build-time base URL, omits cookies and never puts the token in a URL.
import { parseAssessment } from "../shared/assessment";
import { API_BASE_URL, EXT_VERSION } from "../shared/config";
import { assessIdempotencyKey } from "../shared/hash";
import type { CheckFailure, CheckResult, FailureCode, Intent } from "../shared/types";

/**
 * A first visit to a real site runs a full server-side scan (DNS, TLS, page fetch, reputation): 10–30 s
 * from a distant client, measured 2026-11-09 against google.com, github.com, paypal.com. The page is
 * never blocked while this runs; the popup shows "Checking live…" and repeat visits are served from
 * the server's 10-minute reuse in about a second when co-located. Action checks gate a submit, so
 * they keep a tighter budget and fall back to "could not verify — decide for yourself".
 */
export const BROWSE_TIMEOUT_MS = 45_000;
export const ACTION_TIMEOUT_MS = 30_000;
const SERVER_RETRY_DELAY_MS = 2_000;

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export class TransportError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "TIMEOUT") {
    super(code);
  }
}

export interface ApiFetchInit {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  token?: string | null;
  idempotencyKey?: string;
  timeoutMs: number;
}

export async function apiFetch(init: ApiFetchInit, fetchImpl: typeof fetch = fetch): Promise<ApiResponse> {
  if (!init.path.startsWith("/")) throw new Error("apiFetch: path must be relative to the API base");
  const url = `${API_BASE_URL}${init.path}`;
  // Reject anything that would leave the configured API origin.
  if (new URL(url).origin !== new URL(API_BASE_URL).origin) throw new Error("apiFetch: origin mismatch");

  const headers: Record<string, string> = { "X-Client": `ext/${EXT_VERSION}` };
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new TransportError(controller.signal.aborted ? "TIMEOUT" : "UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export function errorCodeOf(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: { code?: unknown } }).error;
    if (e && typeof e.code === "string") return e.code;
  }
  return null;
}

export function requestIdOf(res: ApiResponse): string | null {
  if (res.body && typeof res.body === "object" && "error" in res.body) {
    const e = (res.body as { error?: { request_id?: unknown } }).error;
    if (e && typeof e.request_id === "string") return e.request_id;
  }
  return res.headers.get("x-request-id");
}

export function retryAfterSeconds(headers: Headers): number | null {
  const v = headers.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const ADDRESS_CODES = new Set([
  "TARGET_NOT_ALLOWED",
  "UNSUPPORTED_SCHEME",
  "UNSUPPORTED_PORT",
  "URL_HAS_CREDENTIALS",
  "DNS_RESOLUTION_FAILED",
]);

/** Error mapping table (EXTENSION_API_INTEGRATION.md §6). Every row ends in "not checked". */
export function failureFromResponse(res: ApiResponse): CheckFailure {
  const code = errorCodeOf(res.body);
  const requestId = requestIdOf(res);
  let f: FailureCode;
  if (res.status === 401) f = "RECONNECT";
  else if (res.status === 403) f = "MISCONFIGURED";
  else if (res.status === 429) return { code: "RATE_LIMITED", retryAfter: retryAfterSeconds(res.headers), requestId };
  else if (res.status === 422 && code && ADDRESS_CODES.has(code)) f = "CANNOT_CHECK_ADDRESS";
  else if (res.status === 422 || res.status === 400 || res.status === 404) f = "CANNOT_CHECK_PAGE";
  else f = "UNAVAILABLE";
  return { code: f, requestId };
}

export interface AssessBody {
  url: string;
  intent: Intent;
  form_action?: string;
  payee?: string;
  destination_host?: string;
}

/**
 * `POST /api/v1/assess`. Returns the server's assessment or an explicit failure; never throws.
 * 5xx gets one retry after 2 s with the same Idempotency-Key (EXTENSION_ARCHITECTURE.md §8);
 * transport errors and timeouts are not retried.
 */
export async function assess(
  body: AssessBody,
  token: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<CheckResult> {
  const clean: Record<string, unknown> = { url: body.url, intent: body.intent };
  if (body.form_action) clean.form_action = body.form_action;
  if (body.payee) clean.payee = body.payee;
  if (body.destination_host) clean.destination_host = body.destination_host;
  const idempotencyKey = await assessIdempotencyKey(body);
  const timeoutMs = body.intent === "browse" ? BROWSE_TIMEOUT_MS : ACTION_TIMEOUT_MS;

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: ApiResponse;
    try {
      res = await apiFetch({ method: "POST", path: "/api/v1/assess", body: clean, token, idempotencyKey, timeoutMs }, fetchImpl);
    } catch (err) {
      // Unreachable / timed out: no retry storm — report "not checked" straight away.
      const code = err instanceof TransportError ? err.code : "UNAVAILABLE";
      return { kind: "failure", failure: { code }, checkedAt: Date.now() };
    }
    if (res.status >= 200 && res.status < 300) {
      const assessment = parseAssessment(res.body);
      if (!assessment) {
        return { kind: "failure", failure: { code: "BAD_RESPONSE", requestId: requestIdOf(res) }, checkedAt: Date.now() };
      }
      return { kind: "assessment", assessment, checkedAt: Date.now() };
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(SERVER_RETRY_DELAY_MS);
      continue;
    }
    return { kind: "failure", failure: failureFromResponse(res), checkedAt: Date.now() };
  }
  return { kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: Date.now() };
}
