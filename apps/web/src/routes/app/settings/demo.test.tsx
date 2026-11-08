import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, json, mockApi, on, renderAt, resetHarness } from "@/test/harness";
import { useToastStore } from "@/stores/toast";

afterEach(resetHarness);

const STATUS = {
  demo_mode: true,
  organisation: { id: "ORG1", name: "Northstar University" },
  counts: { scans: 7, reports: 2, campaigns: 1, investigations: 3, incidents: 1 },
  last_seeded_at: "2026-11-08T10:00:00Z",
};

describe("operator demo controls (UI_UX §15)", () => {
  it(
    "shows counts and resets after confirmation",
    async () => {
      const api = mockApi("operator", [
        on("GET", "/api/v1/admin/demo", () => json(STATUS)),
        on("POST", "/api/v1/admin/demo/reset", () => json({ ...STATUS, counts: { ...STATUS.counts, scans: 4 } })),
      ]);
      renderAt("/app/settings");
      const user = userEvent.setup();
      const card = (await screen.findByRole("heading", { name: "Demo" }, LONG)).closest("section, div") as HTMLElement;
      expect(await within(document.body).findByText("Northstar University", { exact: false })).toBeTruthy();
      expect(within(document.body).getByText("Investigations")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Reset demo data…" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Reset demo data" }));
      await waitFor(() => expect(api.find("POST", "/api/v1/admin/demo/reset")).toBeTruthy());
      expect(api.find("POST", "/api/v1/admin/demo/reset")?.headers["Idempotency-Key"]).toBeTruthy();
      await waitFor(() =>
        expect(useToastStore.getState().toasts.some((t) => t.title === "Demo data reset")).toBe(true),
      );
      expect(card).toBeTruthy();
    },
    15_000,
  );

  it(
    "is hidden from non-operators and never asks the API",
    async () => {
      const api = mockApi("user", []);
      renderAt("/app/settings");
      await screen.findByRole("heading", { name: "Delete account" }, LONG);
      expect(screen.queryByRole("heading", { name: "Demo" })).toBeNull();
      expect(api.find("GET", "/api/v1/admin/demo")).toBeUndefined();
    },
    15_000,
  );

  it(
    "is hidden when the API is not in demo mode",
    async () => {
      const api = mockApi("operator", [on("GET", "/api/v1/admin/demo", () => json({ ...STATUS, demo_mode: false }))]);
      renderAt("/app/settings");
      await waitFor(() => expect(api.find("GET", "/api/v1/admin/demo")).toBeTruthy(), LONG);
      await screen.findByRole("heading", { name: "Delete account" }, LONG);
      expect(screen.queryByRole("heading", { name: "Demo" })).toBeNull();
    },
    15_000,
  );
});
