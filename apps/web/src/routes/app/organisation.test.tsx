import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, apiError, json, mockApi, noContent, on, renderAt, resetHarness } from "@/test/harness";
import { normaliseDomainInput } from "@/lib/validation/domain";
import { previewRecipient } from "./organisation/RecipientsTab";
import { diffProfile } from "./organisation/ProfileTab";
import { validateOrganisation } from "./Organisations";

const ORG = {
  id: "ORG1",
  name: "Northstar University",
  legal_name: "Northstar University Trust",
  country: "IN",
  sector: "education",
  support_email: "security@northstar-demo.example",
  status: "draft",
  brand_tokens: ["northstar"],
  logo_phash: null,
  login_hosts_mode: "domain_wildcard",
  simulated: false,
  role: "org_admin",
  domains: [],
  recipients: [],
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const DOMAIN = {
  id: "D1",
  domain: "northstar-demo.example",
  kind: "official",
  status: "pending",
  verified_at: null,
  expires_at: null,
  verification_method: null,
};

const CHALLENGES = [
  {
    method: "dns_txt",
    record_name: "_trustlens-challenge.northstar-demo.example",
    record_type: "TXT",
    record_value: "tl-verify=JBSWY3DPEHPK3PXP",
    expires_at: "2026-11-14T09:14:22Z",
  },
  {
    method: "http_file",
    url: "https://northstar-demo.example/.well-known/trustlens-verify.txt",
    file_content: "tl-verify=JBSWY3DPEHPK3PXP",
    expires_at: "2026-11-14T09:14:22Z",
  },
];

const ADMIN_ORGS = [{ id: "ORG1", name: "Northstar University", role: "org_admin" }];

afterEach(resetHarness);

describe("pure helpers", () => {
  it("normalises domain input like the server", () => {
    expect(normaliseDomainInput("https://Northstar-Demo.example/path?x=1")).toEqual({ value: "northstar-demo.example", error: null });
    expect(normaliseDomainInput("*.northstar.example").error).toMatch(/wildcards/i);
    expect(normaliseDomainInput("localhost").error).toMatch(/dot/i);
    expect(normaliseDomainInput("example.com:8443").error).toMatch(/port/i);
  });

  it("previews recipient normalisation", () => {
    expect(previewRecipient("upi_vpa", " Fees@Northstar-Demo ")).toEqual({ value: "fees@northstar-demo", error: null });
    expect(previewRecipient("iban", "gb82 west 1234 5698 7654 32").value).toBe("GB82WEST12345698765432");
    expect(previewRecipient("payment_link", "http://pay.example").error).toMatch(/https/);
  });

  it("validates organisation drafts", () => {
    expect(validateOrganisation({ name: "N", legal_name: "", country: "", sector: "", support_email: "" }).name).toBeTruthy();
    expect(validateOrganisation({ name: "Northstar", legal_name: "", country: "IND", sector: "", support_email: "x" })).toMatchObject({
      country: expect.any(String),
      support_email: expect.any(String),
    });
  });

  it("sends only changed profile fields", () => {
    const body = diffProfile(ORG, {
      name: "Northstar University",
      legal_name: "Northstar University Trust",
      country: "in",
      sector: "education",
      support_email: "security@northstar-demo.example",
      brand_tokens: ["northstar", "nsu"],
      login_hosts_mode: "explicit_only",
    });
    expect(body).toEqual({ brand_tokens: ["northstar", "nsu"], login_hosts_mode: "explicit_only" });
  });
});

describe("organisations", () => {
  it("creates an organisation and opens its domains tab", async () => {
    const api = mockApi("user", [
      on("GET", "/api/v1/organisations", () => json({ data: [] })),
      on("POST", "/api/v1/organisations", (c) => json({ ...ORG, ...(c.body as object) }, 201)),
      on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
      on("GET", "/api/v1/organisations/ORG1/domains", () => json({ data: [] })),
    ]);
    const { router } = renderAt("/app/organisations");
    const buttons = await screen.findAllByRole("button", { name: /create organisation/i }, LONG);
    await userEvent.click(buttons[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: /create organisation/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /create organisation/i }));
    expect(await within(dialog).findByText(/at least 2 characters/i)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/display name/i), "Northstar University");
    await userEvent.type(within(dialog).getByLabelText(/^country/i), "in");
    await userEvent.click(within(dialog).getByRole("button", { name: /create organisation/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/organisations/ORG1"));
    expect(router.state.location.search).toBe("?tab=domains");
    expect(api.find("POST", "/api/v1/organisations")?.body).toEqual({ name: "Northstar University", country: "IN" });
    expect(await screen.findByText("Organisation created")).toBeInTheDocument();
  });

  it("explains NO_VERIFIED_DOMAIN when publishing", async () => {
    mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
        on("PATCH", "/api/v1/organisations/ORG1", () =>
          apiError("NO_VERIFIED_DOMAIN", 409, "Verify a domain before publishing."),
        ),
      ],
      ADMIN_ORGS,
    );
    renderAt("/app/organisations/ORG1");
    await userEvent.click(await screen.findByRole("button", { name: /publish profile/i }, LONG));
    const dialog = await screen.findByRole("dialog", { name: /publish this profile/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /publish profile/i }));
    expect(await within(dialog).findByText(/the status did not change/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/verify at least one domain before publishing/i).length).toBeGreaterThan(0);
  });

  it("hides management controls from organisation members", async () => {
    mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json({ ...ORG, role: "org_member" })),
        on("GET", "/api/v1/organisations/ORG1/domains", () => json({ data: [{ ...DOMAIN, status: "verified" }] })),
      ],
      [{ id: "ORG1", name: "Northstar University", role: "org_member" }],
    );
    renderAt("/app/organisations/ORG1?tab=domains");
    expect(await screen.findByText("northstar-demo.example", {}, LONG)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add domain/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});

describe("domains", () => {
  it("adds a domain, shows the challenge, maps a token mismatch, then verifies", async () => {
    let attempts = 0;
    let verified = false;
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
        on("GET", "/api/v1/organisations/ORG1/domains", () =>
          json({ data: verified ? [{ ...DOMAIN, status: "verified", verified_at: "2026-11-08T10:00:00Z" }] : [] }),
        ),
        on("POST", "/api/v1/organisations/ORG1/domains", () => json({ ...DOMAIN, challenges: CHALLENGES }, 201)),
        on("POST", "/api/v1/organisations/ORG1/domains/D1/verify", () => {
          attempts += 1;
          if (attempts === 1)
            return apiError("VERIFICATION_TOKEN_MISMATCH", 422, "The record value does not match.", [
              { field: "method", issue: "token_mismatch", observed: "tl-verify=WRONG" },
            ]);
          verified = true;
          return json({ id: "D1", domain: DOMAIN.domain, status: "verified", verification_method: "dns_txt", verified_at: "2026-11-08T10:00:00Z", expires_at: "2027-05-07T10:00:00Z", evidence_id: "E1" });
        }),
      ],
      ADMIN_ORGS,
    );
    renderAt("/app/organisations/ORG1?tab=domains");
    const add = await screen.findAllByRole("button", { name: /add domain/i }, LONG);
    await userEvent.click(add[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: /add a domain/i });
    await userEvent.type(within(dialog).getByLabelText(/^domain/i), "https://Northstar-Demo.example/");
    expect(within(dialog).getByText(/will be saved as northstar-demo.example/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /add domain/i }));
    expect(api.find("POST", "/api/v1/organisations/ORG1/domains")?.body).toEqual({ domain: "northstar-demo.example", kind: "official" });

    const verify = await screen.findByRole("dialog", { name: /verify northstar-demo.example/i });
    expect(within(verify).getByText("_trustlens-challenge.northstar-demo.example")).toBeInTheDocument();
    expect(within(verify).getAllByText("tl-verify=JBSWY3DPEHPK3PXP").length).toBe(2);
    expect(within(verify).getByText("https://northstar-demo.example/.well-known/trustlens-verify.txt")).toBeInTheDocument();

    await userEvent.click(within(verify).getByRole("button", { name: /verify now/i }));
    expect(await within(verify).findByText(/copy the value again exactly/i)).toBeInTheDocument();
    expect(within(verify).getByText("tl-verify=WRONG")).toBeInTheDocument();

    await userEvent.click(within(verify).getByRole("radio", { name: /https file/i }));
    await userEvent.click(within(verify).getByRole("button", { name: /verify now/i }));
    expect(await screen.findByText("Domain verified")).toBeInTheDocument();
    expect(api.find("POST", "/api/v1/organisations/ORG1/domains/D1/verify")?.body).toEqual({ method: "http_file" });
    await waitFor(() => expect(screen.getAllByText("Verified").length).toBeGreaterThanOrEqual(2));
  });

  it("requires typing the domain before removing it", async () => {
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
        on("GET", "/api/v1/organisations/ORG1/domains", () => json({ data: [{ ...DOMAIN, status: "verified" }] })),
        on("DELETE", "/api/v1/organisations/ORG1/domains/D1", () => noContent()),
      ],
      ADMIN_ORGS,
    );
    renderAt("/app/organisations/ORG1?tab=domains");
    await userEvent.click(await screen.findByRole("button", { name: /remove northstar-demo.example/i }, LONG));
    const dialog = await screen.findByRole("dialog", { name: /remove this domain/i });
    const confirm = within(dialog).getByRole("button", { name: /remove domain/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/type northstar-demo.example to confirm/i), "northstar-demo.example");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(api.find("DELETE", "/api/v1/organisations/ORG1/domains/D1")).toBeDefined());
    expect(await screen.findByText("Domain removed")).toBeInTheDocument();
  });
});

describe("recipients", () => {
  it("revokes a recipient after confirmation and lets analysts attest", async () => {
    const api = mockApi(
      "analyst",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json({ ...ORG, role: null })),
        on("GET", "/api/v1/organisations/ORG1/recipients", () =>
          json({
            data: [
              { id: "R1", type: "upi_vpa", handle: "fees@northstar-demo", label: "Fees", status: "verified", verified_at: "2026-11-01T00:00:00Z" },
              { id: "R2", type: "upi_vpa", handle: "hostel@northstar-demo", label: null, status: "pending_attestation", verified_at: null },
            ],
          }),
        ),
        on("POST", "/api/v1/organisations/ORG1/recipients/R2/verify", () => json({ id: "R2", type: "upi_vpa", handle: "hostel@northstar-demo", status: "verified", verified_at: "x" })),
      ],
    );
    renderAt("/app/organisations/ORG1?tab=recipients");
    expect(await screen.findByText("fees@northstar-demo", {}, LONG)).toBeInTheDocument();
    // Analysts attest but do not manage the profile.
    expect(screen.queryByRole("button", { name: /remove fees@northstar-demo/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /attest hostel@northstar-demo/i }));
    const dialog = await screen.findByRole("dialog", { name: /attest payment recipient/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^attest$/i }));
    expect(within(dialog).getByText(/at least 10 characters/i)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), "Confirmed by phone with the bursar's office.");
    await userEvent.click(within(dialog).getByRole("button", { name: /^attest$/i }));
    await waitFor(() =>
      expect(api.find("POST", "/api/v1/organisations/ORG1/recipients/R2/verify")?.body).toEqual({
        action: "verify",
        reason: "Confirmed by phone with the bursar's office.",
      }),
    );
  });

  it("lets an admin revoke a recipient", async () => {
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
        on("GET", "/api/v1/organisations/ORG1/recipients", () =>
          json({ data: [{ id: "R1", type: "upi_vpa", handle: "fees@northstar-demo", label: "Fees", status: "verified", verified_at: null }] }),
        ),
        on("DELETE", "/api/v1/organisations/ORG1/recipients/R1", () => noContent()),
      ],
      ADMIN_ORGS,
    );
    renderAt("/app/organisations/ORG1?tab=recipients");
    await userEvent.click(await screen.findByRole("button", { name: /remove fees@northstar-demo/i }, LONG));
    const dialog = await screen.findByRole("dialog", { name: /revoke this payment recipient/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /revoke recipient/i }));
    await waitFor(() => expect(api.find("DELETE", "/api/v1/organisations/ORG1/recipients/R1")).toBeDefined());
    expect(await screen.findByText("Payment recipient revoked")).toBeInTheDocument();
  });
});

describe("members", () => {
  const MEMBERS = {
    data: [
      { user_id: "U-USER", email: "student@trustlens.local", display_name: "Admin One", role: "org_admin", created_at: "2026-11-01T00:00:00Z" },
      { user_id: "U2", email: "two@northstar-demo.example", display_name: "Member Two", role: "org_member", created_at: "2026-11-02T00:00:00Z" },
    ],
    invites: [{ id: "I1", email: "pending@northstar-demo.example", role: "org_member", expires_at: "2026-11-15T00:00:00Z", created_at: "2026-11-08T00:00:00Z", invited_by: "U-USER" }],
  };

  it("invites a member, shows the share link when email is not sent, and protects the last admin", async () => {
    const api = mockApi(
      "user",
      [
        on("GET", "/api/v1/organisations/ORG1", () => json(ORG)),
        on("GET", "/api/v1/organisations/ORG1/members", () => json(MEMBERS)),
        on("POST", "/api/v1/organisations/ORG1/members", () =>
          json({ invite_id: "I2", email: "new@northstar-demo.example", role: "org_admin", expires_at: "2026-11-15T00:00:00Z", delivery: "logged", accept_url: "http://localhost:5173/invites/TOKEN123" }, 201),
        ),
        on("PATCH", "/api/v1/organisations/ORG1/members/U2", () => apiError("LAST_ADMIN_REMOVAL", 409, "Cannot remove the last admin.")),
        on("DELETE", "/api/v1/organisations/ORG1/invites/I1", () => noContent()),
      ],
      ADMIN_ORGS,
    );
    renderAt("/app/organisations/ORG1?tab=members");
    expect(await screen.findByText("Admin One", {}, LONG)).toBeInTheDocument();
    expect(screen.getByText("Last administrator")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /role for student@trustlens.local/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove student@trustlens.local/i })).toBeDisabled();
    expect(screen.getByText("pending@northstar-demo.example")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /invite member/i }));
    const dialog = await screen.findByRole("dialog", { name: /invite a member/i });
    await userEvent.type(within(dialog).getByLabelText(/^email/i), "new@northstar-demo.example");
    await userEvent.selectOptions(within(dialog).getByLabelText(/^role/i), "org_admin");
    await userEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));
    expect(await within(dialog).findByText("http://localhost:5173/invites/TOKEN123")).toBeInTheDocument();
    expect(api.find("POST", "/api/v1/organisations/ORG1/members")?.body).toEqual({ email: "new@northstar-demo.example", role: "org_admin" });
    await userEvent.click(within(dialog).getByRole("button", { name: /done/i }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /role for two@northstar-demo.example/i }), "org_admin");
    expect(await screen.findByText(/must keep at least one administrator/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /revoke invitation for pending@northstar-demo.example/i }));
    await waitFor(() => expect(api.find("DELETE", "/api/v1/organisations/ORG1/invites/I1")).toBeDefined());
  });

  it("accepts an invitation from the emailed link", async () => {
    const api = mockApi("user", [
      on("POST", "/api/v1/invites/TOKEN123/accept", () => json({ organisation_id: "ORG1", organisation_name: "Northstar University", role: "org_member" })),
      on("GET", "/api/v1/organisations/ORG1", () => json({ ...ORG, role: "org_member" })),
    ]);
    const { router } = renderAt("/invites/TOKEN123");
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/organisations/ORG1"), LONG);
    expect(api.calls.filter((c) => c.path === "/api/v1/invites/TOKEN123/accept")).toHaveLength(1);
  });

  it("explains an invitation for a different email", async () => {
    mockApi("user", [on("POST", "/api/v1/invites/BAD/accept", () => apiError("INVITE_EMAIL_MISMATCH", 403, "Wrong account."))]);
    renderAt("/app/invites/BAD");
    expect(await screen.findByText(/sent to a different email address/i, {}, LONG)).toBeInTheDocument();
  });
});
