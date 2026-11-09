# SDK_INTEGRATION_GUIDE

> **Status:** DECIDED · **Group:** 06-sdk · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** installation and realistic integration examples.
> **Related:** [`SDK_SPECIFICATION.md`](SDK_SPECIFICATION.md) · [`../03-backend/API_ENDPOINTS.md`](../03-backend/API_ENDPOINTS.md)

---

## 1. Install and configure

```bash
npm install trustlens-sdk
# or pnpm add trustlens-sdk
```

```bash
# .env (server only — never commit)
TRUSTLENS_API_KEY=tl_live_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

Create the key in the dashboard: **Developers → Create key**, scopes `assess:read`, `payments:read`,
`reports:write`. The secret is shown once.

---

## 2. Node.js — pre-checkout guard

```ts
import { TrustLens, shouldBlock, requiresConfirmation } from "trustlens-sdk";

const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY!, client: "checkout/1.0" });

export async function checkSellerPayee(input: {
  sellerUrl: string;
  payee: string;
  organisationId?: string;
}) {
  const result = await tl.assess({
    url: input.sellerUrl,
    intent: "payment",
    organisation_id: input.organisationId,
    payee: input.payee,
  });

  if (shouldBlock(result)) {
    return { allow: false, reason: result.reasons[0] ?? "Payment destination not authorised" };
  }
  if (requiresConfirmation(result)) {
    return { allow: true, confirm: true, reason: result.reasons[0] ?? null };
  }
  return { allow: true, confirm: false, reason: null };
}
```

Call it **before** creating the order, not after. A check after payment is a receipt, not a control.

---

## 3. Express middleware

```ts
import express from "express";
import { TrustLens, RateLimitError, TimeoutError } from "trustlens-sdk";

const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY! });
export const app = express();

app.post("/links/check", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const r = await tl.assess({ url, intent: "browse" });
    return res.json({
      decision: r.decision,
      risk_level: r.risk_level,
      coverage: r.coverage.percent,
      reasons: r.reasons.slice(0, 2),
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).set("Retry-After", String(err.retryAfter ?? 60)).json({ error: "busy" });
    }
    if (err instanceof TimeoutError) {
      // Fail open for browsing, but never claim the link is safe.
      return res.json({ decision: "UNKNOWN", reasons: ["Trust check timed out"] });
    }
    throw err;
  }
});
```

Note the fail-open-but-honest pattern: `UNKNOWN`, never `ALLOW`.

---

## 4. Next.js route handler

```ts
// app/api/trust/route.ts
import { NextResponse } from "next/server";
import { TrustLens } from "trustlens-sdk";

const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY! });

export async function POST(req: Request) {
  const { url, payee } = (await req.json()) as { url: string; payee?: string };
  const result = await tl.assess({
    url,
    intent: payee ? "payment" : "browse",
    payee,
  });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },  // personalised/decision data must not be cached
  });
}
```

Keep the key server-side. Do not import the SDK into a client component.

---

## 5. Python interoperability (FastAPI calling the REST API)

The SDK is TypeScript-only; Python services call the API directly.

```python
import httpx, os

BASE = os.environ["TRUSTLENS_API_BASE"]
KEY = os.environ["TRUSTLENS_API_KEY"]

async def assess(url: str, payee: str | None = None) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{BASE}/api/v1/assess",
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
            json={"url": url, "intent": "payment" if payee else "browse", "payee": payee},
        )
    r.raise_for_status()
    return r.json()
```

Rules: treat `decision == "ALLOW"` as "no known threat", send `Idempotency-Key` on retries, and never
retry a `422`.

---

## 6. Login-flow integration

```ts
const result = await tl.assess({
  url: window.location.href,
  intent: "login",
  organisation_id: "01JCM5AA...",   // when you know which org you represent
  form_action: form.action,
});
if (result.decision === "BLOCK") {
  showInlineError("This page is not authorised to collect credentials for this organisation.");
}
```

Server-side alternative (recommended): your backend already knows the canonical login host, so compare
it yourself and use TrustLens for the broader judgement. Do not let a client-side check be your only
control.

---

## 7. Verifying an organisation

```ts
const id = await tl.verifyIdentity({
  domain: "apply.northstar-admissions.example",
  organisation_id: "01JCM5AA...",
});

if (!id.identity_verified) {
  // id.reason_code ∈ DOMAIN_VERIFIED | DOMAIN_NOT_REGISTERED_BY_BRAND | NO_PROFILE | CLAIM_AMBIGUOUS
  console.log(id.reason_code, id.verified_domains);
}
```

`NO_PROFILE` means we have nothing to compare against — that is **not** evidence of fraud, and your UI
must not say it is.

---

## 8. Payee verification standalone

```ts
const p = await tl.verifyPayment({
  organisation_id: "01JCM5AA...",
  recipient_type: "upi_vpa",
  value: "fees@okaxis",
});

switch (p.match) {
  case "exact":        /* proceed */ break;
  case "none":         /* block: not registered */ break;
  case "unverifiable": /* warn: org has no registered recipients */ break;
}
```

---

## 9. Reporting from your UI

```ts
await tl.reportThreat({
  url: "https://apply.northstar-admissions.example/register",
  justification: "Asked for a fee to a personal UPI ID after I applied.",
  intent: "payment",
  observed_payee: "fees@okaxis",
});
```

A report is a claim, not a verdict. Show "Report sent" — not "Site reported as malicious".

---

## 10. Error handling playbook

| Error | Action |
| --- | --- |
| `AuthenticationError` | Do not retry. Alert ops: the key is wrong or revoked |
| `PermissionError` | Add the missing scope in the dashboard; do not retry |
| `ValidationError` | Fix the request; log `details`; never retry |
| `ConflictError` | For reports: treat as already reported (success for UX) |
| `RateLimitError` | Honour `Retry-After`; queue the work; consider a local token bucket |
| `TimeoutError` / `NetworkError` | Retry once with jitter; then degrade honestly |
| `ServerError` | Retry once; then degrade honestly |
| `ProtocolError` | Version mismatch: check the SDK/API compatibility table |

Degrade honestly means: `UNKNOWN` with a user-visible "could not verify", or a documented product
decision to allow with a warning. Never fabricate `ALLOW`.

---

## 11. Production recommendations

1. **Server-side only.** Never ship `tl_live_` keys to a browser or mobile app.
2. **One client per process.** Reuse it; `fetch` connections are pooled by the runtime.
3. **Set a timeout below your own request timeout** (e.g. 8 s if your route allows 10 s).
4. **Cache decisions per (url, intent) for at most 10 minutes**, and never cache `BLOCK` as `ALLOW`.
5. **Log `requestId`** on every unexpected result; it is the only way support can trace a decision.
6. **Do not parse `reasons[]`.** Use `findings[].code` for logic and `reasons` for display.
7. **Treat `REVIEW` and `UNKNOWN` distinctly** in your UX; collapsing them hides risk.
8. **Rate-limit your own endpoints**; the SDK's quotas are not a substitute for protecting your API.
9. **Record the decision you acted on** (id + decision + timestamp) for audit.
10. **Test with the demo domains** before pointing at production traffic.

---

## 12. Testing your integration

```ts
import { describe, it, expect, vi } from "vitest";
import { TrustLens } from "trustlens-sdk";

describe("checkout guard", () => {
  it("blocks on BLOCK", async () => {
    const tl = new TrustLens({ apiKey: "tl_live_test_x" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      assessment_id: "a", decision: "BLOCK", risk_level: "CRITICAL", risk_score: 88,
      coverage: { percent: 80, collected: [], unavailable: [], skipped: [] },
      reasons: ["payee not registered"], identity_verified: false,
      findings: [], cached: false, decided_at: new Date().toISOString(),
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const r = await tl.assess({ url: "https://x.example", intent: "payment" });
    expect(r.decision).toBe("BLOCK");
  });
});
```

Fixtures for each decision live in the SDK repo so integrators can test all five branches without
network access.
