import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfidenceBar } from "@/components/domain/Meters";
import { SimulatedBadge } from "@/components/domain/Badges";
import { TimeText } from "@/components/domain/Text";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useCampaigns } from "@/lib/query/hooks";
import { COPY } from "@/lib/copy";

export default function Campaigns() {
  const q = useCampaigns();
  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle={
          <>
            Sites that share infrastructure, certificates or payees, correlated into one operation. The number shown is
            the {COPY.campaignConfidence}.
          </>
        }
      />
      <section className="rounded-md border border-border bg-surface" aria-label="Campaign list">
        {q.isPending ? (
          <div className="p-5">
            <SkeletonRows rows={4} label="Loading campaigns" />
          </div>
        ) : q.isError ? (
          <ErrorState className="m-5" error={q.error} title="We could not load campaigns" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (q.data.data ?? []).length === 0 ? (
          <EmptyState
            className="px-5"
            title="No correlated campaigns yet"
            description="Campaigns appear when two or more scanned sites share strong indicators such as a payee or nameserver."
            action={
              <Link to="/app/scan" className="underline underline-offset-4">
                Run a scan
              </Link>
            }
          />
        ) : (
          <Table caption="Campaigns">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Confidence</Th>
                <Th align="right">Members</Th>
                <Th className="hidden md:table-cell">First seen</Th>
                <Th className="hidden md:table-cell">Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {(q.data.data ?? []).map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/app/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.simulated ? <SimulatedBadge /> : null}
                      {c.confidence < 0.6 ? <span className="text-xs text-muted">Possible campaign</span> : null}
                    </span>
                  </Td>
                  <Td>
                    <ConfidenceBar value={c.confidence} label={`Confidence for ${c.name}`} />
                  </Td>
                  <Td align="right" className="font-mono">
                    {c.member_count}
                  </Td>
                  <Td className="hidden text-muted-strong md:table-cell">
                    <TimeText iso={c.first_seen_at} />
                  </Td>
                  <Td className="hidden text-muted-strong md:table-cell">
                    <TimeText iso={c.last_seen_at} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
