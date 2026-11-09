import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, apiError, json, mockApi, noContent, on, renderAt, resetHarness } from "@/test/harness";
import { lastSevenDays } from "@/components/domain/UsagePanel";
import { toApiFilters } from "./AuditLogs";

afterEach(resetHarness);

describe("helpers", () => {
  it("zero-fills the last seven days of usage", () => {
    const days = lastSevenDays(
      { data: [{ day: "2026-11-08", endpoint_group: null, count: 5 }, { day: "2026-11-06", endpoint_group: null, count: 2 }], period: { from: "", to: "" }, quota: null },
      new Date("2026-11-08T12:00:00Z"),
    );
    expect(days).toHaveLength(7);
    expect(days[0]?.day).toBe("2026-11-02");
    expect(days.map((d) => d.count)).toEqual([0, 0, 0, 0, 2, 0, 5]);
  });

  it("turns date filters into whole UTC days", () => {
    expect(toApiFilters(new URLSearchParams("action=domain.verify&from=2026-11-01&to=2026-11-08&to2=x"))).toEqual({
      limit: 50,
      action: "domain.verify",
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-08T23:59:59Z",
    });
  });
});

describe("appeals", () => {
  it("lets a site owner appeal without an account and run the challenge check", async () => {
    sessionStorage.clear();
    const api = mockApi("user", [
      on("POST", "/api/v1/appeals", () =>
        json(
          {
            appeal_id: "AP1",
            status: "pending_challenge",
            challenge: { method: "dns_txt", record_name: "_trustlens-challenge.northstar-demo.example", record_type: "TXT", record_value: "tl-verify=ABC", expires_at: "2026-11-15T00:00:00Z", instructions: "Add this TXT record." },
          },
          201,
        ),
      ),
      on("POST", "/api/v1/appeals/AP1/verify", () => json({ appeal_id: "AP1", status: "challenge_verified", verified: true, attempts: 1, message: "Verified." })),
    ]);
    renderAt("/appeal?domain=northstar-demo.example");
    expect(await screen.findByLabelText(/your domain/i, {}, LONG)).toHaveValue("northstar-demo.example");
    await userEvent.type(screen.getByLabelText(/^email/i), "admin@northstar-demo.example");
    await userEvent.type(screen.getByLabelText(/what is wrong/i), "This is our official admissions site.");
    await userEvent.click(screen.getByRole("button", { name: /submit appeal/i }));
    expect(await screen.findByText("tl-verify=ABC")).toBeInTheDocument();
    const create = api.find("POST", "/api/v1/appeals");
    expect(create?.body).toEqual({ domain: "northstar-demo.example", email: "admin@northstar-demo.example", message: "This is our official admissions site.", challenge_method: "dns_txt" });
    expect(create?.headers.Authorization).toBeUndefined();
    await userEvent.click(screen.getByRole("button", { name: /check now/i }));
    expect(await screen.findByText(/control of northstar-demo.example confirmed/i)).toBeInTheDocument();
  });

  it("lets an analyst approve a proven appeal", async () => {
    const appeal = {
      id: "AP1",
      domain: "northstar-demo.example",
      email: "admin@northstar-demo.example",
      message: "This is our official site.",
      challenge_method: "dns_txt",
      status: "challenge_verified",
      attempts: 1,
      challenge_expires_at: "2026-11-15T00:00:00Z",
      challenge_verified_at: "2026-11-08T10:00:00Z",
      current_reputation: -40,
      open_reports: 2,
      review: null,
      created_at: "2026-11-08T09:00:00Z",
    };
    const api = mockApi("analyst", [
      on("GET", "/api/v1/appeals/AP1", () => json(appeal)),
      on("POST", "/api/v1/appeals/AP1/review", () => json({ ...appeal, status: "approved", review: { reason: "Owner proven", reputation_before: -40, reputation_after: -10 } })),
    ]);
    renderAt("/app/appeals/AP1");
    await userEvent.type(await screen.findByLabelText(/^reason/i, {}, LONG), "Owner proved control and the site is the official one.");
    await userEvent.click(screen.getByRole("button", { name: /approve appeal/i }));
    await waitFor(() => expect(api.find("POST", "/api/v1/appeals/AP1/review")?.body).toEqual({ action: "approve", reason: "Owner proved control and the site is the official one." }));
    expect(await screen.findByText("Appeal approved")).toBeInTheDocument();
  });
});

describe("certificates", () => {
  it("adds and removes a monitor", async () => {
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/certificates/monitors", () =>
          json({ data: [{ id: "M1", organisation_id: "ORG1", domain: "login.northstar-demo.example", enabled: true, current_certificate_id: "C1", issuer_cn: "R3", days_to_expiry: 21, last_checked_at: "2026-11-08T09:00:00Z" }] }),
        ),
        on("GET", "/api/v1/certificates/incidents", () => json({ data: [] })),
        on("GET", "/api/v1/organisations", () => json({ data: [{ id: "ORG1", name: "Northstar University", status: "active", role: "org_admin", verified_domains_count: 2 }] })),
        on("POST", "/api/v1/certificates/monitors", (c) => json({ id: "M2", ...(c.body as object), days_to_expiry: null, last_checked_at: null, current_certificate_id: null }, 201)),
        on("DELETE", "/api/v1/certificates/monitors/M1", () => noContent()),
      ],
      [{ id: "ORG1", name: "Northstar University", role: "org_admin" }],
    );
    renderAt("/app/certificates?tab=monitors");
    // The domain also appears in the "Hygiene — renew" posture lane (21 days left); assert the monitors table.
    const panel = await screen.findByRole("tabpanel", {}, LONG);
    expect(await within(panel).findByText("login.northstar-demo.example", {}, LONG)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /add monitor/i }));
    const dialog = await screen.findByRole("dialog", { name: /monitor a domain/i });
    await userEvent.type(within(dialog).getByLabelText(/^domain/i), "pay.northstar-demo.example");
    await userEvent.click(within(dialog).getByRole("button", { name: /add monitor/i }));
    await waitFor(() => expect(api.find("POST", "/api/v1/certificates/monitors")?.body).toEqual({ organisation_id: "ORG1", domain: "pay.northstar-demo.example" }));
    await userEvent.click(await screen.findByRole("button", { name: /remove monitor for login.northstar-demo.example/i }));
    const confirm = await screen.findByRole("dialog", { name: /stop monitoring/i });
    await userEvent.click(within(confirm).getByRole("button", { name: /remove monitor/i }));
    await waitFor(() => expect(api.find("DELETE", "/api/v1/certificates/monitors/M1")).toBeDefined());
  });

  it("renders certificate detail", async () => {
    mockApi("user", [
      on("GET", "/api/v1/certificates/C1", () =>
        json({
          id: "C1",
          fingerprint_sha256: "ab".repeat(32),
          subject_cn: "login.northstar-demo.example",
          issuer_cn: "Demo Intermediate CA",
          root_issuer_cn: "Demo Root",
          sans: ["login.northstar-demo.example"],
          not_before: "2026-10-01T00:00:00Z",
          not_after: "2026-12-30T00:00:00Z",
          days_to_expiry: 52,
          key_type: "EC",
          key_bits: 256,
          signature_algorithm: "ecdsa-with-SHA256",
          monitored_domain: "login.northstar-demo.example",
          simulated: true,
          is_self_signed: false,
          chain_length: 3,
          first_seen_at: "2026-10-02T00:00:00Z",
          last_seen_at: "2026-11-08T00:00:00Z",
          monitors: [],
        }),
      ),
    ]);
    renderAt("/app/certificates/C1");
    expect(await screen.findByRole("heading", { level: 1, name: "login.northstar-demo.example" }, LONG)).toBeInTheDocument();
    expect(screen.getByText("ab".repeat(32))).toBeInTheDocument();
    expect(screen.getAllByText(/simulated/i).length).toBeGreaterThan(0);
  });
});

describe("developers and audit", () => {
  it("shows usage with a quota meter", async () => {
    mockApi("user", [
      on("GET", "/api/v1/usage", () => json({ data: [{ day: new Date().toISOString().slice(0, 10), endpoint_group: null, count: 12 }], period: { from: "a", to: "b" }, quota: { limit: 60, used: 50, reset_at: "2026-11-09T00:00:00Z" } })),
      on("GET", "/api/v1/api-keys", () => json({ data: [] })),
      on("GET", "/api/v1/auth/extension/devices", () => json({ data: [] })),
    ]);
    renderAt("/app/developers");
    const meter = await screen.findByRole("meter", { name: /quota used/i }, LONG);
    expect(meter).toHaveAttribute("aria-valuetext", "50 of 60 requests used. Close to the limit.");
    expect(screen.getByText("12 total")).toBeInTheDocument();
  });

  it("shows the audit log to operators only, with pagination", async () => {
    const page1 = { data: [{ id: "A1", actor_user_id: "U-OP", actor_email: "operator@trustlens.local", actor_kind: "user", action: "domain.verify", target_type: "verified_domain", target_id: "D1", organisation_id: "ORG1", before: { status: "pending" }, after: { status: "verified" }, request_id: "req_1", created_at: "2026-11-08T10:00:00Z" }], page: { limit: 50, next_cursor: "A1" } };
    const page2 = { data: [{ ...page1.data[0], id: "A0", action: "domain.add" }], page: { limit: 50, next_cursor: null } };
    const api = mockApi("operator", [on("GET", "/api/v1/audit-logs", (c) => json(c.query.get("cursor") ? page2 : page1))]);
    renderAt("/app/audit");
    expect(await screen.findByText("domain.verify", {}, LONG)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /audit log/i }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(await screen.findByText("domain.add")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "/api/v1/audit-logs")).toHaveLength(2);
  });

  it("hides the audit log and appeals from regular users", async () => {
    mockApi("user", [on("GET", "/api/v1/audit-logs", () => apiError("FORBIDDEN", 403, "No"))]);
    renderAt("/app/audit");
    expect(await screen.findByText(/you do not have access to the audit log/i, {}, LONG)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /audit log/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /appeals/i })).toBeNull();
  });
});
