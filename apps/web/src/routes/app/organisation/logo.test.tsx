import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LONG, json, mockApi, on, renderAt, resetHarness } from "@/test/harness";
import type * as Phash from "@/lib/image/phash";

// jsdom has no canvas: hash the file deterministically instead of decoding it.
vi.mock("@/lib/image/phash", async (importActual) => ({
  ...(await importActual<typeof Phash>()),
  phashFromFile: vi.fn(async () => "c3a5f00f0ff00a5c"),
}));

afterEach(resetHarness);

const ORG = {
  id: "ORG1",
  name: "Northstar University",
  legal_name: null,
  country: "IN",
  sector: "education",
  support_email: null,
  status: "draft",
  brand_tokens: ["northstar"],
  logo_phash: null as string | null,
  login_hosts_mode: "domain_wildcard",
  simulated: false,
  role: "org_admin",
  domains: [],
  recipients: [],
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

describe("organisation logo", () => {
  it("rejects unsupported files, hashes a PNG in the browser and saves only the fingerprint", async () => {
    let org = { ...ORG };
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(org)),
        on("PATCH", "/api/v1/organisations/ORG1", (c) => {
          org = { ...org, ...(c.body as object), updated_at: "2026-11-08T00:00:00Z" };
          return json(org);
        }),
      ],
      [{ id: "ORG1", name: "Northstar University", role: "org_admin" }],
    );
    renderAt("/app/organisations/ORG1?tab=profile");
    const input = (await screen.findByLabelText(/upload logo/i, undefined, LONG)) as HTMLInputElement;
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(input, new File(["GIF89a"], "logo.gif", { type: "image/gif" }));
    expect(await screen.findByText("Use a PNG, JPEG or SVG image.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save logo" })).toBeDisabled();

    await user.upload(input, new File([new Uint8Array(2 * 1024 * 1024)], "big.png", { type: "image/png" }));
    expect(await screen.findByText("The logo must be 1 MB or smaller.")).toBeInTheDocument();

    await user.upload(input, new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
    expect(await screen.findByText("New fingerprint: c3a5f00f0ff00a5c")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save logo" }));
    await waitFor(() => expect(api.find("PATCH", "/api/v1/organisations/ORG1")?.body).toEqual({ logo_phash: "c3a5f00f0ff00a5c" }));
    await waitFor(() => expect(screen.getByTestId("current-phash")).toHaveTextContent("c3a5f00f0ff00a5c"));

    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    await waitFor(() => expect(api.find("PATCH", "/api/v1/organisations/ORG1")?.body).toEqual({ logo_phash: null }));
    await waitFor(() => expect(screen.getByTestId("current-phash")).toHaveTextContent("none"));
  }, 20_000);
});
