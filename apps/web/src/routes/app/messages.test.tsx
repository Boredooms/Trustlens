import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, apiError, json, mockApi, on, renderAt, resetHarness } from "@/test/harness";

afterEach(resetHarness);

const base = {
  id: "01M6YETXP1J9G7ABQ8MTBVXRZZ",
  risk_level: "LOW",
  coverage: { percent: 60, collected: ["identity", "credential_destination", "payment_destination"], unavailable: [], skipped: ["reputation", "infrastructure"] },
  reasons: ["The message uses pressure (deadline, threat); language alone is not proof."],
  claimed_organisation: null,
  indicators: { urls: [], emails: [], sender_domain: null, phones: [], payees: [] },
  links: [],
  correlation: { same_text_count: 0, shared_link_domains: [] },
  narrative: { source: "template", sections: [{ heading: "What to do", claims: [{ text: "Do not act on the pressure in this message.", refs: [] }] }] },
  channel: "sms",
  engine_version: "1.1.0",
  simulated: false,
  analysed_at: "2026-11-09T10:00:00Z",
};

describe("message analysis page", () => {
  it("shows a REVIEW result for pressure language alone and explains O-8", async () => {
    const api = mockApi("user", [
      on("POST", "/api/v1/messages/analyse", () =>
        json({
          ...base,
          decision: "REVIEW",
          risk_score: 3,
          risk_class: "suspicious",
          caveat: null,
          overrides: ["O-8"],
          findings: [
            { code: "MESSAGE_URGENCY_PRESSURE", signal_group: "identity", severity: "low", confidence: 0.8, title: "Message uses pressure or urgency", detail: "Pressure language: deadline, threat.", rule_id: "R-MSG-05", observed: { categories: ["deadline"] }, expected: null, simulated: false },
          ],
        }),
      ),
    ]);
    renderAt("/app/messages");
    await userEvent.click(await screen.findByRole("button", { name: "Urgent wording, no evidence" }, LONG));
    await userEvent.click(screen.getByRole("button", { name: "Analyse message" }));
    expect(await screen.findByText("Suspicious", {}, LONG)).toBeInTheDocument();
    expect(screen.getByText(/language alone is never treated as proof/)).toBeInTheDocument();
    expect(screen.getByText("MESSAGE_URGENCY_PRESSURE")).toBeInTheDocument();
    const call = api.calls.find((c) => c.path === "/api/v1/messages/analyse");
    expect((call?.body as { text: string; channel: string }).channel).toBe("sms");
  });

  it("shows a blocked link with a route to its scan report, and the low-risk caveat when allowed", async () => {
    mockApi("user", [
      on("POST", "/api/v1/messages/analyse", () =>
        json({
          ...base,
          decision: "ALLOW",
          risk_score: 12,
          risk_class: "low",
          caveat: "Absence of evidence is not evidence of safety.",
          overrides: [],
          findings: [],
          links: [{ url: "https://pay.northstar-demo.example/fees", registrable_domain: "northstar-demo.example", scan_id: "01M6YETXP1J9G7ABQ8MTBVXRAA", decision: "ALLOW", finding_codes: [], error: null, simulated: true }],
        }),
      ),
    ]);
    renderAt("/app/messages");
    await userEvent.type(await screen.findByLabelText(/Message text/, {}, LONG), "Fee reminder");
    await userEvent.click(screen.getByRole("button", { name: "Analyse message" }));
    expect(await screen.findByText("Low risk", {}, LONG)).toBeInTheDocument();
    expect(screen.getByText("Absence of evidence is not evidence of safety.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the scan report" })).toHaveAttribute("href", "/app/scan/01M6YETXP1J9G7ABQ8MTBVXRAA");
  });

  it("validates empty input and surfaces API errors", async () => {
    const api = mockApi("user", [on("POST", "/api/v1/messages/analyse", () => apiError("RATE_LIMITED", 429, "Too many requests."))]);
    renderAt("/app/messages");
    await userEvent.click(await screen.findByRole("button", { name: "Analyse message" }, LONG));
    // The textarea is required: an empty form never reaches the API.
    expect(api.calls.some((c) => c.path === "/api/v1/messages/analyse")).toBe(false);
    await userEvent.type(screen.getByLabelText(/Message text/), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Analyse message" }));
    expect(await screen.findByText("The message was not analysed", {}, LONG)).toBeInTheDocument();
  });
});
