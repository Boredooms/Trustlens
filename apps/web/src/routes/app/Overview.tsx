import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScanInput } from "@/components/domain/ScanInput";
import { VerdictBadge } from "@/components/domain/Badges";
import { ConfidenceBar } from "@/components/domain/Meters";
import { CopyButton, TimeText, UrlText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { useCreateScan, useOverview } from "@/lib/query/hooks";
import { useRecentStore } from "@/stores/recent";
import type { Overview as OverviewData } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const DEMO_URL = "https://apply.northstar-admissions.example/register";

function BlockSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** A null block means its source failed; the rest of the page still renders. */
function BlockUnavailable({ what, onRetry, retrying }: { what: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-strong">We could not load {what}. The rest of the overview is unaffected.</p>
      <Button size="sm" onClick={onRetry} loading={retrying}>
        <RotateCw aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        Try again
      </Button>
    </div>
  );
}

interface BlockProps<K extends keyof OverviewData> {
  title: string;
  what: string;
  k: K;
  className?: string;
  render: (v: NonNullable<OverviewData[K]>) => ReactNode;
  actions?: ReactNode;
}

function useBlock() {
  return useOverview();
}

function Block<K extends keyof OverviewData>({ title, what, k, className, render, actions }: BlockProps<K>) {
  const q = useBlock();
  let body: ReactNode;
  if (q.isPending) body = <BlockSkeleton />;
  else if (q.isError) body = <BlockUnavailable what={what} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  else {
    const v = q.data[k];
    body =
      v === null || v === undefined ? (
        <BlockUnavailable what={what} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        render(v as NonNullable<OverviewData[K]>)
      );
  }
  return (
    <Card title={title} actions={actions} className={cn("min-w-0", className)}>
      {body}
    </Card>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const create = useCreateScan();
  const addRecent = useRecentStore((s) => s.add);
  const q = useOverview();

  return (
    <>
      <PageHeader title="Overview" subtitle="Recent decisions, the review queue and what needs attention." />
      {q.isError ? (
        <ErrorState
          className="mb-6"
          error={q.error}
          title="The overview did not load"
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
          compact
        />
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card title="Scan a website" className="lg:col-span-12">
          <ScanInput
            submitting={create.isPending}
            onSubmit={({ url, intent }) =>
              create.mutate(
                { url, intent },
                {
                  onSuccess: (r) => {
                    addRecent({ scanId: r.id, url, intent, at: new Date().toISOString() });
                    navigate(`/app/scan/${r.id}`);
                  },
                },
              )
            }
          />
          {create.isError ? <ErrorState className="mt-4" error={create.error} title="The scan did not start" compact /> : null}
        </Card>

        <Block
          title="Recent scans"
          what="recent scans"
          k="recent_scans"
          className="lg:col-span-8"
          actions={
            <Link to="/app/scan" className="text-xs underline underline-offset-4">
              All scans
            </Link>
          }
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState
                className="py-2"
                title="No scans yet — try the demo lookalike"
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{DEMO_URL}</span>
                    <CopyButton value={DEMO_URL} />
                  </span>
                }
              />
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {rows.slice(0, 5).map((s) => (
                  <li key={s.id} className="row-density flex items-center gap-4">
                    <Link to={`/app/scan/${s.id}`} className="min-w-0 flex-1 truncate rounded-sm hover:underline">
                      <UrlText url={s.url} max={60} />
                    </Link>
                    <VerdictBadge decision={s.decision} riskLevel={s.risk_level} size="sm" />
                    <span className="hidden w-24 text-right text-xs text-muted sm:block">
                      <TimeText iso={s.created_at} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Block
          title="Report queue"
          what="the report queue"
          k="report_queue"
          className="lg:col-span-4"
          render={(rq) =>
            rq.pending + rq.reviewing === 0 ? (
              <EmptyState className="py-2" title="Nothing waiting" description="New community reports appear here for review." />
            ) : (
              <div className="flex flex-col gap-4">
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted">Pending</dt>
                    <dd className="font-mono tabular text-3xl">{rq.pending}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Reviewing</dt>
                    <dd className="font-mono tabular text-3xl">{rq.reviewing}</dd>
                  </div>
                </dl>
                <Link to="/app/reports?status=pending" className="text-sm underline underline-offset-4">
                  Review reports
                </Link>
              </div>
            )
          }
        />

        <Block
          title="High-risk domains"
          what="high-risk domains"
          k="high_risk_domains"
          className="lg:col-span-6"
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState className="py-2" title="No known bad domains in your scope" />
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {rows.slice(0, 5).map((d) => (
                  <li key={d.entity_id} className="row-density flex items-center justify-between gap-4">
                    <Link to={`/app/intelligence?entity=${encodeURIComponent(d.entity_id)}`} className="min-w-0 truncate font-mono text-xs hover:underline">
                      {d.domain}
                    </Link>
                    <span className="font-mono tabular text-xs text-muted-strong" title="Reputation score (negative is worse)">
                      {d.reputation_score}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Block
          title="Certificate alerts"
          what="certificate alerts"
          k="certificate_alerts"
          className="lg:col-span-6"
          actions={
            <Link to="/app/certificates" className="text-xs underline underline-offset-4">
              Certificates
            </Link>
          }
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState className="py-2" title="No certificates expiring soon" />
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {rows.slice(0, 5).map((c) => (
                  <li key={c.monitor_id} className="row-density flex items-center justify-between gap-4">
                    <span className="min-w-0 truncate font-mono text-xs">{c.domain}</span>
                    <span className={cn("font-mono tabular text-xs", c.days_to_expiry <= 30 ? "text-warning" : "text-muted-strong")}>
                      {c.days_to_expiry} days
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Block
          title="Campaigns"
          what="campaigns"
          k="campaigns"
          className="lg:col-span-12"
          actions={
            <Link to="/app/campaigns" className="text-xs underline underline-offset-4">
              All campaigns
            </Link>
          }
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState className="py-2" title="No correlated campaigns yet" />
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {rows.slice(0, 3).map((c) => (
                  <li key={c.id} className="border-t border-border-strong pt-3">
                    <Link to={`/app/campaigns/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <ConfidenceBar value={c.confidence} label={`Confidence for ${c.name}`} />
                      <span className="text-xs text-muted">
                        <span className="font-mono tabular text-foreground">{c.member_count}</span> members
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        />

        <Block
          title="Quota"
          what="your quota"
          k="quota"
          className="lg:col-span-12"
          render={(qt) => (
            <div className="flex flex-wrap items-center gap-6">
              <p className="font-mono tabular text-sm">
                {qt.scans_used}
                <span className="text-muted">/{qt.scans_limit} scans</span>
              </p>
              <div
                role="meter"
                aria-label="Scan quota used"
                aria-valuemin={0}
                aria-valuemax={qt.scans_limit}
                aria-valuenow={qt.scans_used}
                aria-valuetext={`${qt.scans_used} of ${qt.scans_limit} scans used`}
                className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-secondary"
              >
                <div
                  className="h-full bg-foreground"
                  style={{ width: `${Math.min(100, (qt.scans_used / Math.max(1, qt.scans_limit)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted">
                Resets <TimeText iso={qt.resets_at} />
              </p>
            </div>
          )}
        />
      </div>
    </>
  );
}
