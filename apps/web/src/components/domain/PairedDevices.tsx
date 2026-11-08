import { TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { listData } from "@/lib/api/endpoints";
import { useDevices, useRevokeDevice } from "@/lib/query/hooks";

/** Browsers paired with this account (extension device tokens), each revocable. */
export function PairedDevices() {
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const rows = listData(devices.data);
  return (
    <div>
    <h3 className="text-sm font-medium">Paired devices</h3>
    {devices.isPending ? (
      <div className="mt-3">
        <SkeletonRows rows={2} label="Loading devices" />
      </div>
    ) : devices.isError ? (
      <ErrorState className="mt-3" error={devices.error} title="We could not load paired devices" onRetry={() => void devices.refetch()} compact />
    ) : rows.length === 0 ? (
      <EmptyState className="py-3" title="No paired devices" description="Generate a code and enter it in the extension." />
    ) : (
      <ul className="mt-3 divide-y divide-border">
        {rows.map((d) => (
          <li key={d.id} className="row-density flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm">{d.name}</p>
              <p className="text-xs text-muted">
                Last used <TimeText iso={d.last_used_at} />
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              loading={revoke.isPending && revoke.variables === d.id}
              onClick={() => revoke.mutate(d.id)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    )}
    {revoke.isError ? <ErrorState className="mt-3" error={revoke.error} title="The device was not revoked" compact /> : null}
    </div>
  );
}
