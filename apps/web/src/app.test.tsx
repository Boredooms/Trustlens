import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { TooltipProvider } from "@/components/ui/Overlay";
import { DEV_TOKEN_KEY } from "@/lib/auth/token";
import { routes } from "./app";

// Integration smoke test: the demo path (sign in → overview → scan report → investigation) against a mocked API.

const SCAN = {
  id: "SCAN1",
  status: "completed",
  url: "https://apply.northstar-admissions.example/register",
  intent: "payment",
  decision: "BLOCK",
  risk_level: "CRITICAL",
  risk_score: 62,
  coverage: { percent: 85, collected: ["reputation", "identity", "payment_destination", "infrastructure"], unavailable: ["credential_destination"], skipped: [] },
  reasons: ["The payment address fees@okaxis is not one registered by Northstar University."],
  overrides: ["O-2"],
  engine_version: "1.0.0",
  result: {
    tls: { presented: true, verified: true, issuer: "R3", days_to_expiry: 89 },
    action: { intent: "payment", observed_destination: "https://collect.badhost.example/pay", expected_destinations: ["pay.northstar-demo.example"], payee: "fees@okaxis", match: "none" },
  },
  findings: [
    {
      id: "F1",
      code: "PAYEE_NOT_IN_VERIFIED_PROFILE",
      signal_group: "payment_destination",
      severity: "critical",
      confidence: 1,
      title: "Payment address is not registered by the organisation",
      detail: "The page asks for a transfer to fees@okaxis.",
      observed: { payee: "fees@okaxis" },
      expected: { payees: ["fees@northstar-demo"] },
      evidence_refs: ["E1"],
      rule_id: "R-PAY-01",
    },
  ],
  evidence: [{ id: "E1", source: "page", observed_at: "2026-11-07T09:14:22Z", summary: "Payee string fees@okaxis in form" }],
  created_at: "2026-11-07T09:14:10Z",
  completed_at: "2026-11-07T09:14:22Z",
};

const INVESTIGATION = {
  id: "INV1",
  scan_id: "SCAN1",
  status: "completed",
  decision_context: { decision: "BLOCK", risk_level: "CRITICAL", risk_score: 62 },
  steps: [{ name: "collect_tls", status: "completed", duration_ms: 812 }],
  narrative: { sections: [{ heading: "What this page does", claims: [{ text: "The page asks for a payment to fees@okaxis.", refs: ["F-2"] }] }] },
  references: [{ id: "F-2", kind: "finding", finding_id: "F1" }],
  dropped_claims: [],
  ai: { generated: false },
  created_at: "2026-11-07T09:15:00Z",
  completed_at: "2026-11-07T09:15:05Z",
};

const OVERVIEW = {
  recent_scans: [{ id: "SCAN1", url: SCAN.url, decision: "BLOCK", risk_level: "CRITICAL", created_at: SCAN.created_at }],
  high_risk_domains: null,
  certificate_alerts: [],
  campaigns: [],
  report_queue: { pending: 2, reviewing: 0 },
  quota: null,
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("demo path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const p = url.pathname;
      if (p === "/api/v1/auth/me")
        return respond({ id: "U1", email: "analyst@trustlens.local", display_name: "Analyst", role: "analyst", organisations: [], created_at: "x", last_login_at: null });
      if (p === "/api/v1/overview") return respond(OVERVIEW);
      if (p === "/api/v1/scans/SCAN1") return respond(SCAN);
      if (p === "/api/v1/investigations/INV1") return respond(INVESTIGATION);
      return respond({ error: { code: "NOT_FOUND", message: "Not found", request_id: "req_x" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs in with the development panel and shows the overview with a per-block failure", async () => {
    renderAt("/app");
    const analyst = await screen.findByRole("button", { name: /continue as analyst/i }, { timeout: 8000 });
    await userEvent.click(analyst);
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" }, { timeout: 8000 })).toBeInTheDocument();
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBe("dev:analyst@trustlens.local:analyst");
    expect(await screen.findByText(/could not load high-risk domains/i)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/v1/overview"));
    const init = call?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer dev:analyst@trustlens.local:analyst");
  });

  it("renders the scan report verdict, override and observed vs expected", async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, "dev:analyst@trustlens.local:analyst");
    renderAt("/app/scan/SCAN1");
    expect(await screen.findByRole("heading", { level: 2, name: "Blocked" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Decision: blocked. Risk: critical." }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /O-2/ })).toBeInTheDocument();
    expect(screen.getByText(/This page asks for fees@okaxis\. The organisation has registered fees@northstar-demo\./)).toBeInTheDocument();
    const findings = screen.getByRole("heading", { name: /Findings/ }).closest("section");
    expect(findings).not.toBeNull();
    expect(within(findings as HTMLElement).getAllByText("fees@okaxis").length).toBeGreaterThan(0);
  });

  it("renders the investigation with rule-decided context, template label and a resolvable reference", async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, "dev:analyst@trustlens.local:analyst");
    renderAt("/app/investigations/INV1");
    expect(await screen.findByText("Decided by rules — the narrative cannot change it", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText("Deterministic template — no AI used")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /\[F-2\] Finding · Payment address is not registered/ })).toHaveAttribute(
      "href",
      "/app/scan/SCAN1?finding=F1",
    );
  });
});
