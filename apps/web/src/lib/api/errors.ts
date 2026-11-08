import type { ErrorDetail } from "./types";

/** Normalised API failure (FRONTEND_ARCHITECTURE.md §4.1). Components never see a raw Response. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: ErrorDetail[] | Record<string, unknown> | null;

  constructor(init: {
    code: string;
    status: number;
    message: string;
    requestId?: string | null;
    details?: ErrorDetail[] | Record<string, unknown> | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Network failure (status 0) or 503 — the analysis engine is asleep or unreachable. */
export function isWakingError(e: unknown): boolean {
  return isApiError(e) && (e.status === 0 || e.status === 503 || e.code === "NOT_READY");
}

export function isAuthError(e: unknown): boolean {
  return isApiError(e) && e.status === 401;
}

export function isForbidden(e: unknown): boolean {
  return isApiError(e) && e.status === 403;
}

export function isNotFound(e: unknown): boolean {
  return isApiError(e) && e.status === 404;
}

/** Field-level details as an array, whatever shape the server sent. */
export function detailList(e: ApiError): ErrorDetail[] {
  if (Array.isArray(e.details)) return e.details;
  return [];
}

export function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  return new ApiError({
    code: "CLIENT_ERROR",
    status: -1,
    message: e instanceof Error ? e.message : "Something went wrong in the dashboard.",
  });
}
