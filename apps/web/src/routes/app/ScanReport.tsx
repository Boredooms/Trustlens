import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileSearch, Link2, RotateCw, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { VerdictBadge, SimulatedBadge, StatusPill } from "@/components/domain/Badges";
import { CoverageMeter, ScoreDial } from "@/components/domain/Meters";
import { FindingRow, ObservedExpected } from "@/components/domain/FindingRow";
import { EvidenceDrawer } from "@/components/domain/EvidenceDrawer";
import { TechnicalPanel } from "@/components/domain/TechnicalPanel";
import { CertificateReportCard, ExternalIntelLine, SecurityPostureCard } from "@/components/domain/TrustReports";
import { ReportSiteDialog } from "@/components/domain/ReportSiteDialog";
import { TimeText, UrlText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui/Overlay";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { useCreateInvestigation, useCreateReport, useCreateScan, useScan } from "@/lib/query/hooks";
import { isApiError, isNotFound } from "@/lib/api/errors";
import { SIGNAL_GROUPS, toDecision, toRiskLevel, toScanStatus } from "@/lib/api/enums";
import type { Finding, Scan } from "@/lib/api/types";
import {
  COPY,
  DECISION_COPY,
  INTENT_LABEL,
  OVERRIDE_COPY,
  RISK_LEVEL_LABEL,
  SIGNAL_GROUP_LABEL,
  allowSublabel,
} from "@/lib/copy";
import { durationMs, plural, stringifyValue } from "@/lib/format";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function groupFindings(findings: Finding[]): Array<{ group: string; items: Finding[] }> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.signal_group || "other";
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  const order = [...SIGNAL_GROUPS, ...[...groups.keys()].filter((k) => !(SIGNAL_GROUPS as readonly string[]).includes(k))];
  return order
    .filter((g) => groups.has(g))
    .map((g) => ({
      group: g,
      items: (groups.get(g) ?? []).slice().sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)),
    }));
}

// ── Progress (queued / running) ───────────────────────────────────────────────
function useElapsed(fromIso: string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const from = fromIso ? new Date(fromIso).getTime() : now;
  return Math.max(0, now - from);
}

function ScanProgress({ scan, timedOut, onKeepWaiting }: { scan: Scan; timedOut: boolean; onKeepWaiting: () => void }) {
  const elapsed = useElapsed(scan.created_at, !timedOut);
  const status = toScanStatus(scan.status);
  return (
    <div className="flex flex-col gap-6">
      {timedOut ? (
        <Banner
          title="This scan is taking longer than usual"
          action={
            <Button size="sm" onClick={onKeepWaiting}>
              Keep checking
            </Button>
          }
        >
          It has run for more than 90 seconds. We stopped checking automatically; the last known state is shown below.
        </Banner>
      ) : null}
      <section aria-labelledby="progress-title" className="rounded-md border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="progress-title" className="text-lg font-medium">
            {status === "queued" ? "Waiting for a scanner" : "Scan in progress"}
          </h2>
          <span className="font-mono tabular text-sm text-muted-strong" aria-live="off">
            {durationMs(elapsed)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-strong">
          The decision appears here when the checks finish — usually within 10 seconds.
        </p>
        <ol className="mt-5 flex flex-col gap-3">
          {SIGNAL_GROUPS.map((g) => {
            const done = scan.coverage?.collected?.includes(g) || scan.cached_groups?.includes(g);
            return (
              <li key={g} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={done ? "h-2 w-2 rounded-full bg-foreground" : "h-2 w-2 rounded-full border border-border-strong"}
                />
                <span className="text-sm">{SIGNAL_GROUP_LABEL[g]}</span>
                <span className="ml-auto text-xs text-muted">{done ? "Collected" : "Pending"}</span>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Skeleton className="h-64 xl:col-span-8" />
        <Skeleton className="h-64 xl:col-span-4" />
      </div>
    </div>
  );
}

// ── Verdict ───────────────────────────────────────────────────────────────────
function VerdictPanel({ scan }: { scan: Scan }) {
  const d = toDecision(scan.decision);
  const copy = DECISION_COPY[d];
  const pct = scan.coverage?.percent ?? 0;
  const reasons = scan.reasons ?? [];
  const overrides = scan.overrides ?? [];
  return (
    <section aria-labelledby="verdict-title" className="rounded-md border border-border bg-surface p-5">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="label-eyebrow">Decision</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <VerdictBadge decision={scan.decision} riskLevel={scan.risk_level} size="lg" />
            {scan.simulated ? <SimulatedBadge /> : null}
          </div>
          <h2 id="verdict-title" className="mt-3 text-2xl font-medium" aria-live="polite">
            {copy.label}
          </h2>
          <p className="mt-2 max-w-prose text-sm text-muted-strong">
            {d === "ALLOW" ? allowSublabel(pct) : copy.meaning}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:w-56 md:items-end md:text-right">
          <ScoreDial score={scan.risk_score} />
          <p className="text-xs text-muted">
            Risk level <span className="text-foreground">{RISK_LEVEL_LABEL[toRiskLevel(scan.risk_level)]}</span>
          </p>
          <CoverageMeter coverage={scan.coverage} className="w-full" />
        </div>
      </div>
      {reasons.length > 0 ? (
        <ol className="mt-6 flex list-decimal flex-col gap-2 border-t border-border pl-5 pt-4 text-sm marker:font-mono marker:text-muted">
          {reasons.map((r, i) => (
            <li key={i} className="max-w-prose pl-1">
              {r}
            </li>
          ))}
        </ol>
      ) : null}
      {overrides.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Hard rules applied</span>
          {overrides.map((o) => (
            <Tooltip key={o} content={OVERRIDE_COPY[o] ?? "A hard rule that sets the decision regardless of score."}>
              <button
                type="button"
                className="rounded-sm border border-border-strong px-1.5 py-0.5 font-mono text-xs text-foreground"
              >
                {o}
                <span className="sr-only">: {OVERRIDE_COPY[o] ?? "hard rule"}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {d === "BLOCK" || d === "WARN" ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          Run this site?{" "}
          <Link
            to={`/appeal?domain=${encodeURIComponent(scan.registrable_domain ?? hostOf(scan.url))}`}
            className="text-muted-strong underline underline-offset-4 hover:text-foreground"
          >
            Appeal this decision
          </Link>{" "}
          after proving you control the domain. Nothing changes until an analyst reviews it.
        </p>
      ) : null}
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function ActionEvidence({ scan }: { scan: Scan }) {
  const action = scan.result?.action;
  if (!action) return null;
  const intent = action.intent ?? scan.intent;
  if (intent !== "payment" && intent !== "login" && intent !== "data_submission") return null;
  const observed: Record<string, unknown> = {};
  if (action.payee) observed.payee = action.payee;
  if (action.observed_destination) observed.destination = action.observed_destination;
  const payeeFinding = (scan.findings ?? []).find((f) => f.code === "PAYEE_NOT_IN_VERIFIED_PROFILE");
  const registeredPayees = payeeFinding?.expected?.payees;
  const expected: Record<string, unknown> = {};
  if (registeredPayees !== undefined) expected.payees = registeredPayees;
  if (action.expected_destinations) expected.destinations = action.expected_destinations;
  const sentence =
    action.match === "none" && action.payee && registeredPayees !== undefined
      ? COPY.payeeMismatch(action.payee, "The organisation", stringifyValue(registeredPayees))
      : action.match === "none" && action.observed_destination && intent === "login"
        ? COPY.credentialMismatch(action.observed_destination, "organisation")
        : action.match === "unverifiable"
          ? COPY.unverifiable("The organisation", intent === "login" ? "login endpoint" : "payment destination")
          : action.match === "exact"
            ? "The destination matches one the organisation registered."
            : null;
  return (
    <Card
      title="Action evidence"
      actions={
        <span className="flex items-center gap-2 text-xs text-muted">
          {action.simulated ? <SimulatedBadge /> : null}
          Intent <span className="text-foreground">{INTENT_LABEL[intent] ?? intent}</span> · match{" "}
          <span className="font-mono text-foreground">{action.match ?? "—"}</span>
        </span>
      }
    >
      {sentence ? <p className="mb-4 max-w-prose text-sm">{sentence}</p> : null}
      <ObservedExpected observed={observed} expected={expected} />
    </Card>
  );
}

function Findings({
  scan,
  focusFinding,
  onOpenEvidence,
}: {
  scan: Scan;
  focusFinding: string | null;
  onOpenEvidence: (id: string | null) => void;
}) {
  const findings = useMemo(() => scan.findings ?? [], [scan.findings]);
  const grouped = useMemo(() => groupFindings(findings), [findings]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusFinding ? [focusFinding] : []));
  const toggle = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    if (!focusFinding) return;
    setExpanded((prev) => new Set(prev).add(focusFinding));
    const t = setTimeout(
      () => document.getElementById(`finding-${focusFinding}`)?.scrollIntoView({ block: "start", behavior: "smooth" }),
      80,
    );
    return () => clearTimeout(t);
  }, [focusFinding]);

  if (findings.length === 0) {
    return (
      <Card title="Findings">
        <EmptyState
          title="No findings"
          description="None of the checks that ran produced a finding. That is not a guarantee — see coverage for what ran."
        />
      </Card>
    );
  }
  return (
    <section aria-labelledby="findings-title" className="flex flex-col gap-4">
      <h2 id="findings-title" className="text-lg font-medium">
        Findings <span className="font-mono tabular text-sm text-muted">{findings.length}</span>
      </h2>
      {grouped.map(({ group, items }) => (
        <details key={group} open className="group rounded-md border border-border bg-surface">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-md px-4 py-3">
            <h3 className="text-sm font-medium">{SIGNAL_GROUP_LABEL[group] ?? group}</h3>
            <span className="font-mono tabular text-xs text-muted">{plural(items.length, "finding")}</span>
          </summary>
          <ul className="border-t border-border">
            {items.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                evidence={scan.evidence ?? []}
                expanded={expanded.has(f.id)}
                onToggle={() => toggle(f.id)}
                onOpenEvidence={onOpenEvidence}
                highlighted={focusFinding === f.id}
              />
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ScanReport() {
  const { scanId = "" } = useParams();
  const [params] = useSearchParams();
  const focusFinding = params.get("finding");
  const navigate = useNavigate();
  const scanQ = useScan(scanId);
  const investigate = useCreateInvestigation();
  const report = useCreateReport();
  const rescan = useCreateScan();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceFocus, setEvidenceFocus] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const openEvidence = useCallback((id: string | null) => {
    setEvidenceFocus(id);
    setEvidenceOpen(true);
  }, []);

  if (scanQ.isPending) {
    return (
      <div role="status" aria-label="Loading scan report" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!scanQ.data) {
    return (
      <>
        <PageHeader title="Scan report" breadcrumbs={[{ label: "Scan", to: "/app/scan" }, { label: "Report" }]} />
        {isNotFound(scanQ.error) ? (
          <EmptyState
            title="This scan does not exist or is not visible to you"
            description="Scans are visible to the person who ran them, their organisation, and analysts."
            action={
              <Link to="/app/scan" className="underline underline-offset-4">
                Start a new scan
              </Link>
            }
          />
        ) : (
          <ErrorState
            error={scanQ.error}
            title="We could not load this scan"
            onRetry={() => void scanQ.refetch()}
            retrying={scanQ.isFetching}
          />
        )}
      </>
    );
  }

  const scan = scanQ.data;
  const status = toScanStatus(scan.status);
  const terminal = status === "completed" || status === "partial" || status === "failed";
  const pct = scan.coverage?.percent ?? 0;

  const startInvestigation = () =>
    investigate.mutate(scan.id, {
      onSuccess: (res) => navigate(`/app/investigations/${res.id}`),
      onError: (e) => {
        // 409: an active investigation already exists for this scan — open it when the API names it.
        if (isApiError(e) && e.status === 409 && e.details && !Array.isArray(e.details)) {
          const existing = e.details.investigation_id ?? e.details.id;
          if (typeof existing === "string") navigate(`/app/investigations/${existing}`);
        }
      },
    });

  const actions = (
    <>
      <Button
        variant="primary"
        onClick={startInvestigation}
        loading={investigate.isPending}
        disabled={!terminal || status === "failed"}
      >
        <Sparkles aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        Investigate
      </Button>
      <Button onClick={() => setReportOpen(true)}>Report this site</Button>
      <Button
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(window.location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Link2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button
        variant="ghost"
        loading={rescan.isPending}
        onClick={() =>
          rescan.mutate({ url: scan.url, intent: scan.intent }, { onSuccess: (r) => navigate(`/app/scan/${r.id}`) })
        }
      >
        <RotateCw aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        Re-scan
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="Scan report"
        breadcrumbs={[{ label: "Scan", to: "/app/scan" }, { label: "Report" }]}
        meta={!terminal ? <StatusPill status={scan.status} /> : null}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <UrlText url={scan.url} max={72} className="text-foreground" />
            <span className="text-muted">·</span>
            <span>{INTENT_LABEL[scan.intent] ?? scan.intent}</span>
            <span className="text-muted">·</span>
            <TimeText iso={scan.completed_at ?? scan.created_at} />
          </span>
        }
        actions={actions}
      />

      {scanQ.isError ? (
        <Banner className="mb-6" title="Lost contact with the API — showing the last known state">
          Checking again automatically. Use “Retry now” in the banner above if the engine is waking up.
        </Banner>
      ) : null}
      {investigate.isError && !(isApiError(investigate.error) && investigate.error.status === 409 && investigate.error.details) ? (
        <ErrorState error={investigate.error} title="The investigation did not start" className="mb-6" compact />
      ) : null}
      {rescan.isError ? <ErrorState error={rescan.error} title="The re-scan did not start" className="mb-6" compact /> : null}

      {!terminal ? (
        <ScanProgress scan={scan} timedOut={scanQ.timedOut} onKeepWaiting={() => { scanQ.keepWaiting(); void scanQ.refetch(); }} />
      ) : status === "failed" ? (
        <div className="flex flex-col gap-4">
          <Banner tone="danger" title="The scan failed">
            The scan could not finish, so no decision was made. This is not a verdict about the site.
          </Banner>
          <p className="text-sm text-muted-strong">
            Failure code <span className="font-mono text-foreground">{scan.failure_code ?? "not reported"}</span>
          </p>
          <div>
            <Button
              variant="primary"
              loading={rescan.isPending}
              onClick={() =>
                rescan.mutate({ url: scan.url, intent: scan.intent }, { onSuccess: (r) => navigate(`/app/scan/${r.id}`) })
              }
            >
              Run the scan again
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
            {status === "partial" ? (
              <Banner title="Partial result — some checks did not finish">
                Unavailable:{" "}
                {(scan.coverage?.unavailable ?? []).map((g) => SIGNAL_GROUP_LABEL[g] ?? g).join(", ") || "not reported"}.
                The decision uses only the checks that ran.
              </Banner>
            ) : null}
            {scan.coverage && pct < 50 ? <Banner title="Low coverage">{COPY.lowCoverage}</Banner> : null}
            <VerdictPanel scan={scan} />
            <ActionEvidence scan={scan} />
            <Findings scan={scan} focusFinding={focusFinding} onOpenEvidence={openEvidence} />
          </div>
          <aside className="flex min-w-0 flex-col gap-6 xl:col-span-4" aria-label="Scan details">
            <Card title="Coverage">
              <CoverageMeter coverage={scan.coverage} showGroups />
            </Card>
            <Card
              title="Evidence"
              actions={
                <Button size="sm" variant="ghost" onClick={() => openEvidence(null)}>
                  <FileSearch aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Open
                </Button>
              }
            >
              <p className="text-sm text-muted-strong">
                {plural(scan.evidence?.length ?? 0, "evidence item")} — DNS answers, certificates, form actions and
                payee strings the findings rely on.
              </p>
            </Card>
            <CertificateReportCard result={scan.result} />
            <Card title="External intelligence">
              <ExternalIntelLine result={scan.result} />
              <p className="mt-2 text-xs text-muted">Feed data is attributed to its source; absence from a feed is not evidence of safety.</p>
            </Card>
            <SecurityPostureCard result={scan.result} />
            <Card title="Technical results">
              <TechnicalPanel result={scan.result} />
            </Card>
            <Card title="Metadata">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted">Scan ID</dt>
                <dd className="break-all font-mono">{scan.id}</dd>
                <dt className="text-muted">Engine</dt>
                <dd className="font-mono">{scan.engine_version ?? "—"}</dd>
                <dt className="text-muted">Duration</dt>
                <dd className="font-mono tabular">{durationMs(scan.duration_ms)}</dd>
                <dt className="text-muted">Cached groups</dt>
                <dd>{(scan.cached_groups ?? []).map((g) => SIGNAL_GROUP_LABEL[g] ?? g).join(", ") || "None"}</dd>
                <dt className="text-muted">Domain</dt>
                <dd className="break-all font-mono">{scan.registrable_domain ?? "—"}</dd>
              </dl>
            </Card>
          </aside>
        </div>
      )}

      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        evidence={scan.evidence ?? []}
        focusId={evidenceFocus}
      />
      <ReportSiteDialog
        key={reportOpen ? "open" : "closed"}
        open={reportOpen}
        onOpenChange={(o) => {
          setReportOpen(o);
          if (!o) report.reset();
        }}
        url={scan.url}
        defaultPayee={typeof scan.result?.action?.payee === "string" ? scan.result.action.payee : null}
        pending={report.isPending}
        error={report.error}
        created={report.data}
        onSubmit={(v) =>
          report.mutate({
            url: scan.url,
            justification: v.justification,
            intent: scan.intent,
            observed_payee: v.observed_payee,
            scan_id: scan.id,
          })
        }
      />
    </>
  );
}
