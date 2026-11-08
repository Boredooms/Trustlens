/** Typed errors (SDK_SPECIFICATION.md §6). Every error carries `requestId` when the server sent one. */

export interface TrustLensErrorInit {
  code: string;
  message: string;
  status?: number | null;
  requestId?: string | null;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class TrustLensError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(init: TrustLensErrorInit) {
    const suffix = init.requestId ? ` (request_id: ${init.requestId} — include it when contacting support)` : "";
    super(`${init.message}${suffix}`, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.status = init.status ?? null;
    this.requestId = init.requestId ?? null;
    this.retryable = init.retryable ?? false;
    if (init.details !== undefined) this.details = init.details;
  }
}

export class ConfigurationError extends TrustLensError {
  constructor(message: string) {
    super({ code: "CONFIGURATION_ERROR", message, retryable: false });
  }
}
export class AuthenticationError extends TrustLensError {}
export class PermissionError extends TrustLensError {}
export class ValidationError extends TrustLensError {}
export class NotFoundError extends TrustLensError {}
export class ConflictError extends TrustLensError {}
export class RateLimitError extends TrustLensError {
  readonly retryAfter: number | null;
  constructor(init: TrustLensErrorInit & { retryAfter?: number | null }) {
    super({ ...init, retryable: true });
    this.retryAfter = init.retryAfter ?? null;
  }
}
export class ServerError extends TrustLensError {}
export class NetworkError extends TrustLensError {}
export class TimeoutError extends NetworkError {}
export class ProtocolError extends TrustLensError {}

/** Parse a `Retry-After` header (seconds or HTTP date) into seconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value == null || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - now) / 1000));
}

/** Map a non-2xx response (status + parsed body + headers) to the right error class. */
export function errorFromResponse(status: number, body: unknown, headers: Headers): TrustLensError {
  const envelope =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : null;
  const code = typeof envelope?.code === "string" ? envelope.code : `HTTP_${status}`;
  const message =
    typeof envelope?.message === "string" ? envelope.message : `TrustLens API returned HTTP ${status}`;
  const requestId =
    (typeof envelope?.request_id === "string" ? envelope.request_id : null) ?? headers.get("x-request-id");
  const init: TrustLensErrorInit = { code, message, status, requestId, details: envelope?.details };

  if (status === 401) return new AuthenticationError({ ...init, retryable: false });
  if (status === 403) return new PermissionError({ ...init, retryable: false });
  if (status === 404) return new NotFoundError({ ...init, retryable: false });
  if (status === 409) return new ConflictError({ ...init, retryable: false });
  if (status === 400 || status === 422) return new ValidationError({ ...init, retryable: false });
  if (status === 429) {
    return new RateLimitError({ ...init, retryAfter: parseRetryAfter(headers.get("retry-after")) });
  }
  if (status >= 500) return new ServerError({ ...init, retryable: true });
  return new TrustLensError({ ...init, retryable: false });
}
