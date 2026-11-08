import { useParams, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SimulatedBadge, StatusPill } from "@/components/domain/Badges";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { TabList, tabIds } from "@/components/ui/Tabs";
import { canManageOrg, isAnalystRole, useOrgRole, useOrganisation, useRole } from "@/lib/query/hooks";
import { isNotFound } from "@/lib/api/errors";
import { ORG_ROLE_LABEL } from "@/lib/copy";
import { env } from "@/lib/env";
import { DomainsTab } from "./organisation/DomainsTab";
import { MembersTab } from "./organisation/MembersTab";
import { MonitoringTab } from "./organisation/MonitoringTab";
import { ProfileTab } from "./organisation/ProfileTab";
import { RecipientsTab } from "./organisation/RecipientsTab";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "domains", label: "Domains" },
  { id: "recipients", label: "Recipients" },
  { id: "members", label: "Members" },
  { id: "monitoring", label: "Monitoring" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function toTab(v: string | null): Tab {
  return TABS.some((t) => t.id === v) ? (v as Tab) : "profile";
}

export default function OrganisationDetail() {
  const { orgId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = toTab(params.get("tab"));
  const q = useOrganisation(orgId);
  const platformRole = useRole();
  const memberRole = useOrgRole(orgId);

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading organisation" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Organisation" breadcrumbs={[{ label: "Organisations", to: "/app/organisations" }, { label: "Organisation" }]} />
        {isNotFound(q.error) ? (
          <EmptyState title="This organisation does not exist or is not visible to you" />
        ) : (
          <ErrorState error={q.error} title="We could not load this organisation" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );

  const o = q.data;
  // The detail response carries the caller's org role; /auth/me is the fallback.
  const orgRole = o.role ?? memberRole;
  const canManage = canManageOrg(orgRole, platformRole);
  const canAttest = isAnalystRole(platformRole);
  const publicUrl = `${env.apiBaseUrl}/api/v1/organisations/${encodeURIComponent(o.id)}/public-profile`;
  const ids = tabIds("org", tab);

  return (
    <>
      <PageHeader
        title={o.name}
        breadcrumbs={[{ label: "Organisations", to: "/app/organisations" }, { label: o.name }]}
        meta={
          <span className="flex items-center gap-2">
            <StatusPill status={o.status} />
            {o.simulated ? <SimulatedBadge /> : null}
          </span>
        }
        subtitle={
          <span>
            {o.legal_name ?? "Trust profile"}
            {orgRole ? <span className="text-muted"> · You are {ORG_ROLE_LABEL[orgRole] ?? orgRole}</span> : null}
          </span>
        }
        actions={
          o.status === "active" ? (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4">
              Public profile
              <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null
        }
      />
      <TabList label="Organisation sections" idPrefix="org" tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
        {tab === "profile" ? <ProfileTab o={o} canManage={canManage} platformRole={platformRole} /> : null}
        {tab === "domains" ? <DomainsTab orgId={o.id} canManage={canManage} /> : null}
        {tab === "recipients" ? <RecipientsTab orgId={o.id} canManage={canManage} canAttest={canAttest} /> : null}
        {tab === "members" ? <MembersTab orgId={o.id} canManage={canManage} /> : null}
        {tab === "monitoring" ? <MonitoringTab o={o} canManage={canManage} /> : null}
      </div>
    </>
  );
}
