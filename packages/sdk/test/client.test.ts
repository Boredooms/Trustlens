import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  DECISIONS,
  NetworkError,
  ProtocolError,
  RateLimitError,
  ServerError,
  TimeoutError,
  TrustLens,
  ValidationError,
  requiresConfirmation,
  shouldBlock,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const enums = JSON.parse(
  readFileSync(resolve(here, "../../../apps/api/tests/fixtures/contract_enums.json"), "utf8"),
) as { decision: string[]; risk_level: string[]; match: string[] };

const BLOCK_ASSESSMENT = {
  assessment_id: "01JCM8C0000000000000000000",
  decision: "BLOCK",
  risk_level: "CRITICAL",
  risk_score: 62,
  coverage: {
    percent: 85,
    collected: ["reputation", "identity", "payment_destination", "infrastructure"],
    unavailable: ["credential_destination"],
    skipped: [],
  },
  reasons: ["The payment address fees@okaxis is not one registered by Northstar University."],
  identity_verified: false,
  action: {
    intent: "payment",
    claimed_organisation: { id: "01JCM5AA000000000000000000", name: "Northstar University" },
    observed_destination: "https://collect.badhost.example/pay",
    expected_destinations: ["pay.northstar-demo.example"],
    payee: "fees@okaxis",
    match: "none",
  },
  findings: [],
  scan_id: "01JCM6A0000000000000000000",
  cached: false,
  decided_at: "2026-11-07T09:14:22Z",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof TrustLens>[0]> = {}) {
  return new TrustLens({
    apiKey: "tl_live_test_x",
    baseUrl: "http://localhost:8000",
    fetch: fetchImpl,
    ...extra,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("construction", () => {
  it("rejects a malformed key", () => {
    expect(() => new TrustLens({ apiKey: "sk_nope" })).toThrow(ConfigurationError);
    expect(() => new TrustLens({ apiKey: "" })).toThrow(ConfigurationError);
  });
  it("rejects maxRetries outside 0–2", () => {
    expect(() => new TrustLens({ apiKey: "tl_live_x", maxRetries: 3 })).toThrow(ConfigurationError);
  });
  it("refuses a live key in a browser unless allowed", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    expect(() => new TrustLens({ apiKey: "tl_live_x" })).toThrow(ConfigurationError);
    expect(() => new TrustLens({ apiKey: "tl_live_x", allowBrowserKey: true })).not.toThrow();
    expect(() => new TrustLens({ apiKey: "tl_ext_x" })).not.toThrow();
  });
});

describe("assess", () => {
  it("happy path: posts snake_case body with required headers and returns fields unchanged", async () => {
    const fetchMock = vi.fn(async () => json(BLOCK_ASSESSMENT));
    const tl = client(fetchMock as unknown as typeof fetch, { client: "demo/1.0" });
    const r = await tl.assess({
      url: "https://apply.northstar-admissions.example/pay",
      intent: "payment",
      payee: "fees@okaxis",
    });
    expect(r.decision).toBe("BLOCK");
    expect(r.risk_score).toBe(62);
    expect(r.coverage.percent).toBe(85);
    expect(r.action?.payee).toBe("fees@okaxis");
    expect(r.scan_id).toBe(BLOCK_ASSESSMENT.scan_id);
    expect(shouldBlock(r)).toBe(true);
    expect(requiresConfirmation(r)).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/assess");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tl_live_test_x");
    expect(headers["X-Client"]).toBe("demo/1.0");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(Object.keys(headers).sort()).toEqual(
      ["Authorization", "Content-Type", "Idempotency-Key", "X-Client"].sort(),
    );
    expect(JSON.parse(String(init.body))).toEqual({
      url: "https://apply.northstar-admissions.example/pay",
      intent: "payment",
      payee: "fees@okaxis",
    });
  });

  it("uses a caller-supplied idempotency key and never puts it in the body", async () => {
    const fetchMock = vi.fn(async () => json(BLOCK_ASSESSMENT));
    await client(fetchMock as unknown as typeof fetch).assess({
      url: "https://x.example",
      idempotencyKey: "checkout-12345",
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("checkout-12345");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://x.example" });
  });

  it("maps unknown decision / risk_level / match values to UNKNOWN-equivalents", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        ...BLOCK_ASSESSMENT,
        decision: "QUARANTINE",
        risk_level: "EXTREME",
        action: { ...BLOCK_ASSESSMENT.action, match: "fuzzy" },
        extra_future_field: true,
      }),
    );
    const r = await client(fetchMock as unknown as typeof fetch).assess({ url: "https://x.example" });
    expect(r.decision).toBe("UNKNOWN");
    expect(r.risk_level).toBe("UNKNOWN");
    expect(r.action?.match).toBe("unverifiable");
  });

  it("maps a missing decision to UNKNOWN, never ALLOW", async () => {
    const { decision: _omit, ...rest } = BLOCK_ASSESSMENT;
    void _omit;
    const fetchMock = vi.fn(async () => json(rest));
    const r = await client(fetchMock as unknown as typeof fetch).assess({ url: "https://x.example" });
    expect(r.decision).toBe("UNKNOWN");
  });
});

describe("errors", () => {
  it("maps the error envelope to a typed error with code, status, requestId, details", async () => {
    const fetchMock = vi.fn(async () =>
      json(
        {
          error: {
            code: "TARGET_NOT_ALLOWED",
            message: "The target resolves to a private address and cannot be scanned.",
            request_id: "req_01JCM4ZA",
            details: [{ field: "url", issue: "resolves_to_private_range" }],
          },
        },
        422,
        { "x-request-id": "req_01JCM4ZA" },
      ),
    );
    const err = await client(fetchMock as unknown as typeof fetch)
      .assess({ url: "http://10.0.0.5" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const e = err as ValidationError;
    expect(e.code).toBe("TARGET_NOT_ALLOWED");
    expect(e.status).toBe(422);
    expect(e.requestId).toBe("req_01JCM4ZA");
    expect(e.retryable).toBe(false);
    expect(e.details).toEqual([{ field: "url", issue: "resolves_to_private_range" }]);
    expect(e.message).toContain("req_01JCM4ZA");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 422 is never retried
  });

  it("401 → AuthenticationError, not retried", async () => {
    const fetchMock = vi.fn(async () =>
      json({ error: { code: "INVALID_API_KEY", message: "Unknown key", request_id: "r1" } }, 401),
    );
    const err = await client(fetchMock as unknown as typeof fetch)
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).code).toBe("INVALID_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 is retryable, honours Retry-After, and reuses the same idempotency key", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: { code: "RATE_LIMITED", message: "Slow down", request_id: "r2" } }, 429, {
          "retry-after": "2",
        }),
      )
      .mockResolvedValueOnce(json(BLOCK_ASSESSMENT));
    const promise = client(fetchMock as unknown as typeof fetch).assess({ url: "https://x.example" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const r = await promise;
    expect(r.decision).toBe("BLOCK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const k1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const k2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(k1["Idempotency-Key"]).toBe(k2["Idempotency-Key"]);
  });

  it("429 after retries are exhausted surfaces RateLimitError with retryAfter and retryable=true", async () => {
    const fetchMock = vi.fn(async () =>
      json({ error: { code: "RATE_LIMITED", message: "Slow down", request_id: "r3" } }, 429, {
        "retry-after": "30",
      }),
    );
    const err = await client(fetchMock as unknown as typeof fetch, { maxRetries: 0 })
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    const e = err as RateLimitError;
    expect(e.retryable).toBe(true);
    expect(e.retryAfter).toBe(30);
    expect(e.status).toBe(429);
    expect(e.requestId).toBe("r3");
  });

  it("500 → ServerError (retryable flag) but is not auto-retried (only 429/502/503/504 are)", async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "x" } }, 500));
    const err = await client(fetchMock as unknown as typeof fetch)
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network failure → NetworkError after one retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const promise = client(fetchMock as unknown as typeof fetch)
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await promise;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out per attempt with TimeoutError", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const promise = client(fetchMock as unknown as typeof fetch, { timeoutMs: 500, maxRetries: 0 })
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    const err = await promise;
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(NetworkError);
  });

  it("2xx with invalid JSON → ProtocolError", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>", { status: 200 }));
    const err = await client(fetchMock as unknown as typeof fetch)
      .assess({ url: "https://x.example" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProtocolError);
  });
});

describe("other endpoints", () => {
  it("verifyPayment posts to /api/v1/verify-payment", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        match: "none",
        recipient_status: "unknown",
        normalised_value: "fees@okaxis",
        organisation_has_verified_recipients: true,
        expected_recipients: [{ type: "upi_vpa", handle: "fees@northstar-demo" }],
        related_reports: [],
        finding_codes: ["PAYEE_NOT_IN_VERIFIED_PROFILE"],
        confidence: 1.0,
      }),
    );
    const p = await client(fetchMock as unknown as typeof fetch).verifyPayment({
      organisation_id: "01JCM5AA000000000000000000",
      recipient_type: "upi_vpa",
      value: "fees@okaxis",
    });
    expect(p.match).toBe("none");
    expect(p.expected_recipients[0]?.handle).toBe("fees@northstar-demo");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/verify-payment");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("reportThreat posts to /api/v1/reports with an idempotency key", async () => {
    const fetchMock = vi.fn(async () =>
      json({ id: "r", status: "pending", created_at: "2026-11-07T09:14:22Z", linked_scan_id: null }, 201),
    );
    const r = await client(fetchMock as unknown as typeof fetch).reportThreat({
      url: "https://apply.northstar-admissions.example/register",
      intent: "payment",
      observed_payee: "fees@okaxis",
    });
    expect(r.status).toBe("pending");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/reports");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
  });

  it("getScan normalises unknown decisions but does not invent one for queued scans", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "s", status: "queued", url: "u", intent: "browse", created_at: "t" }))
      .mockResolvedValueOnce(
        json({ id: "s", status: "completed", url: "u", intent: "browse", created_at: "t", decision: "NEW" }),
      );
    const tl = client(fetchMock as unknown as typeof fetch);
    expect((await tl.getScan("s")).decision).toBeUndefined();
    expect((await tl.getScan("s")).decision).toBe("UNKNOWN");
  });

  it("exposes exactly the nine documented methods", () => {
    const methods = Object.getOwnPropertyNames(TrustLens.prototype).filter((m) => m !== "constructor");
    expect(methods.sort()).toEqual(
      [
        "assess",
        "scan",
        "getScan",
        "verifyIdentity",
        "verifyPayment",
        "inspectRedirect",
        "reportThreat",
        "getInvestigation",
        "startInvestigation",
      ].sort(),
    );
  });
});

describe("contract enums", () => {
  it("DECISIONS matches apps/api/tests/fixtures/contract_enums.json", () => {
    expect([...DECISIONS]).toEqual(enums.decision);
  });
});

describe("risk_class (engine 1.1.0)", () => {
  it("passes known classes through and maps unknown ones to inconclusive, never low", async () => {
    const { normaliseRiskClass, RISK_CLASSES } = await import("../src/index.js");
    expect([...RISK_CLASSES]).toEqual(["confirmed_malicious", "high", "suspicious", "low", "inconclusive"]);
    expect(normaliseRiskClass("suspicious")).toBe("suspicious");
    expect(normaliseRiskClass("probably_fine")).toBe("inconclusive");
    expect(normaliseRiskClass(undefined)).toBe("inconclusive");
  });
});
