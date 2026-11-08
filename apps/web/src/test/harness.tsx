import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { TooltipProvider } from "@/components/ui/Overlay";
import { DEV_TOKEN_KEY } from "@/lib/auth/token";
import { useToastStore } from "@/stores/toast";
import { routes } from "@/app";

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export type Handler = (call: Call) => Response | Promise<Response> | undefined;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function apiError(code: string, status: number, message = "Request failed", details?: unknown): Response {
  return json({ error: { code, message, request_id: "req_test", ...(details ? { details } : {}) } }, status);
}

export const PERSONAS = {
  user: { id: "U-USER", email: "student@trustlens.local", display_name: "Student", role: "user" },
  analyst: { id: "U-ANALYST", email: "analyst@trustlens.local", display_name: "Analyst", role: "analyst" },
  operator: { id: "U-OP", email: "operator@trustlens.local", display_name: "Operator", role: "operator" },
} as const;

export interface MockApi {
  calls: Call[];
  find: (method: string, path: string) => Call | undefined;
}

/**
 * Stubs fetch with a list of handlers tried in order; the first non-undefined response wins.
 * /auth/me and /overview have defaults so the app shell renders.
 */
export function mockApi(
  persona: keyof typeof PERSONAS,
  handlers: Handler[],
  orgs: Array<{ id: string; name: string; role: string }> = [],
): MockApi {
  const calls: Call[] = [];
  const me = { ...PERSONAS[persona], organisations: orgs, created_at: "2026-11-01T00:00:00Z", last_login_at: null };
  sessionStorage.setItem(DEV_TOKEN_KEY, `dev:${me.email}:${me.role}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      let body: unknown = undefined;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const call: Call = {
        method: (init?.method ?? "GET").toUpperCase(),
        path: url.pathname,
        query: url.searchParams,
        body,
        headers: (init?.headers as Record<string, string>) ?? {},
      };
      calls.push(call);
      for (const h of handlers) {
        const r = await h(call);
        if (r) return r;
      }
      if (call.path === "/api/v1/auth/me") return json(me);
      if (call.path === "/api/v1/overview")
        return json({ recent_scans: [], high_risk_domains: [], certificate_alerts: [], campaigns: [], report_queue: { pending: 0, reviewing: 0 }, quota: null });
      return apiError("NOT_FOUND", 404, "Not found");
    }),
  );
  return {
    calls,
    find: (method, path) => [...calls].reverse().find((c) => c.method === method && c.path === path),
  };
}

export function on(method: string, path: string | RegExp, respond: (call: Call) => Response | Promise<Response>): Handler {
  return (call) => {
    if (call.method !== method) return undefined;
    const match = typeof path === "string" ? call.path === path : path.test(call.path);
    return match ? respond(call) : undefined;
  };
}

export function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
  return { router, qc };
}

export function resetHarness() {
  sessionStorage.clear();
  useToastStore.setState({ toasts: [] });
  vi.unstubAllGlobals();
}

export const LONG = { timeout: 8000 };
