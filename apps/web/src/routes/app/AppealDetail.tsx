import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Forbidden } from "@/components/layout/Guards";
import { StatusPill } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { isAnalystRole, useAppeal, useMe, useReviewAppeal } from "@/lib/query/hooks";
import { isForbidden, isNotFound } from "@/lib/api/errors";
import type { Appeal } from "@/lib/api/types";
import { toast } from "@/stores/toast";

const MIN = 10;
const MAX = 1000;

function ReviewPanel({ appeal }: { appeal: Appeal }) {
  const review = useReviewAppeal(appeal.id);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const len = reason.trim().length;
  const reasonError = len < MIN ? `Give a reason of at least ${MIN} characters.` : len > MAX ? `Keep it under ${MAX} characters.` : null;
  const closed = appeal.status === "approved" || appeal.status === "rejected";
  const canApprove = appeal.status === "challenge_verified";
  const act = (action: "approve" | "reject") => {
    setTouched(true);
    if (reasonError) return;
    review.mutate(
      { action, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(action === "approve" ? "Appeal approved" : "Appeal rejected", appeal.domain);
          setReason("");
          setTouched(false);
        },
      },
    );
  };
  if (closed) {
    const r = appeal.review ?? {};
    return (
      <Card title="Review">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Decision</dt>
          <dd>
            <StatusPill status={appeal.status} />
          </dd>
          <dt className="text-muted">Reason</dt>
          <dd className="whitespace-pre-wrap">{String(r.reason ?? "—")}</dd>
          <dt className="text-muted">Reviewed</dt>
          <dd>
            <TimeText iso={typeof r.reviewed_at === "string" ? r.reviewed_at : null} />
          </dd>
          {r.reputation_before !== undefined && r.reputation_before !== null ? (
            <>
              <dt className="text-muted">Reputation</dt>
              <dd className="font-mono">
                {String(r.reputation_before)} → {String(r.reputation_after ?? "—")}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>
    );
  }
  return (
    <Card title="Review">
      <div className="flex flex-col gap-4">
        {!canApprove ? (
          <Banner tone="neutral" title="Ownership not proven yet">
            The owner has not passed the domain challenge, so the appeal can only be rejected for now.
          </Banner>
        ) : (
          <p className="text-sm text-muted-strong">
            Approving resets the domain’s reputation toward neutral and dismisses its {appeal.open_reports} open report
            {appeal.open_reports === 1 ? "" : "s"}. Rules decide again on the next check.
          </p>
        )}
        <Field label="Reason" required counter={{ value: len, max: MAX }} error={touched ? reasonError : null}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {review.isError ? <ErrorState error={review.error} title="The review was not recorded" compact /> : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled={!canApprove} loading={review.isPending && review.variables?.action === "approve"} onClick={() => act("approve")}>
            Approve appeal
          </Button>
          <Button loading={review.isPending && review.variables?.action === "reject"} onClick={() => act("reject")}>
            Reject appeal
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function AppealDetail() {
  const { appealId = "" } = useParams();
  const me = useMe();
  const allowed = isAnalystRole(me.data?.role ?? null);
  const q = useAppeal(appealId);
  const crumbs = [{ label: "Appeals", to: "/app/appeals" }];

  if (me.isPending || (allowed && q.isPending))
    return (
      <div role="status" aria-label="Loading appeal" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  if (!allowed || (q.isError && isForbidden(q.error)))
    return (
      <>
        <PageHeader title="Appeal" breadcrumbs={[...crumbs, { label: "Appeal" }]} />
        <Forbidden what="appeals" />
      </>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Appeal" breadcrumbs={[...crumbs, { label: "Appeal" }]} />
        {isNotFound(q.error) ? (
          <EmptyState title="This appeal does not exist" />
        ) : (
          <ErrorState error={q.error} title="We could not load this appeal" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );

  const a = q.data;
  if (!a) return null;
  return (
    <>
      <PageHeader title={a.domain} breadcrumbs={[...crumbs, { label: a.domain }]} meta={<StatusPill status={a.status} />} subtitle="Appeal against a decision" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card title="Appeal" className="xl:col-span-7">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">From</dt>
            <dd className="break-all font-mono text-xs">{a.email}</dd>
            <dt className="text-muted">Received</dt>
            <dd>
              <TimeText iso={a.created_at} mode="absolute" />
            </dd>
            <dt className="text-muted">Challenge</dt>
            <dd>
              {a.challenge_method === "dns_txt" ? "DNS TXT record" : "HTTPS file"} ·{" "}
              {a.challenge_verified_at ? (
                <>
                  passed <TimeText iso={a.challenge_verified_at} />
                </>
              ) : (
                <>
                  not passed ({a.attempts} attempt{a.attempts === 1 ? "" : "s"})
                </>
              )}
            </dd>
            <dt className="text-muted">Reputation</dt>
            <dd className="font-mono">{a.current_reputation ?? "—"}</dd>
            <dt className="text-muted">Open reports</dt>
            <dd className="font-mono">{a.open_reports}</dd>
          </dl>
          <h3 className="mt-5 text-xs font-medium text-muted">Owner’s message</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{a.message}</p>
        </Card>
        <div className="xl:col-span-5">
          <ReviewPanel appeal={a} />
        </div>
      </div>
    </>
  );
}
