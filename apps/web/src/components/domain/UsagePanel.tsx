import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { TimeText } from "@/components/domain/Text";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useUsage } from "@/lib/query/hooks";
import type { Usage } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const DAYS = 7;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last 7 UTC days, oldest first, with zero-filled gaps so the axis never skips a day. */
export function lastSevenDays(usage: Usage | undefined, today: Date = new Date()): Array<{ day: string; count: number }> {
  const totals = new Map<string, number>();
  for (const r of usage?.data ?? []) {
    if (!r.day) continue;
    const key = r.day.slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(r.count) ? r.count : 0));
  }
  const out: Array<{ day: string; count: number }> = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = isoDay(d);
    out.push({ day: key, count: totals.get(key) ?? 0 });
  }
  return out;
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

function longDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Quota meter: text carries the state; colour only reinforces it. */
function QuotaMeter({ quota }: { quota: NonNullable<Usage["quota"]> }) {
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const state = pct >= 100 ? "Limit reached" : pct >= 80 ? "Close to the limit" : "Within the limit";
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">Quota</span>
        <span className="font-mono tabular text-muted-strong">
          {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Quota used"
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={quota.used}
        aria-valuetext={`${quota.used} of ${quota.limit} requests used. ${state}.`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-secondary"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted">
        {state} · {pct}% used{quota.reset_at ? <> · resets <TimeText iso={quota.reset_at} /></> : null}
      </p>
    </div>
  );
}

function DailyBars({ days }: { days: Array<{ day: string; count: number }> }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">Requests per day, last 7 days</span>
        <span className="font-mono tabular text-muted-strong">{total.toLocaleString()} total</span>
      </figcaption>
      <div className="relative">
        {/* Recessive baseline grid: a single rule at zero. */}
        <ul aria-hidden className="flex h-32 items-end gap-0.5 border-b border-border" onMouseLeave={() => setActive(null)}>
          {days.map((d, i) => {
            const h = d.count === 0 ? 0 : Math.max(2, Math.round((d.count / max) * 100));
            return (
              <li
                key={d.day}
                className="flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setActive(i)}
              >
                <div
                  className={cn("w-full max-w-10 rounded-t bg-primary transition-opacity", active !== null && active !== i && "opacity-40")}
                  style={{ height: `${h}%` }}
                />
              </li>
            );
          })}
        </ul>
        {active !== null && days[active] ? (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-overlay"
            style={{ left: `${((active + 0.5) / days.length) * 100}%` }}
          >
            <span className="text-muted-strong">{longDay(days[active].day)}</span>{" "}
            <span className="font-mono tabular text-foreground">{days[active].count.toLocaleString()}</span>
          </div>
        ) : null}
        <ul aria-hidden className="mt-1 flex gap-0.5">
          {days.map((d) => (
            <li key={d.day} className="flex-1 text-center text-xs text-muted">
              {dayLabel(d.day)}
            </li>
          ))}
        </ul>
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none rounded-sm hover:text-foreground">Show as table</summary>
        <div className="mt-2 rounded-md border border-border">
          <Table caption="Requests per day, last 7 days">
            <thead>
              <tr>
                <Th>Day</Th>
                <Th align="right">Requests</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <Tr key={d.day}>
                  <Td>{longDay(d.day)}</Td>
                  <Td align="right" className="font-mono">
                    {d.count.toLocaleString()}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </figure>
  );
}

/** UI_UX_SPECIFICATIONS.md §16: usage chart (7 days) and quota bar. GET /usage?group_by=day. */
export function UsagePanel() {
  const filters = useMemo(() => {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1)));
    return { from: isoDay(from), to: isoDay(now), group_by: "day" as const };
  }, []);
  const q = useUsage(filters);
  const days = lastSevenDays(q.data);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <BarChart3 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          Usage
        </span>
      }
    >
      {q.isPending ? (
        <div role="status" aria-label="Loading usage" className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} title="We could not load usage" onRetry={() => void q.refetch()} retrying={q.isFetching} compact />
      ) : days.every((d) => d.count === 0) && !q.data?.quota ? (
        <EmptyState className="py-3" title="No requests in the last 7 days" description="Calls made with your API keys, extension and dashboard are counted here." />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailyBars days={days} />
          </div>
          {q.data?.quota ? <QuotaMeter quota={q.data.quota} /> : <p className="text-sm text-muted-strong">No quota applies to this account.</p>}
        </div>
      )}
    </Card>
  );
}
