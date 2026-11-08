import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { absoluteTime, relativeTime } from "@/lib/format";
import { useDemoStatus, useResetDemo } from "@/lib/query/hooks";
import { toast } from "@/stores/toast";

const COUNT_LABELS: Array<[keyof DemoCountsShape, string]> = [
  ["scans", "Scans"],
  ["reports", "Reports"],
  ["campaigns", "Campaigns"],
  ["investigations", "Investigations"],
  ["incidents", "Certificate incidents"],
];
type DemoCountsShape = { scans: number; reports: number; campaigns: number; investigations: number; incidents: number };

/**
 * UI_UX_SPECIFICATIONS §15 "Demo": operators only, and only when the API runs in demo mode.
 * Reset runs the same reset + seed as the CLI (DEMO_RUNBOOK §10).
 */
export function DemoCard({ isOperator }: { isOperator: boolean }) {
  const status = useDemoStatus(isOperator);
  const reset = useResetDemo();
  const [open, setOpen] = useState(false);

  if (!isOperator) return null;
  if (status.isPending) {
    return (
      <Card title="Demo">
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }
  if (status.isError) {
    return (
      <Card title="Demo">
        <ErrorState error={status.error} title="We could not load the demo status" onRetry={() => void status.refetch()} compact />
      </Card>
    );
  }
  if (!status.data.demo_mode) return null;
  const data = status.data;

  return (
    <Card title="Demo">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-strong">
          Seeded demonstration data for {data.organisation ? data.organisation.name : "the demo organisation"}. Resetting
          removes rehearsal scans, reports, investigations and campaigns, then seeds the canonical dataset again.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {COUNT_LABELS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular-nums">{data.counts[key]}</dd>
            </div>
          ))}
          <dt className="text-muted">Last seeded</dt>
          <dd>{data.last_seeded_at ? <time dateTime={data.last_seeded_at} title={absoluteTime(data.last_seeded_at)}>{relativeTime(data.last_seeded_at)}</time> : "Not seeded"}</dd>
        </dl>
        <div>
          <Button
            variant="danger"
            onClick={() => {
              reset.reset();
              setOpen(true);
            }}
          >
            Reset demo data…
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset.reset();
        }}
        title="Reset the demo data?"
        consequence="Rehearsal scans, reports, investigations and campaigns are removed and the canonical dataset is seeded again. This takes up to a minute."
        confirmLabel="Reset demo data"
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: () => {
              setOpen(false);
              toast.success("Demo data reset", "The canonical Northstar dataset was seeded again.");
            },
          })
        }
        pending={reset.isPending}
        error={reset.error}
        errorTitle="The demo data was not reset"
      />
    </Card>
  );
}
