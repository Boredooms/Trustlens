import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, json, mockApi, noContent, on, renderAt, resetHarness } from "@/test/harness";
import { DECISIONS } from "./InfoPages";

afterEach(resetHarness);

describe("public information pages", () => {
  it("how it works lists the five steps and what we cannot see", async () => {
    renderAt("/how-it-works");
    expect(await screen.findByRole("heading", { level: 1, name: "How it works" }, LONG)).toBeInTheDocument();
    for (const step of ["Observe", "Collect", "Compare", "Decide", "Explain"]) {
      expect(screen.getByRole("heading", { name: step })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "What we cannot see" })).toBeInTheDocument();
  });

  it("developers page explains all five decisions without promising safety", async () => {
    renderAt("/developers");
    expect(await screen.findByRole("heading", { level: 1, name: "Developers" }, LONG)).toBeInTheDocument();
    expect(DECISIONS.map(([d]) => d)).toEqual(["BLOCK", "WARN", "REVIEW", "UNKNOWN", "ALLOW"]);
    const table = screen.getByRole("table");
    for (const [d] of DECISIONS) expect(within(table).getByText(d)).toBeInTheDocument();
    // The page content itself (the shared footer deliberately says "we never say a site is safe").
    expect(document.querySelector("article")?.textContent ?? "").not.toMatch(/\bsafe\b/i);
    expect(screen.getByRole("link", { name: "Create an API key" })).toHaveAttribute("href", "/app/developers");
  });

  it("security page states limitations and links to appeals", async () => {
    renderAt("/security");
    expect(await screen.findByRole("heading", { name: "Limitations" }, LONG)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "appeal the decision" })).toHaveAttribute("href", "/appeal");
  });

  it("footer links reach every public page", async () => {
    renderAt("/");
    const footer = await screen.findByRole("navigation", { name: "Footer" }, LONG);
    for (const [name, href] of [
      ["How it works", "/how-it-works"],
      ["Developers", "/developers"],
      ["Security", "/security"],
      ["Appeal a decision about your site", "/appeal"],
    ]) {
      expect(within(footer).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("/register falls back to the development sign-in when Clerk is not configured", async () => {
    const { router } = renderAt("/register?next=/app/scan");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Fapp%2Fscan");
  });
});

describe("settings security", () => {
  it("lists paired browsers and revokes one", async () => {
    let devices = [
      { id: "DEV1", name: "Chrome on laptop", last_used_at: null, created_at: "2026-11-01T00:00:00Z", expires_at: null },
    ];
    const api = mockApi("user", [
      on("GET", "/api/v1/auth/extension/devices", () => json({ data: devices })),
      on("DELETE", "/api/v1/auth/extension/devices/DEV1", () => {
        devices = [];
        return noContent();
      }),
    ]);
    renderAt("/app/settings");
    expect(await screen.findByText("Chrome on laptop", undefined, LONG)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(api.find("DELETE", "/api/v1/auth/extension/devices/DEV1")).toBeTruthy());
    expect(await screen.findByText("No paired devices")).toBeInTheDocument();
  });
});
