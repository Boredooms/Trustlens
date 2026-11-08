import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, MousePointerClick, Server, Users } from "lucide-react";
import { ScanInput } from "@/components/domain/ScanInput";
import { VerdictBadge } from "@/components/domain/Badges";

const PILLARS = [
  {
    icon: Fingerprint,
    title: "Identity",
    body: "Is this domain one the organisation has proven it controls, or does it only look like one?",
  },
  {
    icon: MousePointerClick,
    title: "Action",
    body: "Where does the password, payment or form actually go — and is that destination registered?",
  },
  {
    icon: Server,
    title: "Infrastructure",
    body: "Domain age, certificate, nameservers and hosting shared with sites already known to be harmful.",
  },
  {
    icon: Users,
    title: "Community",
    body: "Reports confirmed by an analyst become protection for every other user of the network.",
  },
] as const;

export function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "TrustLens — the padlock is not an identity";
  }, []);
  return (
    <>
      <section className="mx-auto max-w-content px-4 pb-16 pt-16 md:px-6 md:pb-24 md:pt-24">
        <p className="label-eyebrow">Website trust intelligence</p>
        <h1 className="mt-4 max-w-4xl text-display font-medium tracking-tight">
          The padlock is not an identity.
        </h1>
        <p className="mt-6 max-w-reading text-base text-muted-strong">
          A valid certificate proves the connection is encrypted. It says nothing about who is on the other end.
          TrustLens checks whether a website is authorised to ask for your password, your money or your personal data
          — and shows the evidence for every answer.
        </p>
        <div className="mt-10 max-w-3xl rounded-md border border-border bg-surface p-5">
          <ScanInput
            submitLabel="Check a website"
            onSubmit={({ url, intent }) =>
              navigate(`/app/scan?url=${encodeURIComponent(url)}&intent=${encodeURIComponent(intent)}`)
            }
          />
          <p className="mt-3 text-xs text-muted">The full report needs a free account. We never store form values.</p>
        </div>
      </section>

      <section aria-labelledby="how" className="border-t border-border">
        <div className="mx-auto max-w-content px-4 py-16 md:px-6">
          <h2 id="how" className="text-2xl font-medium">
            How detection works
          </h2>
          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p) => (
              <li key={p.title} className="border-t border-border-strong pt-4">
                <p.icon aria-hidden className="h-5 w-5 text-muted-strong" strokeWidth={1.5} />
                <h3 className="mt-3 text-lg font-medium">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-strong">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="action" className="border-t border-border">
        <div className="mx-auto grid max-w-content grid-cols-1 gap-10 px-4 py-16 md:px-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 id="action" className="text-2xl font-medium">
              Observed, next to expected
            </h2>
            <p className="mt-4 max-w-prose text-sm text-muted-strong">
              A lookalike admissions portal can have a valid certificate and a clean reputation. What it cannot have is
              the payee the university registered. TrustLens puts the two side by side and lets rules — not a model —
              decide.
            </p>
            <p className="mt-4 text-xs text-muted">Illustration of the report layout. Not live data.</p>
          </div>
          <figure className="rounded-md border border-border bg-surface p-5 lg:col-span-7">
            <div className="flex items-center justify-between gap-4">
              <VerdictBadge decision="BLOCK" riskLevel="CRITICAL" size="lg" />
              <span className="font-mono tabular text-sm text-muted">Coverage 85%</span>
            </div>
            <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-md border border-border sm:grid-cols-2">
              <div className="border-b border-border bg-danger-surface p-4 sm:border-b-0 sm:border-r">
                <p className="label-eyebrow">This page asks for</p>
                <p className="mt-1 font-mono text-code">fees@okaxis</p>
              </div>
              <div className="p-4">
                <p className="label-eyebrow">The university registered</p>
                <p className="mt-1 font-mono text-code">fees@northstar-demo</p>
              </div>
            </div>
            <figcaption className="mt-4 text-sm text-muted-strong">
              The payment would go to an address the organisation has never registered.
            </figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="limits" className="border-t border-border">
        <div className="mx-auto max-w-content px-4 py-16 md:px-6">
          <h2 id="limits" className="text-2xl font-medium">
            What we will not tell you
          </h2>
          <p className="mt-4 max-w-reading text-sm text-muted-strong">
            We never call a website safe. When the checks that ran find nothing, we say “No known threat” and show how
            much was checked. When an organisation has registered nothing to compare against, we say we could not
            verify — absence of data is never treated as proof of fraud.
          </p>
        </div>
      </section>
    </>
  );
}
