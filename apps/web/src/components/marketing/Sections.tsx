import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BadgeCheck,
  Binary,
  Chrome,
  FileCheck2,
  Link2,
  ScanSearch,
  Terminal,
  Users,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { ScanInput } from "@/components/domain/ScanInput";
import { cn } from "@/lib/utils/cn";
import { BlockSlip } from "./BlockSlip";
import { useRevealGroup } from "./useReveal";

/* ------------------------------------------------------------------ shared frame */

export function Section({
  id,
  label,
  title,
  lead,
  children,
  className,
  aside,
}: {
  id?: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  const ref = useRevealGroup<HTMLDivElement>();
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("border-t border-border", className)}>
      <div ref={ref} className="mx-auto max-w-content px-4 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div data-reveal className="max-w-reading">
            <p className="label-eyebrow">{label}</p>
            <h2 id={id ? `${id}-title` : undefined} className="mt-3 text-3xl font-normal tracking-tight md:text-4xl">
              {title}
            </h2>
            {lead && <p className="mt-4 text-base text-muted-strong">{lead}</p>}
          </div>
          {aside && (
            <div data-reveal className="shrink-0">
              {aside}
            </div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ method */

const STEPS = [
  {
    title: "Observe the action, not the page",
    body: "The extension or API reports what the page was about to do: where the form posts, which payee it shows. Never what you type.",
  },
  {
    title: "Collect what the web already publishes",
    body: "DNS, the certificate chain, registration age and the response headers — through a guard that refuses private and internal addresses.",
  },
  {
    title: "Compare with the registered profile",
    body: "Domains the organisation proved it controls, payees it registered. Rules weight five signal groups; some facts force the verdict on their own.",
  },
] as const;

export function Method() {
  const ref = useRevealGroup<HTMLOListElement>();
  return (
    <Section
      id="method"
      label="The method"
      title="Three passes, then a decision a human can audit."
      lead="Nothing here is a reputation score. The question is narrower: is this page allowed to ask for this?"
    >
      <ol ref={ref} className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} data-reveal className="bg-surface p-6 md:p-7">
            <span className="font-mono text-2xs uppercase tracking-widest text-muted">
              {String(i + 1).padStart(2, "0")} / observe · collect · compare
            </span>
            <h3 className="mt-4 text-lg leading-snug">{step.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-strong">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ features */

const FEATURES = [
  {
    icon: Link2,
    title: "Action integrity",
    body: "Credential destination and payee checked against the verified profile. A valid certificate cannot save a page that posts your password somewhere else.",
  },
  {
    icon: BadgeCheck,
    title: "Certificate analysis",
    body: "Expiry, hostname coverage, key strength, revocation, transparency records — and the difference between a misconfigured site and a compromised one.",
  },
  {
    icon: Binary,
    title: "Rules decide, the model explains",
    body: "Verdicts come from weighted rules and published overrides. The LLM writes prose that must cite finding ids; it cannot invent one.",
  },
  {
    icon: ScanSearch,
    title: "Message and scam analysis",
    body: "Pasted email or SMS is parsed into links, handles and requests. Urgency alone caps at REVIEW — BLOCK needs corroboration.",
  },
  {
    icon: Users,
    title: "Threat correlation",
    body: "Shared infrastructure, campaigns and confirmed community reports connect separate incidents into one picture.",
  },
  {
    icon: FileCheck2,
    title: "Verifiable reports",
    body: "Reports can be anchored as salted hash commitments and checked by anyone. Only hashes leave the system.",
  },
] as const;

export function Features() {
  const ref = useRevealGroup<HTMLUListElement>();
  return (
    <Section
      id="features"
      label="What it checks"
      title="Six checks that a padlock cannot make."
      lead="Each one exists because a real phishing pattern defeats reputation alone."
    >
      <ul ref={ref} className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            data-reveal
            className="group rounded-lg border border-border bg-surface p-6 shadow-card transition-shadow duration-base hover:shadow-raised"
          >
            <span className="mesh-panel inline-flex h-9 w-9 items-center justify-center rounded-md border border-border">
              <Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <h3 className="mt-4 text-base">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-strong">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ demo */

export function Demo() {
  const navigate = useNavigate();
  const ref = useRevealGroup<HTMLDivElement>();
  return (
    <Section
      id="demo"
      label="Try the check"
      title="Paste an address. See what the rules found."
      lead="The full report needs a free account. We never store form values, and nothing you paste is used to train a model."
    >
      <div ref={ref} className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div data-reveal className="lg:col-span-7">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-card sm:p-6">
            <ScanInput
              submitLabel="Run the checks"
              layout="stacked"
              onSubmit={({ url, intent }) =>
                navigate(`/app/scan?url=${encodeURIComponent(url)}&intent=${encodeURIComponent(intent)}`)
              }
            />
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
              Sign in to keep the report. Seeded demonstrations are labelled in the dashboard.
            </p>
          </div>

          <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {["Address normalised", "Network and certificate read", "Rules decide, reasons listed"].map((t, i) => (
              <li key={t} data-reveal className="rounded-md border border-border bg-surface-secondary p-3">
                <span className="font-mono text-2xs text-muted">STEP {i + 1}</span>
                <p className="mt-1 text-sm leading-snug">{t}</p>
              </li>
            ))}
          </ol>
        </div>

        <div data-reveal className="lg:col-span-5">
          <BlockSlip demand="fees@okaxis" registered="fees@northstar-demo" decision="BLOCK" coverage="illustration · not live data" />
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ docs */

const INSTALL = `npm install @boredooms/trustlens-sdk`;

const SNIPPET = `import { TrustLens } from "@boredooms/trustlens-sdk";

const lens = new TrustLens({ apiKey: process.env.TRUSTLENS_KEY });

const result = await lens.assess("https://example.com/pay");

result.decision;   // "BLOCK" | "WARN" | "REVIEW" | "ALLOW" | "UNKNOWN"
result.riskClass;  // derived class, same meaning as the dashboard
result.findings;   // [{ code, severity, evidence }]`;

const DOC_LINKS = [
  { icon: Terminal, title: "SDK reference", body: "Client, types and error codes.", to: "/developers" },
  { icon: ScanSearch, title: "API health", body: "The live service and its checks.", href: "https://trustlens-api-m65a.onrender.com/ready" },
  { icon: FileCheck2, title: "Verify a report", body: "Check an anchored report without signing in.", to: "/verify/01HZY0DEMO0000000000000000" },
  { icon: Chrome, title: "Browser extension", body: "Holds pay and sign-in until the server answers.", href: "https://github.com/Boredooms/Trustlens/releases" },
  { icon: Users, title: "How it works", body: "The five-stage pipeline, written out.", to: "/how-it-works" },
  { icon: BadgeCheck, title: "Security posture", body: "What we see, what we never see.", to: "/security" },
] as const;

export function Docs() {
  const ref = useRevealGroup<HTMLDivElement>();
  return (
    <Section
      id="docs"
      label="Docs"
      title="Two ways in: the dashboard, or the API."
      lead="Everything the dashboard shows is available to your own tooling."
    >
      <div ref={ref} className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div data-reveal className="lg:col-span-6">
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="font-mono text-2xs uppercase tracking-widest text-muted">Install</span>
              <span className="font-mono text-2xs text-muted">Node 18+</span>
            </div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-code">
              <code>{INSTALL}</code>
            </pre>
            <div className="border-t border-border px-4 py-2.5">
              <span className="font-mono text-2xs uppercase tracking-widest text-muted">Assess</span>
            </div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-6 text-muted-strong">
              <code>{SNIPPET}</code>
            </pre>
          </div>
        </div>

        <ul className="lg:col-span-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DOC_LINKS.map(({ icon: Icon, title, body, ...rest }) => {
            const inner = (
              <>
                <span className="flex items-center justify-between">
                  <Icon aria-hidden className="h-4 w-4 text-muted-strong" strokeWidth={1.5} />
                  <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-muted transition-transform duration-fast group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
                <span className="mt-3 block text-sm font-medium">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-strong">{body}</span>
              </>
            );
            const classes =
              "group block rounded-lg border border-border bg-surface p-4 shadow-card transition-colors duration-fast hover:border-border-strong";
            return (
              <li key={title} data-reveal>
                {"href" in rest ? (
                  <a href={rest.href} target="_blank" rel="noreferrer noopener" className={classes}>
                    {inner}
                  </a>
                ) : (
                  <Link to={rest.to} className={classes}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ about */

const CANNOT = [
  "Pages behind a login, or content that only appears after you interact with them.",
  "Whether a site you have never visited is trustworthy in general.",
  "Anything about the person on the other end — only about the domain and the action.",
] as const;

export function About() {
  const ref = useRevealGroup<HTMLDivElement>();
  return (
    <Section
      id="about"
      label="About"
      title="An evidence tool, not an oracle."
      lead="TrustLens was built for a simple failure of the web: encryption became the whole trust signal, and it was never meant to be one."
    >
      <div ref={ref} className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div data-reveal className="rounded-lg border border-border bg-surface p-6 shadow-card lg:col-span-7">
          <h3 className="text-base">What we will not tell you</h3>
          <ul className="mt-4 flex flex-col gap-3">
            {CANNOT.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-muted-strong">
                <span aria-hidden className="mt-2 h-px w-4 shrink-0 bg-border-strong" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-border pt-4 text-sm leading-6 text-muted-strong">
            When the checks that ran find nothing, the answer is <span className="font-mono text-foreground">ALLOW</span> —
            “no known threat within the checks we ran”, with the coverage shown. It is never “safe”.
          </p>
        </div>

        <div data-reveal className="flex flex-col justify-between gap-6 rounded-lg border border-border mesh-panel p-6 lg:col-span-5">
          <div>
            <p className="label-eyebrow">Who made it</p>
            <p className="mt-2 text-sm leading-6 text-muted-strong">
              A small team building the missing layer between “the certificate is valid” and “this page is
              allowed to ask you for money”. Source, tests and the decision record are public.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://github.com/Boredooms/Trustlens"
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClasses("secondary", "sm")}
            >
              Repository
            </a>
            <Link to="/security" className={buttonClasses("ghost", "sm")}>
              Security posture
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ closing */

export function FinalCta() {
  const ref = useRevealGroup<HTMLDivElement>();
  return (
    <section aria-labelledby="cta-title" className="border-t border-border">
      <div ref={ref} className="mx-auto max-w-content px-4 py-20 sm:px-6 md:py-28">
        <div data-reveal className="rounded-xl border border-border mesh-panel px-6 py-12 text-center sm:px-12">
          <p className="label-eyebrow">Start with one address</p>
          <h2 id="cta-title" className="mx-auto mt-4 max-w-reading text-3xl tracking-tight md:text-4xl">
            Find out what a page is actually allowed to ask you for.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register" className={buttonClasses("primary")}>
              Create a free account
            </Link>
            <Link to="/developers" className={buttonClasses("secondary")}>
              Read the API docs
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted">
            Rules decide. The model only explains. We never say a site is safe.
          </p>
        </div>
      </div>
    </section>
  );
}
