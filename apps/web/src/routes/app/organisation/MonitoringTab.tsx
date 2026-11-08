import { Card } from "@/components/ui/Card";
import { MonitorsTable } from "@/components/domain/Monitors";
import { useOrgMonitors } from "@/lib/query/hooks";
import type { Organisation } from "@/lib/api/types";

/** UI_UX_SPECIFICATIONS.md §12 Monitoring: monitored domains and their certificate status. */
export function MonitoringTab({ o, canManage }: { o: Organisation; canManage: boolean }) {
  const q = useOrgMonitors(o.id);
  const verified = (o.domains ?? []).filter((d) => d.status === "verified").map((d) => d.domain);
  return (
    <Card title="Certificate monitoring" bodyClassName="p-0">
      <MonitorsTable
        query={q}
        fixedOrgId={o.id}
        manageableOrgs={canManage ? [{ id: o.id, name: o.name, domains: verified }] : []}
        canRemove={() => canManage}
      />
    </Card>
  );
}
