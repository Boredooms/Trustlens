import { describe, expect, it, vi } from "vitest";
import { assess, failureFromResponse } from "../src/background/api";

const OK = {
  assessment_id: "a",
  decision: "BLOCK",
  risk_level: "CRITICAL",
  risk_score: 62,
  coverage: { percent: 85, collected: [], unavailable: [], skipped: [] },
  reasons: ["r"],
  identity_verified: false,
  findings: [],
  cached: false,
  decided_at: "2026-11-07T09:14:22Z",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const noSleep = vi.fn(async () => undefined);
const TOKEN = "tl_ext_secret_token_value";

describe("assess", () => {
  it("sends exactly the documented payment body and headers; token only in Authorization", async () => {
    const f = vi.fn(async () => json(OK));
    const r = await assess(
      {
        url: "https://apply.northstar-admissions.example/pay",
        intent: "payment",
        payee: "fees@okaxis",
        destination_host: "collect.badhost.example",
        form_action: "https://collect.badhost.example/pay",
      },
      TOKEN,
      f as unknown as typeof fetch,
      noSleep,
    );
    expect(r.kind).toBe("assessment");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/assess");
    expect(url).not.toContain(TOKEN);
    expect(init.credentials).toBe("omit");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["X-Client"]).toBe("ext/0.5.0");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      url: "https://apply.northstar-admissions.example/pay",
      intent: "payment",
      form_action: "https://collect.badhost.example/pay",
      payee: "fees@okaxis",
      destination_host: "collect.badhost.example",
    });
    expect(String(init.body)).not.toContain(TOKEN);
  });

  it("browse body has only url and intent", async () => {
    const f = vi.fn(async () => json(OK));
    await assess({ url: "https://x.example/", intent: "browse" }, TOKEN, f as unknown as typeof fetch, noSleep);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://x.example/", intent: "browse" });
  });

  it("unknown decision → UNKNOWN, no crash", async () => {
    const f = vi.fn(async () => json({ ...OK, decision: "SOMETHING_NEW" }));
    const r = await assess({ url: "https://x.example/", intent: "browse" }, TOKEN, f as unknown as typeof fetch, noSleep);
    expect(r.kind === "assessment" && r.assessment.decision).toBe("UNKNOWN");
  });

  it("401 → RECONNECT, no retry", async () => {
    const f = vi.fn(async () => json({ error: { code: "INVALID_API_KEY", message: "x", request_id: "q" } }, 401));
    const r = await assess({ url: "https://x.example/", intent: "browse" }, TOKEN, f as unknown as typeof fetch, noSleep);
    expect(r.kind === "failure" && r.failure.code).toBe("RECONNECT");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("429 → RATE_LIMITED with Retry-After, no retry loop", async () => {
    const f = vi.fn(async () => json({ error: { code: "RATE_LIMITED", message: "x" } }, 429, { "retry-after": "17" }));
    const r = await assess({ url: "https://x.example/", intent: "payment" }, TOKEN, f as unknown as typeof fetch, noSleep);
    expect(r.kind === "failure" && r.failure).toMatchObject({ code: "RATE_LIMITED", retryAfter: 17 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("5xx → one retry after 2 s with the same idempotency key, then UNAVAILABLE", async () => {
    const f = vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "x" } }, 500));
    const sleep = vi.fn(async () => undefined);
    const r = await assess({ url: "https://x.example/", intent: "payment" }, TOKEN, f as unknown as typeof fetch, sleep);
    expect(r.kind === "failure" && r.failure.code).toBe("UNAVAILABLE");
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    const k = (i: number) => ((f.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"];
    expect(k(0)).toBe(k(1));
  });

  it("network error → UNAVAILABLE (fail visible, never a pass)", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await assess({ url: "https://x.example/", intent: "payment" }, TOKEN, f as unknown as typeof fetch, noSleep);
    expect(r.kind).toBe("failure");
    expect(r.kind === "failure" && r.failure.code).toBe("UNAVAILABLE");
  });

  it("2xx with a malformed body → BAD_RESPONSE", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 200 }));
    const r = await assess({ url: "https://x.example/", intent: "browse" }, TOKEN, f as unknown as typeof fetch, noSleep);
    expect(r.kind === "failure" && r.failure.code).toBe("BAD_RESPONSE");
  });
});

describe("error mapping", () => {
  const res = (status: number, code?: string) => ({
    status,
    body: code ? { error: { code, message: "m", request_id: "req_1" } } : null,
    headers: new Headers(),
  });
  it("maps the documented table", () => {
    expect(failureFromResponse(res(403, "INSUFFICIENT_SCOPE")).code).toBe("MISCONFIGURED");
    expect(failureFromResponse(res(422, "TARGET_NOT_ALLOWED")).code).toBe("CANNOT_CHECK_ADDRESS");
    expect(failureFromResponse(res(422, "INVALID_URL")).code).toBe("CANNOT_CHECK_PAGE");
    expect(failureFromResponse(res(503)).code).toBe("UNAVAILABLE");
    expect(failureFromResponse(res(422, "INVALID_URL")).requestId).toBe("req_1");
  });
});
