import { SeverityBadge, SimulatedBadge } from "@/components/domain/Badges";
import { Card } from "@/components/ui/Card";

/** Loose read of `scan.result` blocks added in engine 1.1.0 (CERTIFICATE_ANALYSIS.md §4–§5). */
type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : null);
const asList = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter((x): x is Dict => !!asDict(x)) : []);
const str = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

interface AssessmentCopy {
  label: string;
  tone: string;
  explain: string;
}
const NOT_CHECKED: AssessmentCopy = { label: "Not checked", tone: "text-muted-strong", explain: "The TLS check did not complete. Unknown is not a pass." };
const ASSESSMENT: Record<string, AssessmentCopy> = {
  valid: { label: "No certificate problem found", tone: "text-foreground", explain: "The certificate checks passed. That is not evidence the site is legitimate." },
  misconfigured: { label: "Misconfigured", tone: "text-warning", explain: "An operational problem (for example expiry or a weak key). The trust anchor itself is not in doubt." },
  trust_compromised: { label: "Trust may be compromised", tone: "text-danger", explain: "The chain is untrusted, revoked, self-signed or tied to an issuer under an advisory." },
  unavailable: NOT_CHECKED,
  no_tls: { label: "No HTTPS", tone: "text-danger", explain: "The site was reached over plain HTTP; nothing is encrypted." },
};

export function CertificateReportCard({ result }: { result: unknown }) {
  const cert = asDict(asDict(result)?.certificate);
  if (!cert) return null;
  const a = ASSESSMENT[str(cert.assessment)] ?? NOT_CHECKED;
  const rev = asDict(cert.revocation);
  const key = asDict(cert.key);
  return (
    <Card title="Certificate report">
      <div className="flex flex-col gap-3 text-sm">
        <p className={`font-medium ${a.tone}`}>{a.label}</p>
        <p className="text-xs text-muted-strong">{a.explain}</p>
        {asList(cert.issues).length > 0 ? (
          <ul className="flex flex-col gap-1.5" aria-label="Certificate issues">
            {asList(cert.issues).map((i) => (
              <li key={str(i.code)} className="flex flex-wrap items-center gap-2 text-xs">
                <SeverityBadge severity={str(i.severity)} />
                <span className="font-mono">{str(i.code)}</span>
                <span className="text-muted">{i.category === "trust" ? "trust" : "configuration"}</span>
                {i.simulated ? <SimulatedBadge /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Subject</dt>
          <dd className="font-mono">{str(cert.subject_cn)}</dd>
          <dt className="text-muted">Issuer / root</dt>
          <dd className="font-mono">
            {str(cert.issuer_cn)} / {str(cert.root_issuer_cn)}
          </dd>
          <dt className="text-muted">Expires in</dt>
          <dd>{cert.days_to_expiry === null || cert.days_to_expiry === undefined ? "—" : `${str(cert.days_to_expiry)} days`}</dd>
          <dt className="text-muted">Key / signature</dt>
          <dd className="font-mono">
            {str(key?.type)} {str(key?.bits)} · {str(cert.signature_algorithm)}
          </dd>
          <dt className="text-muted">Chain verified</dt>
          <dd>{cert.chain_verified === null || cert.chain_verified === undefined ? "—" : cert.chain_verified ? "yes" : "no"}</dd>
          <dt className="text-muted">Embedded CT proofs</dt>
          <dd>{str(cert.embedded_scts)}</dd>
          <dt className="text-muted">Revocation (OCSP)</dt>
          <dd>
            {str(rev?.status)}
            {rev?.reason ? <span className="text-muted"> ({str(rev.reason)})</span> : null}
          </dd>
        </dl>
        <p className="text-xs text-muted">{str(cert.note)}</p>
      </div>
    </Card>
  );
}

export function ExternalIntelLine({ result }: { result: unknown }) {
  const intel = asDict(asDict(result)?.intel);
  const sources = asList(intel?.sources);
  if (!intel || intel.status === "skipped" || sources.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs" aria-label="External intelligence">
      {sources.map((s) => (
        <li key={`${str(s.source)}-${str(s.indicator)}`}>
          <span className="font-medium">{str(s.source_name)}</span>:{" "}
          {s.status === "listed" ? (
            <span className="text-danger">
              lists {str(s.indicator)} ({str(s.threat)}), listing {str(s.listing_id)}
            </span>
          ) : s.status === "not_listed" ? (
            <span>no listing for {str(s.indicator)} (not a clean bill of health)</span>
          ) : (
            <span className="text-muted-strong">external reputation unavailable</span>
          )}
          <span className="text-muted"> · queried {str(s.queried_at)}</span>
          {s.mode === "fixture" ? <span className="text-muted"> · simulated fixture</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function SecurityPostureCard({ result }: { result: unknown }) {
  const posture = asDict(asDict(result)?.security_posture);
  if (!posture) return null;
  const findings = asList(posture.findings);
  return (
    <Card title="Security headers (not scored)">
      <div className="flex flex-col gap-3 text-sm">
        {posture.status !== "collected" ? (
          <p className="text-xs text-muted-strong">Headers were not observed ({str(posture.status)}). Not observed is not the same as fine.</p>
        ) : findings.length === 0 ? (
          <p className="text-xs text-muted-strong">No missing hardening headers in the response we saw.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {findings.map((f) => (
              <li key={str(f.code)} className="flex flex-col gap-0.5 text-xs">
                <span className="flex items-center gap-2">
                  <SeverityBadge severity={str(f.severity)} />
                  <span className="font-medium">{str(f.title)}</span>
                </span>
                <span className="text-muted-strong">Impact: {str(f.impact)}</span>
                <span className="text-muted-strong">Fix: {str(f.remediation)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">{str(posture.limitations)} Header hygiene never changes the decision.</p>
      </div>
    </Card>
  );
}
