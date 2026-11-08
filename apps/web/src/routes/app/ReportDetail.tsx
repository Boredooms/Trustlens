import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill, VerdictBadge } from "@/components/domain/Badges";
import { OnChainProofPanel } from "@/components/domain/OnChainProof";
import { CoverageMeter, ScoreDial } from "@/components/domain/Meters";
import { TimeText, UrlText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { isAnalystRole, useReport, useReviewReport, useRole } from "@/lib/query/hooks";
import { isNotFound } from "@/lib/api/errors";
import { INTENT_LABEL } from "@/lib/copy";
import { humanise, stringifyValue } from "@/lib/format";
import type { Report } from "@/lib/api/types";

function ReviewPanel({ report }: { report: Report }) {
  const review = useReviewReport(report.id);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const len = reason.trim().length;
  const problem = len < 10 ? "Give a reason of at least 10 characters." : len > 500 ? "Keep the reason under 500 characters." : null;
  const coverage = report.linked_scan?.coverage?.percent;
  const lowCoverage = typeof coverage === "number" && coverage < 50;
  const reviewed = report.status === "confirmed" || report.status === "dismissed";

  if (reviewed) {
    return (
      <Card title="Review">
        <p className="text-sm">
          <StatusPill status={report.status} /> by{" "}
          <span className="font-mono text-xs">{report.review?.reviewed_by ?? "an analyst"}</span>{" "}
          <TimeText iso={report.review?.reviewed_at} />
        </p>
        {report.review?.reason ? <p className="mt-3 max-w-prose text-sm text-muted-strong">{report.review.reason}</p> : null}
      </Card>
    );
  }

  const submit = (action: "confirm" | "dismiss") => {
    setTouched(true);
    if (problem) return;
    review.mutate({ action, reason: reason.trim() });
  };

  return (
    <Card title="Review">
      <div className="flex flex-col gap-4">
        <Field label="Reason" required error={touched ? problem : null} counter={{ value: len, max: 500 }} help="Recorded in the audit log with your name.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {lowCoverage ? (
          <p className="text-xs text-muted-strong">
            Confirm is unavailable: the linked scan ran {Math.round(coverage)}% of its checks, below the 50% needed to confirm.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => submit("confirm")} loading={review.isPending && review.variables?.action === "confirm"} disabled={lowCoverage || review.isPending}>
            Confirm report
          </Button>
          <Button onClick={() => submit("dismiss")} loading={review.isPending && review.variables?.action === "dismiss"} disabled={review.isPending}>
            Dismiss report
          </Button>
        </div>
        {review.isError ? <ErrorState error={review.error} title="The review was not saved" compact /> : null}
        {review.isSuccess ? <p role="status" className="text-sm">Review saved.</p> : null}
      </div>
    </Card>
  );
}

export default function ReportDetail() {
  const { reportId = "" } = useParams();
  const q = useReport(reportId);
  const role = useRole();

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading report" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Report" breadcrumbs={[{ label: "Reports", to: "/app/reports" }, { label: "Report" }]} />
        {isNotFound(q.error) ? (
          <EmptyState title="This report does not exist or is not visible to you" />
        ) : (
          <ErrorState error={q.error} title="We could not load this report" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );

  const r = q.data;
  const scan = r.linked_scan;
  const scanId = scan?.id ?? r.linked_scan_id ?? null;

  return (
    <>
      <PageHeader
        title="Report"
        breadcrumbs={[{ label: "Reports", to: "/app/reports" }, { label: "Report" }]}
        meta={<StatusPill status={r.status} />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3">
            <UrlText url={r.url} max={72} className="text-foreground" />
            <span className="text-muted">·</span>
            <TimeText iso={r.created_at} />
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
          <Card title="What the reporter saw">
            <p className="max-w-prose whitespace-pre-wrap text-sm">{r.justification ?? "No justification recorded."}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Intent</dt>
              <dd>{r.intent ? (INTENT_LABEL[r.intent] ?? r.intent) : "—"}</dd>
              <dt className="text-muted">Payee</dt>
              <dd className="font-mono">{r.observed_payee ?? "—"}</dd>
              <dt className="text-muted">Reporter</dt>
              <dd className="font-mono">
                {r.reporter ? stringifyValue(r.reporter.pseudonym ?? r.reporter.label ?? r.reporter.id ?? r.reporter) : "—"}
              </dd>
              <dt className="text-muted">Channel</dt>
              <dd>{r.channel ? humanise(r.channel) : "—"}</dd>
            </dl>
          </Card>
          {isAnalystRole(role) ? (
            <ReviewPanel report={r} />
          ) : (
            <Banner tone="neutral" title="Waiting for analyst review">
              Analysts confirm or dismiss reports. You will see the outcome here.
            </Banner>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-6 xl:col-span-4" aria-label="Linked scan">
          <Card title="Linked scan">
            {scan ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <VerdictBadge decision={scan.decision} riskLevel={scan.risk_level} />
                  <ScoreDial score={scan.risk_score} className="text-2xl" />
                </div>
                <CoverageMeter coverage={scan.coverage ?? null} />
                {scanId ? (
                  <Link to={`/app/scan/${scanId}`} className="text-sm underline underline-offset-4">
                    Open the scan report
                  </Link>
                ) : null}
              </div>
            ) : scanId ? (
              <Link to={`/app/scan/${scanId}`} className="text-sm underline underline-offset-4">
                Open the scan report
              </Link>
            ) : (
              <p className="text-sm text-muted">No scan is linked to this report.</p>
            )}
          </Card>
          <OnChainProofPanel reportId={r.id} />
          <Card title="Evidence">
            {(r.evidence ?? []).length === 0 ? (
              <p className="text-sm text-muted">No evidence attached.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(r.evidence ?? []).map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="font-mono text-muted">{e.source}</span> {e.summary}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
