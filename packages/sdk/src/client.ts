import {
  ConfigurationError,
  NetworkError,
  ProtocolError,
  TimeoutError,
  TrustLensError,
  errorFromResponse,
  parseRetryAfter,
  RateLimitError,
} from "./errors.js";
import { normaliseAssessment, normaliseInvestigation, normalisePayment, normaliseScan } from "./normalise.js";
import type {
  Assessment,
  AssessInput,
  IdentityResult,
  Investigation,
  PaymentResult,
  RedirectInput,
  RedirectResult,
  ReportInput,
  ReportResult,
  Scan,
  ScanCreated,
  ScanInput,
  VerifyIdentityInput,
  VerifyPaymentInput,
} from "./types.js";

export const SDK_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://trustlens-api-m65a.onrender.com";
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const TERMINAL_SCAN_STATUS = new Set(["completed", "partial", "failed"]);

export interface TrustLensOptions {
  /** `tl_live_…` (server) or `tl_ext_…` (extension device token). */
  apiKey: string;
  /** Defaults to production. Use `http://localhost:8000` for local development. */
  baseUrl?: string;
  /** Per-attempt timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** 0–2. Default 1. Retries only on network errors, 429, 502, 503, 504. */
  maxRetries?: number;
  /** Sent as `X-Client`. Default `sdk/<version>`. */
  client?: string;
  /** Opt-in to constructing with a `tl_live_` key in a browser. Live keys belong on a server. */
  allowBrowserKey?: boolean;
  /** Injection point for tests or custom runtimes. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

function isBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== "undefined" && typeof g.document !== "undefined";
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** Generates an `Idempotency-Key` (8–128 chars, `[A-Za-z0-9._:-]`). */
export function generateIdempotencyKey(): string {
  return `sdk-${randomId()}`;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * TrustLens API client. Safe to reuse; holds no per-request mutable state.
 *
 * The SDK returns the server's decision unchanged. `ALLOW` means "no known threat within executed
 * checks" — do not render it as a guarantee.
 */
export class TrustLens {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly #apiKey: string;
  readonly #client: string;
  readonly #fetch: typeof fetch;

  constructor(options: TrustLensOptions) {
    if (!options || typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
      throw new ConfigurationError("apiKey is required");
    }
    const key = options.apiKey.trim();
    if (!/^tl_(live|ext)_[A-Za-z0-9_\-.]+$/.test(key)) {
      throw new ConfigurationError("apiKey must start with tl_live_ or tl_ext_");
    }
    if (key.startsWith("tl_live_") && isBrowser() && !options.allowBrowserKey) {
      throw new ConfigurationError(
        "Refusing to use a tl_live_ key in a browser. Live keys belong on a server (set allowBrowserKey only for read-scoped keys).",
      );
    }
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    } catch {
      throw new ConfigurationError(`baseUrl is not a valid http(s) URL: ${baseUrl}`);
    }
    const maxRetries = options.maxRetries ?? 1;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
      throw new ConfigurationError("maxRetries must be an integer between 0 and 2");
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ConfigurationError("timeoutMs must be a positive number");
    }
    const f = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof f !== "function") throw new ConfigurationError("No global fetch available; pass options.fetch");

    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.#apiKey = key;
    this.#client = options.client ?? `sdk/${SDK_VERSION}`;
    // Resolve the global lazily so tests that stub `fetch` after construction still work.
    this.#fetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  }

  /** `POST /api/v1/assess` — the hot path. */
  async assess(input: AssessInput): Promise<Assessment> {
    const { idempotencyKey, ...body } = input;
    const raw = await this.#request({
      method: "POST",
      path: "/api/v1/assess",
      body: stripUndefined(body),
      idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
    });
    return normaliseAssessment(raw);
  }

  /** `POST /api/v1/scans`, optionally polling `GET /api/v1/scans/{id}` until terminal. */
  async scan(input: ScanInput): Promise<Scan> {
    const { idempotencyKey, wait, pollTimeoutMs, ...body } = input;
    const created = (await this.#request({
      method: "POST",
      path: "/api/v1/scans",
      body: stripUndefined(body),
      idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
    })) as ScanCreated;
    if (!created || typeof created !== "object" || typeof created.id !== "string") {
      throw new ProtocolError({ code: "BAD_RESPONSE", message: "POST /scans returned no scan id" });
    }
    if (!wait) return normaliseScan(created);

    const deadline = Date.now() + (pollTimeoutMs ?? 90_000);
    let interval = Math.max(250, created.poll_after_ms ?? 1000);
    let last: Scan = normaliseScan(created);
    while (Date.now() < deadline) {
      await sleep(interval);
      last = await this.getScan(created.id);
      if (TERMINAL_SCAN_STATUS.has(last.status)) return last;
      interval = Math.max(250, last.poll_after_ms ?? 1000);
    }
    return last;
  }

  /** `GET /api/v1/scans/{id}` */
  async getScan(id: string): Promise<Scan> {
    const raw = await this.#request({ method: "GET", path: `/api/v1/scans/${encodeURIComponent(id)}` });
    return normaliseScan(raw);
  }

  /** `POST /api/v1/verify-identity` */
  async verifyIdentity(input: VerifyIdentityInput): Promise<IdentityResult> {
    return (await this.#request({
      method: "POST",
      path: "/api/v1/verify-identity",
      body: stripUndefined({ ...input }),
    })) as IdentityResult;
  }

  /** `POST /api/v1/verify-payment` — checks a recipient against the organisation's registered ones. */
  async verifyPayment(input: VerifyPaymentInput): Promise<PaymentResult> {
    const raw = await this.#request({
      method: "POST",
      path: "/api/v1/verify-payment",
      body: stripUndefined({ ...input }),
    });
    return normalisePayment(raw);
  }

  /** `POST /api/v1/inspect-redirect` */
  async inspectRedirect(input: RedirectInput): Promise<RedirectResult> {
    return (await this.#request({
      method: "POST",
      path: "/api/v1/inspect-redirect",
      body: stripUndefined({ ...input }),
    })) as RedirectResult;
  }

  /** `POST /api/v1/reports`. A report is a claim, not a verdict. */
  async reportThreat(input: ReportInput): Promise<ReportResult> {
    const { idempotencyKey, ...body } = input;
    return (await this.#request({
      method: "POST",
      path: "/api/v1/reports",
      body: stripUndefined(body),
      idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
    })) as ReportResult;
  }

  /** `GET /api/v1/investigations/{id}` */
  async getInvestigation(id: string): Promise<Investigation> {
    const raw = await this.#request({
      method: "GET",
      path: `/api/v1/investigations/${encodeURIComponent(id)}`,
    });
    return normaliseInvestigation(raw);
  }

  /** `POST /api/v1/investigations` */
  async startInvestigation(scanId: string): Promise<Investigation> {
    const raw = await this.#request({
      method: "POST",
      path: "/api/v1/investigations",
      body: { scan_id: scanId },
      idempotencyKey: generateIdempotencyKey(),
    });
    return normaliseInvestigation(raw);
  }

  async #request(spec: RequestSpec): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "X-Client": this.#client,
    };
    if (spec.body !== undefined) headers["Content-Type"] = "application/json";
    // One key per logical call, reused across retries so the server can replay instead of duplicating.
    if (spec.idempotencyKey) headers["Idempotency-Key"] = spec.idempotencyKey;

    let attempt = 0;
    for (;;) {
      try {
        return await this.#attempt(spec, headers);
      } catch (err) {
        const shouldRetry =
          attempt < this.maxRetries &&
          (err instanceof NetworkError ||
            (err instanceof TrustLensError && err.status !== null && RETRYABLE_STATUS.has(err.status)));
        if (!shouldRetry) throw err;
        const retryAfter = err instanceof RateLimitError ? err.retryAfter : null;
        const backoff =
          retryAfter !== null ? retryAfter * 1000 : 300 * 2 ** attempt * (0.8 + Math.random() * 0.4);
        await sleep(backoff);
        attempt += 1;
      }
    }
  }

  async #attempt(spec: RequestSpec, headers: Record<string, string>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}${spec.path}`, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new TimeoutError({
          code: "TIMEOUT",
          message: `TrustLens request timed out after ${this.timeoutMs} ms`,
          retryable: true,
          cause: err,
        });
      }
      throw new NetworkError({
        code: "NETWORK_ERROR",
        message: "Could not reach the TrustLens API",
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined;
    const text = await response.text();
    let parsed: unknown = undefined;
    let parseFailed = false;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parseFailed = true;
      }
    }
    if (!response.ok) throw errorFromResponse(response.status, parsed, response.headers);
    if (parseFailed || parsed === undefined) {
      throw new ProtocolError({
        code: "BAD_RESPONSE",
        message: "TrustLens API returned a non-JSON success response",
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      });
    }
    return parsed;
  }
}

export { parseRetryAfter };
