import { useMemo } from "react";
import { CalendarClock, FileWarning, Gauge, ShieldAlert } from "lucide-react";
import { useOverview } from "@/lib/query/hooks";
import type { ScanSummary } from "@/lib/api/types";
import { recentChange } from "@/lib/insights";
import { plural } from "@/lib/format";
import { TimeText } from "./Text";
import type { StatusItem } from "./StatusCenter";

/**
 * The single source for "needs attention" (Overview rail + header bell). Items come from stored data
 * only: the report queue, certificate monitors, the quota and — when scan rows are supplied — engine
 * decisions recorded in the last 24 h. Nothing here judges a site.
 */
export function useAttentionItems(rows?: ScanSummary[]): { items: StatusItem[]; isPending: boolean; isError: boolean } {
  const overview = useOverview();
  const items = useMemo(() => {
    const out: StatusItem[] = [];
    const data = overview.data;
    const rq = data?.report_queue;
    if (rq && rq.pending + rq.reviewing > 0) {
      out.push({
        id: "reports",
        tone: "warning",
        icon: FileWarning,
        title: `${plural(rq.pending + rq.reviewing, "community report")} waiting`,
        detail: `${rq.pending} pending, ${rq.reviewing} in review`,
        to: "/app/reports?status=pending",
        source: "Report queue",
      });
    }
    for (const c of (data?.certificate_alerts ?? []).filter((c) => c.days_to_expiry <= 14).slice(0, 2)) {
      out.push({
        id: `cert-${c.monitor_id}`,
        tone: c.days_to_expiry <= 7 ? "danger" : "warning",
        icon: CalendarClock,
        title: `${c.domain} certificate expires in ${plural(c.days_to_expiry, "day")}`,
        to: "/app/certificates",
        source: "Certificate monitor",
      });
    }
    if (rows) {
      const change = recentChange(rows);
      if (change.blockedLast24h > 0) {
        out.push({
          id: "blocked",
          tone: "danger",
          icon: ShieldAlert,
          title: `${plural(change.blockedLast24h, "scan")} blocked in the last 24 hours`,
          detail: "Engine decisions, as recorded",
          to: "/app/scan?decision=BLOCK",
          source: "Your scans",
        });
      }
    }
    const quota = data?.quota;
    if (quota && quota.scans_limit > 0 && quota.scans_used / quota.scans_limit >= 0.8) {
      out.push({
        id: "quota",
        tone: "warning",
        icon: Gauge,
        title: `${quota.scans_used} of ${quota.scans_limit} scans used`,
        detail: (
          <>
            Resets <TimeText iso={quota.resets_at} />
          </>
        ),
        source: "Quota",
      });
    }
    return out;
  }, [overview.data, rows]);
  return { items, isPending: overview.isPending, isError: overview.isError };
}
