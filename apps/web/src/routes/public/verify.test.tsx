import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LONG, apiError, json, mockApi, on, renderAt, resetHarness } from "@/test/harness";

afterEach(resetHarness);

const RID = "01M6YETXP1J9G7ABQ8MTBVXRYZ";
const PAYLOAD = { schema: "trustlens.report-commitment.v1", report_id: RID, indicator: "northstar-admissions.example", status: "confirmed", simulated: true };
const ANCHOR = {
  report_id: RID,
  anchored: true,
  chain_id: 31337,
  contract: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  report_id_bytes32: "0x" + "0".repeat(32) + "01a1bced76c19260752ee8a697bee3df",
  payload_hash: "0x" + "ab".repeat(32),
  commitment: "0x" + "cd".repeat(32),
  revision: 1,
  tx_hash: "0x" + "ef".repeat(32),
  block_number: 2,
  anchored_at: "2026-11-09T10:00:00Z",
  simulated: true,
  created: null,
};
const checks = (ok: boolean) => ({ payload_hash_matches: ok, chain_commitment_matches: ok, report_unchanged: true });
const verification = (valid: boolean) => ({
  ...ANCHOR,
  valid,
  checks: checks(valid),
  payload: PAYLOAD,
  computed_payload_hash: ANCHOR.payload_hash,
  salt: "0x" + "11".repeat(32),
  on_chain_revision: 1,
  on_chain_status: "active",
  checked_at: "2026-11-09T10:05:00Z",
});

describe("public /verify/:reportId", () => {
  it("shows a valid result without signing in, with the integrity-not-truth caveat", async () => {
    const api = mockApi("user", [on("GET", `/api/v1/public/verify/${RID}`, () => json(verification(true)))]);
    renderAt(`/verify/${RID}`);
    expect(await screen.findByText(/Integrity verified: valid/, {}, LONG)).toBeInTheDocument();
    expect(screen.getAllByText(/does not prove the report is true/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/simulated: demo report/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`verify-report -- --report ${RID}`))).toBeInTheDocument();
    const call = api.calls.find((c) => c.path === `/api/v1/public/verify/${RID}`);
    expect(call?.headers.Authorization ?? call?.headers.authorization).toBeUndefined();
    // Page content only: the shared footer deliberately says "we never say a site is safe".
    const page = screen.getByRole("heading", { level: 1 }).closest("div")?.parentElement;
    expect(page?.textContent ?? "").not.toMatch(/\bsafe\b/i);
  });

  it("a simulated-registry anchor is labelled as such and points to the reproducible chain, not an RPC read", async () => {
    mockApi("user", [
      on("GET", `/api/v1/public/verify/${RID}`, () =>
        json({ ...verification(true), chain_id: 0, contract: "0x" + "7357".repeat(10) }),
      ),
    ]);
    renderAt(`/verify/${RID}`);
    expect(await screen.findByText(/Integrity verified: valid/, {}, LONG)).toBeInTheDocument();
    expect(screen.getByText(/0 · simulated registry \(not a public blockchain\)/)).toBeInTheDocument();
    expect(screen.getByText(/not a public blockchain\. The commitment is the same keccak256/)).toBeInTheDocument();
    expect(screen.getByText("pnpm --filter @trustlens/contracts replay")).toBeInTheDocument();
    expect(screen.queryByText(/verify-report -- --report/)).not.toBeInTheDocument();
  });

  it("a tampered copy fails", async () => {
    const api = mockApi("user", [
      on("GET", `/api/v1/public/verify/${RID}`, () => json(verification(true))),
      on("POST", `/api/v1/public/verify/${RID}`, () => json(verification(false))),
    ]);
    renderAt(`/verify/${RID}`);
    await screen.findByText(/Integrity verified: valid/, {}, LONG);
    const box = screen.getByLabelText(/Payload \(JSON\)/);
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste(JSON.stringify({ ...PAYLOAD, indicator: "tampered.example" }));
    await userEvent.click(screen.getByRole("button", { name: "Verify this payload" }));
    expect(await screen.findByText(/Does not match the on-chain record: invalid/, {}, LONG)).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === "POST");
    expect((post?.body as { payload: { indicator: string } }).payload.indicator).toBe("tampered.example");
  });

  it("explains a report that was never anchored and an unavailable chain", async () => {
    mockApi("user", [on("GET", `/api/v1/public/verify/${RID}`, () => apiError("ANCHOR_NOT_FOUND", 404, "Not anchored."))]);
    renderAt(`/verify/${RID}`);
    expect(await screen.findByText("This report has not been anchored", {}, LONG)).toBeInTheDocument();
    resetHarness();
    mockApi("user", [on("GET", `/api/v1/public/verify/${RID}`, () => apiError("CHAIN_UNAVAILABLE", 503, "Down."))]);
    renderAt(`/verify/${RID}`);
    expect(await screen.findByText("The report registry is unavailable", {}, LONG)).toBeInTheDocument();
  });
});

describe("report detail on-chain proof panel", () => {
  const REPORT = {
    id: RID,
    url: "https://apply.northstar-admissions.example/pay",
    status: "pending",
    reporter_channel: "web",
    observed_payee: null,
    linked_scan_id: null,
    decision: null,
    simulated: true,
    created_at: "2026-11-09T09:00:00Z",
    justification: "Asked for fees to a personal UPI handle.",
    reporter: "You",
    linked_scan: null,
    review: null,
  };

  it("anchors a report, then verifies it", async () => {
    let anchored = false;
    mockApi("user", [
      on("GET", `/api/v1/reports/${RID}`, () => json(REPORT)),
      on("GET", `/api/v1/reports/${RID}/anchor`, () => json(anchored ? ANCHOR : { report_id: RID, anchored: false })),
      on("POST", `/api/v1/reports/${RID}/anchor`, () => {
        anchored = true;
        return json({ ...ANCHOR, created: true }, 201);
      }),
      on("GET", `/api/v1/public/verify/${RID}`, () => json(verification(true))),
    ]);
    renderAt(`/app/reports/${RID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Anchor on chain" }, LONG));
    expect(await screen.findByText("0x5fbdb23156…2f64180aa3", {}, LONG)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verify independently" }));
    expect(await screen.findByText(/Integrity verified: valid/, {}, LONG)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public verification page" })).toHaveAttribute("href", `/verify/${RID}`);
  });

  it("says when the chain is unavailable and keeps the report usable", async () => {
    mockApi("user", [
      on("GET", `/api/v1/reports/${RID}`, () => json(REPORT)),
      on("GET", `/api/v1/reports/${RID}/anchor`, () => json({ report_id: RID, anchored: false })),
      on("POST", `/api/v1/reports/${RID}/anchor`, () => apiError("CHAIN_UNAVAILABLE", 503, "Down.")),
    ]);
    renderAt(`/app/reports/${RID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Anchor on chain" }, LONG));
    await waitFor(() => expect(screen.getByText("The report registry is unavailable")).toBeInTheDocument(), LONG);
    expect(screen.getByText("Asked for fees to a personal UPI handle.")).toBeInTheDocument();
  });
});

describe("chain labelling", () => {
  it("never presents the simulated registry as a public blockchain", async () => {
    const { chainLabel, simulatedNote } = await import("@/components/domain/OnChainProof");
    expect(chainLabel(0)).toContain("simulated registry");
    expect(chainLabel(0)).toContain("not a public blockchain");
    expect(simulatedNote(0)).toMatch(/not a public blockchain/);
    expect(chainLabel(31337)).toContain("local development chain");
    expect(chainLabel(11155111)).toBe("11155111");
    expect(chainLabel(null)).toBe("—");
  });
});
