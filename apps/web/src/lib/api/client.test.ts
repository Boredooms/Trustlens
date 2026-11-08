import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./client";
import { ApiError } from "./errors";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("request()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the error envelope into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          error: {
            code: "TARGET_NOT_ALLOWED",
            message: "The target resolves to a private address and cannot be scanned.",
            request_id: "req_01",
            details: [{ field: "url", issue: "resolves_to_private_range" }],
          },
        }),
      ),
    );
    const err = await request("POST", "/api/v1/scans", { body: { url: "http://10.0.0.5" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.code).toBe("TARGET_NOT_ALLOWED");
    expect(e.status).toBe(422);
    expect(e.requestId).toBe("req_01");
    expect(Array.isArray(e.details)).toBe(true);
  });

  it("turns a network failure into a status-0 ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = (await request("GET", "/api/v1/overview").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(0);
  });

  it("maps a 503 without an envelope to NOT_READY", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const err = (await request("GET", "/api/v1/overview").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("NOT_READY");
  });

  it("returns undefined for 204", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(request("DELETE", "/api/v1/api-keys/x")).resolves.toBeUndefined();
  });
});
