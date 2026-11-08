import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CertificateReportCard, ExternalIntelLine, SecurityPostureCard } from "./TrustReports";

const cert = (assessment: string, issues: unknown[] = []) => ({
  certificate: {
    assessment,
    issues,
    subject_cn: "revoked.badhost.example",
    issuer_cn: "R3",
    root_issuer_cn: "ISRG Root X1",
    days_to_expiry: 50,
    key: { type: "EC", bits: 256 },
    signature_algorithm: "ecdsa-with-SHA256",
    chain_verified: true,
    embedded_scts: 2,
    revocation: { status: "revoked", reason: "keyCompromise" },
    note: "A valid certificate proves only that the connection is encrypted to whoever controls this name. It is not evidence that the site is legitimate.",
  },
});

describe("trust reports", () => {
  it("separates trust compromise from misconfiguration", () => {
    const { rerender } = render(<CertificateReportCard result={cert("trust_compromised", [{ code: "CERT_REVOKED", category: "trust", severity: "critical" }])} />);
    expect(screen.getByText("Trust may be compromised")).toBeInTheDocument();
    expect(screen.getByText("CERT_REVOKED")).toBeInTheDocument();
    expect(screen.getByText(/keyCompromise/)).toBeInTheDocument();
    rerender(<CertificateReportCard result={cert("misconfigured", [{ code: "CERT_EXPIRING_SOON", category: "configuration", severity: "low" }])} />);
    expect(screen.getByText("Misconfigured")).toBeInTheDocument();
    expect(screen.getByText(/trust anchor itself is not in doubt/)).toBeInTheDocument();
  });

  it("never presents a valid certificate as proof", () => {
    render(<CertificateReportCard result={cert("valid")} />);
    expect(screen.getByText(/not evidence the site is legitimate/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\bsafe\b/i);
  });

  it("attributes external listings and labels unavailable honestly", () => {
    render(
      <ExternalIntelLine
        result={{
          intel: {
            status: "unavailable",
            sources: [
              { source: "urlhaus", source_name: "URLhaus (abuse.ch)", indicator: "a.example", status: "listed", threat: "phishing", listing_id: "SIM-1", queried_at: "t", mode: "fixture" },
              { source: "urlhaus", source_name: "URLhaus (abuse.ch)", indicator: "b.example", status: "unavailable", queried_at: "t", mode: "live" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/lists a.example \(phishing\), listing SIM-1/)).toBeInTheDocument();
    expect(screen.getByText("external reputation unavailable")).toBeInTheDocument();
    expect(screen.getByText(/simulated fixture/)).toBeInTheDocument();
  });

  it("shows posture as unscored with impact and remediation", () => {
    render(
      <SecurityPostureCard
        result={{
          security_posture: {
            status: "collected",
            findings: [{ code: "HSTS_MISSING", severity: "low", title: "No Strict-Transport-Security header", impact: "Downgrade risk.", remediation: "Send HSTS." }],
            limitations: "Based on one unauthenticated response.",
          },
        }}
      />,
    );
    expect(screen.getByText("Security headers (not scored)")).toBeInTheDocument();
    expect(screen.getByText("Fix: Send HSTS.")).toBeInTheDocument();
    expect(screen.getByText(/never changes the decision/)).toBeInTheDocument();
  });
});
