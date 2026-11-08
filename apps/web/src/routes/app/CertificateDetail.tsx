import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { SimulatedBadge } from "@/components/domain/Badges";
import { expiryTone } from "@/components/domain/Monitors";
import { CopyButton, TimeText } from "@/components/domain/Text";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCertificate } from "@/lib/query/hooks";
import { isNotFound } from "@/lib/api/errors";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils/cn";

export default function CertificateDetail() {
  const { certificateId = "" } = useParams();
  const q = useCertificate(certificateId);
  const crumbs = [{ label: "Certificates", to: "/app/certificates?tab=inventory" }, { label: "Certificate" }];

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading certificate" className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Certificate" breadcrumbs={crumbs} />
        {isNotFound(q.error) ? (
          <EmptyState title="This certificate does not exist or is not visible to you" />
        ) : (
          <ErrorState error={q.error} title="We could not load this certificate" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );

  const c = q.data;
  const title = c.monitored_domain ?? c.subject_cn ?? "Certificate";
  const chain = c.chain ?? [];
  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[crumbs[0] as { label: string; to: string }, { label: title }]}
        meta={c.simulated ? <SimulatedBadge /> : null}
        subtitle={<>Issued by {c.issuer_cn}</>}
      />
      {c.simulated ? <p className="mb-4 text-xs text-warning">{COPY.simulated}</p> : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card title="Validity" className="xl:col-span-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Days left</dt>
            <dd className={cn("font-mono tabular", expiryTone(c.days_to_expiry))}>
              {c.days_to_expiry}
              {c.days_to_expiry <= 30 ? <span className="sr-only"> — expiring soon</span> : null}
            </dd>
            <dt className="text-muted">Valid from</dt>
            <dd>
              <TimeText iso={c.not_before} mode="absolute" />
            </dd>
            <dt className="text-muted">Valid until</dt>
            <dd>
              <TimeText iso={c.not_after} mode="absolute" />
            </dd>
            <dt className="text-muted">First seen</dt>
            <dd>
              <TimeText iso={c.first_seen_at} mode="absolute" />
            </dd>
            <dt className="text-muted">Last seen</dt>
            <dd>
              <TimeText iso={c.last_seen_at} mode="absolute" />
            </dd>
          </dl>
        </Card>
        <Card title="Identity" className="xl:col-span-7">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Subject</dt>
            <dd className="break-all font-mono text-xs">{c.subject_cn ?? "—"}</dd>
            <dt className="text-muted">Issuer</dt>
            <dd className="break-all">{c.issuer_cn}</dd>
            <dt className="text-muted">Root</dt>
            <dd className="break-all">{c.root_issuer_cn ?? "—"}</dd>
            <dt className="text-muted">Key</dt>
            <dd className="font-mono text-xs">
              {c.key_type ?? "—"}
              {c.key_bits ? ` ${c.key_bits}` : ""}
            </dd>
            <dt className="text-muted">Signature</dt>
            <dd className="font-mono text-xs">{c.signature_algorithm ?? "—"}</dd>
            <dt className="text-muted">Fingerprint</dt>
            <dd className="flex items-start gap-2">
              <span className="break-all font-mono text-xs">{c.fingerprint_sha256}</span>
              <CopyButton value={c.fingerprint_sha256} label="Copy" className="shrink-0" />
            </dd>
          </dl>
          {c.sans && c.sans.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-muted">Names covered</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {c.sans.map((s) => (
                  <li key={s} className="rounded-sm border border-border px-2 py-0.5 font-mono text-xs">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
        <Card title="Chain" className="xl:col-span-12" bodyClassName="p-0">
          {chain.length === 0 ? (
            <EmptyState className="px-5" title="No chain recorded" description="The chain is recorded when the certificate is observed during a scan or monitor check." />
          ) : (
            <Table caption="Certificate chain">
              <thead>
                <tr>
                  <Th>Position</Th>
                  <Th>Subject</Th>
                  <Th className="hidden md:table-cell">Issuer</Th>
                  <Th className="hidden lg:table-cell">Expires</Th>
                </tr>
              </thead>
              <tbody>
                {chain.map((e, i) => (
                  <Tr key={`${e.fingerprint_sha256 ?? e.subject_cn ?? ""}-${i}`}>
                    <Td className="text-muted-strong">{i === 0 ? "Leaf" : i === chain.length - 1 ? "Root" : "Intermediate"}</Td>
                    <Td className="break-all font-mono text-xs">{e.subject_cn ?? "—"}</Td>
                    <Td className="hidden break-all text-muted-strong md:table-cell">{e.issuer_cn ?? "—"}</Td>
                    <Td className="hidden text-muted-strong lg:table-cell">
                      <TimeText iso={e.not_after ?? null} mode="absolute" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
