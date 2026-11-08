import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, apiError, mockApi, noContent, on, renderAt, resetHarness } from "@/test/harness";
import { ApiError } from "@/lib/api/errors";
import { useToastStore } from "@/stores/toast";
import { blockingOrganisations } from "./settings/DeleteAccount";

afterEach(resetHarness);

const EMAIL = "student@trustlens.local";

describe("account deletion (J11)", () => {
  it("lists organisations from LAST_ADMIN_REMOVAL details", () => {
    const err = new ApiError({
      code: "LAST_ADMIN_REMOVAL",
      status: 409,
      message: "x",
      details: [{ organisation_id: "ORG1", name: "Northstar University" }],
    });
    expect(blockingOrganisations(err)).toEqual([{ id: "ORG1", name: "Northstar University" }]);
    expect(blockingOrganisations(new ApiError({ code: "NOT_FOUND", status: 404, message: "x" }))).toEqual([]);
  });

  it(
    "requires typing the account email, deletes, signs out and lands on the home page",
    async () => {
      const api = mockApi("user", [on("DELETE", "/api/v1/auth/me", () => noContent()), on("POST", "/api/v1/auth/logout", () => noContent())]);
      const { router } = renderAt("/app/settings");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Delete account…" }, LONG));
      const dialog = await screen.findByRole("dialog");
      const confirm = within(dialog).getByRole("button", { name: "Delete account" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByRole("textbox"), "someone@else.example");
      expect(confirm).toBeDisabled();
      await user.clear(within(dialog).getByRole("textbox"));
      await user.type(within(dialog).getByRole("textbox"), EMAIL);
      expect(confirm).toBeEnabled();
      await user.click(confirm);
      await waitFor(() => expect(api.find("DELETE", "/api/v1/auth/me")?.body).toEqual({ confirm_email: EMAIL }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(useToastStore.getState().toasts.some((t) => t.title === "Your account was deleted")).toBe(true);
      expect(sessionStorage.length).toBe(0);
    },
    15_000,
  );

  it(
    "explains which organisations need a new administrator when the server refuses",
    async () => {
      mockApi(
        "user",
        [
          on("DELETE", "/api/v1/auth/me", () =>
            apiError("LAST_ADMIN_REMOVAL", 409, "Transfer ownership first.", [
              { organisation_id: "ORG1", name: "Northstar University" },
            ]),
          ),
        ],
        [{ id: "ORG1", name: "Northstar University", role: "org_admin" }],
      );
      const { router } = renderAt("/app/settings");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Delete account…" }, LONG));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox"), EMAIL);
      await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
      const alert = await screen.findByText("Transfer ownership first");
      const link = within(alert.closest("[role=alert]") as HTMLElement).getByRole("link", { name: "Northstar University" });
      expect(link).toHaveAttribute("href", "/app/organisations/ORG1?tab=members");
      expect(router.state.location.pathname).toBe("/app/settings");
    },
    15_000,
  );
});
