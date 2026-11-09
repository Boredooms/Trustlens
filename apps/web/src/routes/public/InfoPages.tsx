import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { buttonClasses } from "@/components/ui/Button";

function Page({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · TrustLens`;
  }, [title]);
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16 md:px-6">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="mt-3 text-muted-strong">{lead}</p>
      </header>
      {children}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-sm leading-6">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-surface-secondary p-4 font-mono text-xs leading-5">
      <code>{children}</code>
    </pre>
  );
}

export const DECISIONS: Array<[string, string]> = [
  ["BLOCK", "Strong evidence this page is not authorised to take the action. Stop."],
  ["WARN", "Suspicious signals. Confirm the address through the organisation's official site first."],
  ["REVIEW", "Mixed or incomplete evidence. Verify independently before acting."],
  ["UNKNOWN", "Too little could be checked to judge. Treat the page as unverified."],
  ["ALLOW", "No known threat in the checks that ran. It is not a guarantee."],
];

const STEPS: Array<[string, string]> = [
  [
    "Observe",
    "The extension or API reports the address, the action (login, payment, data) and where it goes: the form destination or payee. Never what you type.",
  ],
  [
    "Collect",
    "The scanner reads DNS, the certificate, registration age and the page itself, through a guard that refuses private and internal addresses.",
  ],
  [
    "Compare",
    "Findings are checked against the organisation's verified profile: domains it proved it controls and payees it registered.",
  ],
  [
    "Decide",
    "Weighted rules score five signal groups. Some facts, such as money going to an unregistered payee, force a decision on their own. A model never decides.",
  ],
  [
    "Explain",
    "Every decision lists its reasons and how much was checked. Analysts can ask for an investigation; the model narrates, citing stored evidence only.",
  ],
];

export function HowItWorks() {
  return (
    <Page
      title="How it works"
      lead="TrustLens answers one question: is this page authorised by the organisation to ask for your password, money or personal data?"
    >
      <ol className="flex flex-col gap-6">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-sm">
              {i + 1}
            </span>
            <div>
              <h2 className="font-medium">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-strong">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Section title="What we cannot see">
        <ul className="list-disc pl-5 text-muted-strong">
          <li>Pages behind a login, or content that only appears after you interact with them.</li>
          <li>
            Organisations that have not registered their domains and payees: we can say a page is new or unusual, not
            that it is unauthorised.
          </li>
          <li>Real-time certificate transparency: certificate checks happen when a page is scanned.</li>
          <li>Anything we did not check. That is why every answer shows its coverage.</li>
        </ul>
      </Section>
      <div className="flex flex-wrap gap-3">
        <Link to="/" className={buttonClasses("primary")}>
          Check a website
        </Link>
        <Link to="/security" className={buttonClasses("secondary")}>
          Security methodology
        </Link>
      </div>
    </Page>
  );
}

const SCOPES: Array<[string, string]> = [
  ["assess:read", "POST /assess, GET /scans, GET /scans/{id}, POST /messages/analyse, POST /inspect-redirect"],
  ["scan:write", "POST /scans (full asynchronous scan)"],
  ["identity:read", "POST /verify-identity"],
  ["payments:read", "POST /verify-payment"],
  ["reports:write", "POST /reports (report a site to analysts)"],
  ["investigations:write", "POST /investigations (start the AI explanation of a scan)"],
  ["investigations:read", "GET /investigations/{id}, GET /investigations/{id}/export"],
];

const METHODS: Array<[string, string]> = [
  ["tl.assess({ url, intent, form_action?, payee? })", "Synchronous decision for one action. Browse checks of the same URL are reused for 10 minutes (cached: true)."],
  ["tl.scan({ url, intent, wait? })", "Full asynchronous scan; wait: true polls until completed, partial or failed."],
  ["tl.getScan(id)", "A scan with findings, evidence and coverage."],
  ["tl.verifyIdentity({ domain })", "Is this domain registered by the organisation it appears to be?"],
  ["tl.verifyPayment({ organisation_id, recipient_type, value })", "Is this payee one the organisation verified?"],
  ["tl.reportThreat({ url, justification? })", "Send a site to the analyst review queue."],
];

export function PublicDevelopers() {
  return (
    <Page
      title="Developers"
      lead="Ask TrustLens before your product sends a password or a payment — for any real website, from your server, the SDK or the browser extension."
    >
      <Section title="1. Create an API key">
        <p className="text-muted-strong">
          Sign in, open <span className="font-medium text-foreground">Developers</span>, and choose{" "}
          <span className="font-medium text-foreground">Create API key</span>. The secret (
          <code className="font-mono">tl_live_…</code>) is shown once; store it as a server-side environment variable. Keys
          are scoped, revocable, and every call is metered in your usage panel.
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">Scope</th>
              <th className="py-2 font-medium">Grants</th>
            </tr>
          </thead>
          <tbody>
            {SCOPES.map(([s, g]) => (
              <tr key={s} className="border-b border-border">
                <td className="py-2 pr-4 font-mono text-xs">{s}</td>
                <td className="py-2 text-muted-strong">{g}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="2. Install">
        <Code>{"npm install trustlens-sdk"}</Code>
      </Section>
      <Section title="3. Check any real site">
        <Code>{`import { TrustLens } from "trustlens-sdk";

const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY, baseUrl: "https://<your-api-host>" });

const a = await tl.assess({ url: "https://github.com/login", intent: "login" });
a.decision;           // "ALLOW" | "WARN" | "BLOCK" | "REVIEW" | "UNKNOWN" — the server decides
a.risk_score;         // 0–100
a.coverage.percent;   // how much was actually checked; never read ALLOW as "harmless"
a.reasons;            // plain-language reasons from the rules engine
a.findings;           // [{ code, severity, title, evidence_refs }]`}</Code>
        <p className="text-muted-strong">
          A first check of a new site runs a full server-side scan (DNS, TLS, the page, reputation feeds) and takes seconds;
          repeat browse checks of the same URL within 10 minutes return the stored decision with{" "}
          <code className="font-mono">cached: true</code>.
        </p>
      </Section>
      <Section title="SDK methods">
        <table className="w-full text-left text-sm">
          <tbody>
            {METHODS.map(([m, d]) => (
              <tr key={m} className="border-b border-border align-top">
                <td className="py-2 pr-4 font-mono text-xs">{m}</td>
                <td className="py-2 text-muted-strong">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-strong">
          Fields are snake_case exactly as the API returns them. Errors are typed (
          <code className="font-mono">AuthenticationError</code>, <code className="font-mono">RateLimitError</code>,{" "}
          <code className="font-mono">ValidationError</code>, …) and carry <code className="font-mono">code</code> and{" "}
          <code className="font-mono">requestId</code>.
        </p>
      </Section>
      <Section title="AI explanations">
        <p className="text-muted-strong">
          Start an investigation for any finished scan with <code className="font-mono">POST /api/v1/investigations</code>{" "}
          (scope <code className="font-mono">investigations:write</code>). A language model writes a narrative over that
          scan&apos;s evidence; every claim cites a finding or evidence id, uncited claims are dropped, and the model can
          never change the decision. The response says whether a model was used (<code className="font-mono">ai.generated</code>,{" "}
          <code className="font-mono">ai.model</code>).
        </p>
      </Section>
      <Section title="Browser extension">
        <p className="text-muted-strong">
          The TrustLens extension checks every http(s) page you open in real time and stops a login or payment the server
          blocks. Install it, open the popup and choose <span className="font-medium text-foreground">Connect in one click</span>{" "}
          — the dashboard connects it to your account without copying a code. It sends the page address, the form&apos;s
          destination and the payee text the page itself shows; it never reads what you type.
        </p>
      </Section>
      <Section title="Assess a payment">
        <Code>{`import { TrustLens } from "trustlens-sdk";

const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY });
const result = await tl.assess({
  url: "https://apply.northstar-admissions.example/pay",
  intent: "payment",
  payee: "fees@okaxis",
});
// result.decision === "BLOCK", result.risk_score === 62, result.reasons[...]`}</Code>
      </Section>
      <Section title="Decisions">
        <table aria-label="Decisions" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">Decision</th>
              <th className="py-2 font-medium">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {DECISIONS.map(([d, m]) => (
              <tr key={d} className="border-b border-border">
                <td className="py-2 pr-4 font-mono text-xs">{d}</td>
                <td className="py-2 text-muted-strong">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Rate limits and errors">
        <p className="text-muted-strong">
          Limits are per key. A <code className="font-mono">429 RATE_LIMITED</code> response carries a{" "}
          <code className="font-mono">Retry-After</code> header. Every error uses one envelope with a stable code and a
          request id.
        </p>
        <Code>{`try {
  await tl.assess({ url, intent: "login" });
} catch (e) {
  if (e.code === "RATE_LIMITED") await sleep(e.retryAfter * 1000);
  else throw e; // e.requestId helps support find the request
}`}</Code>
      </Section>
      <Section title="Sandbox">
        <p className="text-muted-strong">
          The <code className="font-mono">.example</code> demonstration hosts (for example{" "}
          <code className="font-mono">apply.northstar-admissions.example</code>) return recorded, labelled results, so
          you can build against BLOCK, WARN and ALLOW without scanning real sites.
        </p>
      </Section>
      <div className="flex flex-wrap gap-3">
        <Link to="/app/developers" className={buttonClasses("primary")}>
          Create an API key
        </Link>
        <Link to="/app/developers?connect=extension" className={buttonClasses("secondary")}>
          Connect the extension
        </Link>
      </div>
    </Page>
  );
}

export function SecurityPage() {
  return (
    <Page title="Security methodology" lead="How TrustLens checks pages, what it keeps, and what it cannot tell you.">
      <Section title="How decisions are made">
        <p className="text-muted-strong">
          Deterministic rules decide; a language model only writes explanations, and it cannot change a decision, a
          score or a risk level. Each answer reports coverage — how much of the checking actually ran — and low
          coverage never turns into ALLOW.
        </p>
      </Section>
      <Section title="Scanner isolation">
        <p className="text-muted-strong">
          Every address is resolved before connecting and refused if it points at private, loopback, link-local or
          cloud-metadata ranges. Each redirect hop is checked again. Only HTTP and HTTPS on standard ports are fetched,
          and responses are size- and time-limited.
        </p>
      </Section>
      <Section title="What we never store">
        <ul className="list-disc pl-5 text-muted-strong">
          <li>Passwords, one-time codes, card numbers or cookies — the extension never reads what you type.</li>
          <li>API keys and paired-browser tokens in plain text: only their hashes.</li>
          <li>Logos: organisations upload a fingerprint computed in their browser, not the image.</li>
        </ul>
      </Section>
      <Section title="Limitations">
        <ul className="list-disc pl-5 text-muted-strong">
          <li>No active scanning or exploitation of any site.</li>
          <li>Certificate transparency is not polled live.</li>
          <li>Payee verification is by attestation from a verified organisation, not a bank lookup.</li>
          <li>ALLOW means no known threat in the checks that ran — never a guarantee.</li>
        </ul>
      </Section>
      <Section title="Report a vulnerability">
        <p className="text-muted-strong">
          Email{" "}
          <a className="underline underline-offset-2" href="mailto:security@trustlens.example">
            security@trustlens.example
          </a>{" "}
          with steps to reproduce, and do not test against other people&apos;s data. If TrustLens flagged your site
          incorrectly,{" "}
          <Link className="underline underline-offset-2" to="/appeal">
            appeal the decision
          </Link>
          .
        </p>
      </Section>
    </Page>
  );
}
