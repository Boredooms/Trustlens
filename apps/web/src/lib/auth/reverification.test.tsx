import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { api } from "@/lib/api/endpoints";
import {
  REVERIFICATION_HINT,
  asReverificationHint,
  normaliseReverificationError,
  settleReverified,
} from "./reverification";

// Simulates Clerk: on a hint, "the user completes the modal" (or cancels), then the call retries.
const clerk = vi.hoisted(() => ({ cancel: false, prompts: 0 }));
vi.mock("@clerk/clerk-react", () => ({
  useReverification:
    <A extends unknown[], R>(fetcher: (...a: A) => Promise<R>) =>
    async (...args: A) => {
      const first = await fetcher(...args);
      if (first && typeof first === "object" && "clerk_error" in first) {
        clerk.prompts += 1;
        if (clerk.cancel) throw Object.assign(new Error("cancelled"), { code: "reverification_cancelled" });
        return fetcher(...args);
      }
      return first;
    },
}));

const { useClerkReverifiedDelete } = await import("@/routes/app/settings/DeleteAccount");

const stale = () =>
  new ApiError({ code: "REVERIFICATION_REQUIRED", status: 403, message: "Confirm it's you" });

afterEach(() => {
  vi.restoreAllMocks();
  clerk.cancel = false;
  clerk.prompts = 0;
});

describe("reverification helpers", () => {
  it("turns REVERIFICATION_REQUIRED into Clerk's hint and passes other results through", async () => {
    expect(await asReverificationHint(async () => Promise.reject(stale()))()).toEqual(REVERIFICATION_HINT);
    expect(await asReverificationHint(async () => "ok")()).toBe("ok");
    const other = new ApiError({ code: "NOT_FOUND", status: 404, message: "x" });
    await expect(asReverificationHint(async () => Promise.reject(other))()).rejects.toBe(other);
  });

  it("matches the shape @clerk/shared detects", () => {
    expect(REVERIFICATION_HINT.clerk_error.type).toBe("forbidden");
    expect(REVERIFICATION_HINT.clerk_error.reason).toBe("reverification-error");
  });

  it("maps a lingering hint and a cancelled modal to REVERIFICATION_REQUIRED", () => {
    expect(() => settleReverified(REVERIFICATION_HINT)).toThrowError(ApiError);
    expect(settleReverified("done")).toBe("done");
    const mapped = normaliseReverificationError({ code: "reverification_cancelled" });
    expect(mapped).toBeInstanceOf(ApiError);
    expect((mapped as ApiError).code).toBe("REVERIFICATION_REQUIRED");
    const other = new Error("boom");
    expect(normaliseReverificationError(other)).toBe(other);
  });
});

describe("useClerkReverifiedDelete", () => {
  it("prompts once, retries and succeeds after a fresh verification", async () => {
    const spy = vi.spyOn(api.auth, "deleteMe").mockRejectedValueOnce(stale()).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useClerkReverifiedDelete());
    await expect(result.current("me@example.com")).resolves.toBeUndefined();
    expect(clerk.prompts).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("me@example.com");
  });

  it("surfaces a cancelled verification as REVERIFICATION_REQUIRED", async () => {
    clerk.cancel = true;
    vi.spyOn(api.auth, "deleteMe").mockRejectedValue(stale());
    const { result } = renderHook(() => useClerkReverifiedDelete());
    await expect(result.current("me@example.com")).rejects.toMatchObject({ code: "REVERIFICATION_REQUIRED" });
  });

  it("does not prompt when the session is already fresh", async () => {
    vi.spyOn(api.auth, "deleteMe").mockResolvedValue(undefined);
    const { result } = renderHook(() => useClerkReverifiedDelete());
    await result.current("me@example.com");
    expect(clerk.prompts).toBe(0);
  });
});
