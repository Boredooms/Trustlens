import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VerdictBadge, SimulatedBadge } from "./Badges";
import { CoverageMeter, ScoreDial } from "./Meters";
import { FindingRow } from "./FindingRow";
import { ErrorState } from "@/components/ui/States";
import { ApiError } from "@/lib/api/errors";
import type { Finding } from "@/lib/api/types";

describe("VerdictBadge", () => {
  it("renders ALLOW as 'No known threat' with one screen-reader string", () => {
    render(<VerdictBadge decision="ALLOW" riskLevel="LOW" />);
    const badge = screen.getByRole("img", { name: "Decision: no known threat. Risk: low." });
    expect(badge).toHaveTextContent("No known threat");
    expect(badge.textContent ?? "").not.toMatch(/safe|secure|trusted|verified/i);
  });

  it("renders BLOCK with its label", () => {
    render(<VerdictBadge decision="BLOCK" riskLevel="CRITICAL" />);
    expect(screen.getByRole("img", { name: "Decision: blocked. Risk: critical." })).toHaveTextContent("Blocked");
  });

  it("maps an unknown wire value to UNKNOWN", () => {
    render(<VerdictBadge decision="SOMETHING_NEW" />);
    const badge = screen.getByRole("img");
    expect(badge).toHaveAttribute("data-decision", "UNKNOWN");
    expect(badge).toHaveTextContent("Not verified");
  });
});

describe("CoverageMeter and ScoreDial", () => {
  it("exposes a meter with a text value", () => {
    render(
      <CoverageMeter
        coverage={{ percent: 85, collected: ["reputation", "identity"], unavailable: ["credential_destination"], skipped: [] }}
        showGroups
      />,
    );
    const meter = screen.getByRole("meter", { name: "Coverage" });
    expect(meter).toHaveAttribute("aria-valuenow", "85");
    expect(meter).toHaveAttribute("aria-valuetext", "85 percent of checks ran");
    expect(screen.getByText("Credential destination")).toBeInTheDocument();
  });

  it("renders the score with its denominator", () => {
    render(<ScoreDial score={62} />);
    expect(screen.getByText("/100")).toBeInTheDocument();
    expect(screen.getByText(/62/)).toBeInTheDocument();
  });
});

describe("SimulatedBadge", () => {
  it("always carries the explanatory title", () => {
    render(<SimulatedBadge />);
    expect(screen.getByTitle("This data is generated for demonstration and is not a real incident")).toHaveTextContent(
      "Simulated",
    );
  });
});

const finding: Finding = {
  id: "F1",
  code: "PAYEE_NOT_IN_VERIFIED_PROFILE",
  signal_group: "payment_destination",
  severity: "critical",
  confidence: 1,
  title: "Payment address is not registered by the organisation",
  detail: "The page asks for a transfer to fees@okaxis; the organisation has registered fees@northstar-demo.",
  observed: { payee: "fees@okaxis" },
  expected: { payees: ["fees@northstar-demo"] },
  evidence_refs: ["E1"],
  rule_id: "R-PAY-01",
};

describe("FindingRow", () => {
  it("shows observed and expected side by side and reveals code, rule and confidence on expand", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ul>
        <FindingRow finding={finding} evidence={[]} expanded={false} onToggle={onToggle} onOpenEvidence={() => {}} />
      </ul>,
    );
    expect(screen.getByText("fees@okaxis")).toBeInTheDocument();
    expect(screen.getByText("fees@northstar-demo")).toBeInTheDocument();
    expect(screen.getByText("1 evidence item")).toBeInTheDocument();
    expect(screen.queryByText("R-PAY-01")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <ul>
        <FindingRow finding={finding} evidence={[]} expanded onToggle={onToggle} onOpenEvidence={() => {}} />
      </ul>,
    );
    expect(screen.getByText("R-PAY-01")).toBeInTheDocument();
    expect(screen.getByText("PAYEE_NOT_IN_VERIFIED_PROFILE")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("shows the message, a retry and the request id in technical details", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        error={new ApiError({ code: "TARGET_NOT_ALLOWED", status: 422, message: "The target resolves to a private address.", requestId: "req_123" })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The target resolves to a private address.");
    expect(screen.getByText("req_123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
