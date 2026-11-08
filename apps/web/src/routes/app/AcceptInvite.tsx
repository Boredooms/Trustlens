import { useEffect, useRef } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { useAcceptInvite, useMe } from "@/lib/query/hooks";
import { ORG_ROLE_LABEL } from "@/lib/copy";

/**
 * `/app/invites/:token` — the emailed link (`/invites/:token`) redirects here, so RequireAuth sends a
 * signed-out person to sign in first and back afterwards. Accepting is a single POST; the token is
 * never stored client-side.
 */
export default function AcceptInvite() {
  const { token = "" } = useParams();
  const accept = useAcceptInvite();
  const me = useMe();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !token) return;
    fired.current = true;
    accept.mutate(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once per mount
  }, [token]);

  if (accept.isSuccess && accept.data?.organisation_id)
    return <Navigate to={`/app/organisations/${accept.data.organisation_id}`} replace state={{ joined: true }} />;

  return (
    <>
      <PageHeader title="Join organisation" />
      {accept.isError ? (
        <div className="flex flex-col gap-4">
          <ErrorState error={accept.error} title="We could not accept this invitation" />
          <p className="text-sm text-muted-strong">
            You are signed in as <span className="font-mono">{me.data?.email ?? "…"}</span>. Invitations only work for the email address they were sent to.
          </p>
          <div>
            <Link to="/app/organisations" className={buttonClasses("secondary")}>
              Go to organisations
            </Link>
          </div>
        </div>
      ) : accept.isSuccess ? (
        <div role="status" className="flex flex-col gap-3 text-sm">
          <p>
            You joined {accept.data?.organisation_name ?? "the organisation"}
            {accept.data?.role ? ` as ${ORG_ROLE_LABEL[accept.data.role] ?? accept.data.role}` : ""}.
          </p>
          <Link to="/app/organisations" className={buttonClasses("primary")}>
            Open organisations
          </Link>
        </div>
      ) : (
        <div role="status" aria-label="Accepting invitation" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-24 w-full max-w-reading" />
        </div>
      )}
    </>
  );
}
