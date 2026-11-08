import { ApiError, isApiError } from "@/lib/api/errors";

/**
 * The hint @clerk/shared's `isReverificationHint()` detects. Our API answers a sensitive request
 * from a stale Clerk session with 403 REVERIFICATION_REQUIRED (it also includes this object at the
 * top level of the body); the API client surfaces that as an ApiError, so we translate it back
 * into the hint for Clerk's `useReverification()`, which then opens its modal and retries.
 */
export const REVERIFICATION_HINT = {
  clerk_error: {
    type: "forbidden",
    reason: "reverification-error",
    metadata: { reverification: { level: "first_factor", afterMinutes: 10 } },
  },
} as const;

export type ReverificationHint = typeof REVERIFICATION_HINT;

export function isHint(value: unknown): value is ReverificationHint {
  return typeof value === "object" && value !== null && "clerk_error" in value;
}

/** Wrap an API call so REVERIFICATION_REQUIRED resolves to Clerk's hint instead of throwing. */
export function asReverificationHint<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | ReverificationHint> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (isApiError(e) && e.code === "REVERIFICATION_REQUIRED") return REVERIFICATION_HINT;
      throw e;
    }
  };
}

function reverificationError(message: string): ApiError {
  return new ApiError({ code: "REVERIFICATION_REQUIRED", status: 403, message });
}

/**
 * After Clerk's flow: a hint that is still a hint (the server still wants verification) or a
 * cancelled modal becomes an ApiError with copy the UI already knows how to show.
 */
export function settleReverified<R>(result: R | ReverificationHint): R {
  if (isHint(result)) throw reverificationError("Verification is still required.");
  return result;
}

export function normaliseReverificationError(e: unknown): unknown {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === "reverification_cancelled" ? reverificationError("Verification was cancelled.") : e;
}
