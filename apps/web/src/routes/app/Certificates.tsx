import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeverityBadge, SimulatedBadge } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { MonitorsTable, expiryTone, type OrgOption } from "@/components/domain/Monitors";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { TabList, tabIds } from "@/components/ui/Tabs";
import { Card } from "@/components/ui/Card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCertIncidents, useCertMonitors, useCertificates, useCreateIncident, useOrganisations, useRole } from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import type { CertificateIncident, IncidentCreateBody } from "@/lib/api/types";
import { COPY } from "@/lib/copy";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils/cn";

const SIMULATED_INCIDENT: IncidentCreateBody = {
  issuer_cn: "Demo Intermediate CA",
  title: "Simulated intermediate CA compromise",
  severity: "high",
  description:
    "Simulated for demonstration: the Demo Intermediate CA is treated as compromised. Certificates it issued should be replaced. Not a real incident.",
  source: "simulation",
  simulated: true,
};

const TABS = [
  { id: "inventory", label: "Inventory" },
  { id: "monitors", label: "Monitors" },
  { id: "incidents", label: "Incidents" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function toTab(v: string | null): Tab {
  return TABS.some((t) => t.id === v) ? (v as Tab) : "monitors";
}

const EXPIRY_FILTERS = [
  ["", "Any expiry"],
  ["7", "Expiring in 7 days"],
  ["30", "Expiring in 30 days"],
  ["90", "Expiring in 90 days"],
] as const;

function Inventory() {
  const [params, setParams] = useSearchParams();
  const expiring = params.get("expiring") ?? "";
  const issuer = params.get("issuer") ?? "";
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [issuerDraft, setIssuerDraft] = useState(issuer);
  const filters = {
    expiring_within_days: expiring ? Number(expiring) : undefined,
    issuer: issuer || undefined,
    limit: 50,
    cursor,
  };
  const q = useCertificates(filters);
  const rows = listData(q.data);
  const next = q.data?.page?.next_cursor ?? null;
  const update = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setCursor(undefined);
    setParams(p, { replace: true });
  };
  return (
    <div>
      <form
        className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          update("issuer", issuerDraft.trim());
        }}
      >
        <Field label="Expiry" className="sm:w-56">
          <Select value={expiring} onChange={(e) => update("expiring", e.target.value)}>
            {EXPIRY_FILTERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Issuer" className="sm:w-72">
          <Input value={issuerDraft} onChange={(e) => setIssuerDraft(e.target.value)} placeholder="For example R3" />
        </Field>
        <div className="sm:pb-[22px]">
          <Button type="submit">Apply</Button>
        </div>
      </form>
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={4} label="Loading certificates" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load certificates" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          className="px-5"
          title={expiring || issuer ? "No certificates match these filters" : "No certificates observed yet"}
          description={expiring || issuer ? "Clear the filters to see every certificate." : "Certificates appear here once scans or monitors observe them."}
        />
      ) : (
        <>
          <Table caption="Certificate inventory">
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th className="hidden md:table-cell">Issuer</Th>
                <Th className="hidden xl:table-cell">Root</Th>
                <Th className="hidden lg:table-cell">Expires</Th>
                <Th align="right">Days left</Th>
                <Th className="hidden md:table-cell">Fingerprint</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs">
                    <Link to={`/app/certificates/${c.id}`} className="hover:underline">
                      {c.monitored_domain ?? c.subject_cn ?? c.sans?.[0] ?? c.id}
                    </Link>
                    {c.simulated ? <SimulatedBadge className="ml-2" /> : null}
                  </Td>
                  <Td className="hidden text-muted-strong md:table-cell">{c.issuer_cn}</Td>
                  <Td className="hidden text-muted-strong xl:table-cell">{c.root_issuer_cn ?? "—"}</Td>
                  <Td className="hidden text-muted-strong lg:table-cell">
                    <TimeText iso={c.not_after} mode="absolute" />
                  </Td>
                  <Td align="right" className={cn("font-mono", expiryTone(c.days_to_expiry))}>
                    {c.days_to_expiry}
                    <span className="sr-only">{c.days_to_expiry <= 30 ? " days — expiring soon" : " days"}</span>
                  </Td>
                  <Td className="hidden font-mono text-xs text-muted md:table-cell">{c.fingerprint_sha256.slice(0, 16)}…</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {next ? (
            <div className="flex justify-center border-t border-border px-5 py-3">
              <Button size="sm" loading={q.isFetching} onClick={() => setCursor(next)}>
                Next page
              </Button>
            </div>
          ) : cursor ? (
            <div className="flex justify-center border-t border-border px-5 py-3">
              <Button size="sm" variant="ghost" onClick={() => setCursor(undefined)}>
                Back to first page
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Monitors() {
  const q = useCertMonitors();
  const orgs = useOrganisations();
  const role = useRole();
  const manageable: OrgOption[] = listData(orgs.data)
    .filter((o) => role === "operator" || o.role === "org_admin")
    .map((o) => ({ id: o.id, name: o.name }));
  const ids = new Set(manageable.map((o) => o.id));
  return (
    <MonitorsTable
      query={q}
      manageableOrgs={manageable}
      canRemove={(m) => role === "operator" || (m.organisation_id ? ids.has(m.organisation_id) : false)}
    />
  );
}

function IncidentItem({ incident }: { incident: CertificateIncident }) {
  const affected = incident.affected ?? [];
  return (
    <li className="border-b border-border px-5 py-5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {incident.simulated ? <SimulatedBadge /> : null}
        <SeverityBadge severity={incident.severity} />
        <h3 className="text-sm font-medium">{incident.title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted">
        Issuer <span className="font-mono text-foreground">{incident.issuer_cn}</span> · source {incident.source} · published{" "}
        <TimeText iso={incident.published_at} />
      </p>
      {incident.simulated ? <p className="mt-2 text-xs text-warning">{COPY.simulated}</p> : null}
      <p className="mt-2 max-w-prose text-sm text-muted-strong">{incident.description}</p>
      <div className="mt-4">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium">
            Affected domains <span className="font-mono tabular text-muted">{incident.affected_domain_count}</span>
          </h4>
          {incident.simulated ? <SimulatedBadge /> : null}
        </div>
        {affected.length === 0 ? (
          <p className="mt-1 text-xs text-muted">None of your monitored domains depend on this issuer.</p>
        ) : (
          <div className="mt-2 rounded-md border border-border">
            <Table caption={`Domains affected by ${incident.title}`}>
              <thead>
                <tr>
                  <Th>Domain</Th>
                  <Th className="hidden md:table-cell">Certificate</Th>
                  <Th>Required action</Th>
                </tr>
              </thead>
              <tbody>
                {affected.map((a, i) => (
                  <Tr key={`${a.domain}-${i}`}>
                    <Td className="font-mono text-xs">{a.domain}</Td>
                    <Td className="hidden font-mono text-xs text-muted md:table-cell">{a.certificate_id ?? "—"}</Td>
                    <Td className="text-xs">Replace the certificate with one from another issuer</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {incident.affected_truncated ? (
              <p className="px-4 py-2 text-xs text-muted">Showing the first 100 affected domains.</p>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

function Incidents() {
  const q = useCertIncidents();
  if (q.isPending)
    return (
      <div className="p-5">
        <SkeletonRows rows={3} label="Loading incidents" />
      </div>
    );
  if (q.isError)
    return <ErrorState className="m-5" error={q.error} title="We could not load certificate incidents" onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  const rows = listData(q.data);
  if (rows.length === 0)
    return (
      <EmptyState
        className="px-5"
        title="No issuer incidents"
        description="When a certificate authority has an incident, the domains that depend on it are listed here."
      />
    );
  return (
    <ul>
      {rows.map((i) => (
        <IncidentItem key={i.id} incident={i} />
      ))}
    </ul>
  );
}

function DemoTools({ onCreated }: { onCreated: () => void }) {
  const create = useCreateIncident();
  return (
    <section aria-labelledby="demo-tools" className="mb-6 rounded-md border border-dashed border-warning bg-warning-surface p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="demo-tools" className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical aria-hidden className="h-4 w-4 text-warning" strokeWidth={1.5} />
            Demonstration tools
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-strong">
            Creates a simulated incident for the issuer “Demo Intermediate CA”. It is always labelled Simulated. The API
            accepts this only for operators while it runs in demo mode{env.demoMode ? "" : " (this dashboard is not in demo mode)"}.
          </p>
        </div>
        <Button variant="primary" loading={create.isPending} onClick={() => create.mutate(SIMULATED_INCIDENT, { onSuccess: onCreated })}>
          Run simulated CA incident
        </Button>
      </div>
      {create.isSuccess ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs">
          <SimulatedBadge /> Incident created. {create.data?.affected_domain_count ?? 0} monitored domains depend on this
          issuer.
        </p>
      ) : null}
      {create.isError ? <ErrorState className="mt-3" error={create.error} title="The simulated incident was not created" compact /> : null}
    </section>
  );
}

export default function Certificates() {
  const [params, setParams] = useSearchParams();
  const tab = toTab(params.get("tab"));
  const role = useRole();
  const monitors = useCertMonitors();
  const incidents = useCertIncidents();
  const monitorRows = listData(monitors.data);
  const expiring = monitorRows.filter((m) => m.days_to_expiry !== null && m.days_to_expiry <= 30).length;

  return (
    <>
      <PageHeader title="Certificates" subtitle="Certificate expiry for monitored domains, and the issuers they depend on." />
      <dl className="mb-6 grid grid-cols-3 gap-4 rounded-md border border-border bg-surface p-5">
        {[
          ["Monitored", monitors.data ? monitorRows.length : null],
          ["Expiring ≤ 30 days", monitors.data ? expiring : null],
          ["Incidents", incidents.data ? listData(incidents.data).length : null],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 font-mono tabular text-2xl">{value === null ? "—" : value}</dd>
          </div>
        ))}
      </dl>
      {role === "operator" ? <DemoTools onCreated={() => setParams({ tab: "incidents" })} /> : null}
      <TabList label="Certificate views" idPrefix="cert" tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      <Card bodyClassName="p-0" id={tabIds("cert", tab).panel} role="tabpanel" aria-labelledby={tabIds("cert", tab).tab}>
        {tab === "inventory" ? <Inventory /> : tab === "monitors" ? <Monitors /> : <Incidents />}
      </Card>
    </>
  );
}
