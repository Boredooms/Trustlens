import { useMemo, useState } from "react";
import { useReverification } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { detailList, isApiError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useDeleteAccount } from "@/lib/query/hooks";
import { api } from "@/lib/api/endpoints";
import { clerkEnabled } from "@/lib/env";
import { asReverificationHint, normaliseReverificationError, settleReverified } from "@/lib/auth/reverification";
import { toast } from "@/stores/toast";

/** Organisations the user is the last administrator of (409 LAST_ADMIN_REMOVAL details). */
export function blockingOrganisations(error: unknown): Array<{ id: string; name: string }> {
  if (!isApiError(error) || error.code !== "LAST_ADMIN_REMOVAL") return [];
  return detailList(error)
    .map((d) => ({ id: String(d.organisation_id ?? ""), name: String(d.name ?? d.organisation_id ?? "") }))
    .filter((o) => o.id);
}

/**
 * Under Clerk the API requires a recent first-factor verification (403 REVERIFICATION_REQUIRED);
 * Clerk's `useReverification` opens its modal and retries. Exported for tests.
 */
export function useClerkReverifiedDelete(): (confirmEmail: string) => Promise<unknown> {
  const fetcher = useMemo(() => asReverificationHint(api.auth.deleteMe), []);
  const reverified = useReverification(fetcher);
  return useMemo(
    () => async (confirmEmail: string) => {
      try {
        return settleReverified(await reverified(confirmEmail));
      } catch (e) {
        throw normaliseReverificationError(e);
      }
    },
    [reverified],
  );
}

function useDevDelete(): (confirmEmail: string) => Promise<unknown> {
  return api.auth.deleteMe;
}

// Chosen once from build-time config, so the hook order never changes between renders.
const useDeleteFn = clerkEnabled ? useClerkReverifiedDelete : useDevDelete;

/** USER_JOURNEYS.md J11: delete the account after typing its email; last admins must transfer first. */
export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteAccount(useDeleteFn());
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const blocking = blockingOrganisations(del.error);

  const confirm = () =>
    del.mutate(email, {
      onSuccess: async () => {
        setOpen(false);
        try {
          await signOut();
        } finally {
          toast.success("Your account was deleted", "Sessions, API keys and paired browsers were revoked.");
          navigate("/", { replace: true });
        }
      },
      // A last-admin refusal is explained on the page (with links), so the dialog steps aside.
      onError: (e) => {
        if (blockingOrganisations(e).length > 0) setOpen(false);
      },
    });

  return (
    <Card title="Delete account">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-strong">
          Deleting your account signs you out everywhere and revokes your API keys and paired browsers. Your scans and
          reports are anonymised or removed; confirmed threat intelligence stays, without your name.
        </p>
        {blocking.length > 0 ? (
          <div role="alert" className="rounded-md border border-border p-3">
            <p className="font-medium">Transfer ownership first</p>
            <p className="mt-1 text-muted-strong">You are the only administrator of:</p>
            <ul className="mt-2 list-disc pl-5">
              {blocking.map((o) => (
                <li key={o.id}>
                  <Link className="underline underline-offset-2" to={`/app/organisations/${o.id}?tab=members`}>
                    {o.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-strong">Promote another member to administrator, then try again.</p>
          </div>
        ) : null}
        <div>
          <Button
            variant="danger"
            onClick={() => {
              del.reset();
              setOpen(true);
            }}
          >
            Delete account…
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) del.reset();
        }}
        title="Delete your account?"
        consequence="This cannot be undone. Type your account email to confirm."
        confirmLabel="Delete account"
        typedConfirmation={email}
        onConfirm={confirm}
        pending={del.isPending}
        error={blocking.length > 0 ? undefined : del.error}
        errorTitle="Your account was not deleted"
      />
    </Card>
  );
}
