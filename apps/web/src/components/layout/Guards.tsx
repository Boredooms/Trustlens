import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useRouteError } from "react-router-dom";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { buttonClasses } from "@/components/ui/Button";
import { TechnicalDetails } from "@/components/ui/States";
import { isApiError } from "@/lib/api/errors";

/** Full-page skeleton while the session resolves; redirects to /login?next= when signed out. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div role="status" aria-label="Checking your session" className="flex min-h-screen">
        <div className="hidden w-sidebar border-r border-border md:block" />
        <div className="flex flex-1 flex-col gap-6 p-10">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-48 w-full max-w-content" />
        </div>
      </div>
    );
  }
  if (status === "signed_out") {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

/** Route-level error boundary: never a blank screen, never a stack trace. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "An unexpected error stopped this page from rendering.";
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-reading flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-medium">This page stopped working</h1>
      <p className="text-sm text-muted-strong">
        Something in the dashboard failed while showing this page. Your data on the server is unaffected. Reload to try
        again, or go back to the overview.
      </p>
      <div className="flex gap-3">
        <button type="button" className={buttonClasses("primary")} onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/app" className={buttonClasses("secondary")}>
          Back to dashboard
        </Link>
      </div>
      {isApiError(error) ? (
        <TechnicalDetails code={error.code} status={error.status} requestId={error.requestId} />
      ) : (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 font-mono">{message}</p>
        </details>
      )}
    </div>
  );
}

export function Forbidden({ what, needs = "an analyst or operator role" }: { what: string; needs?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-5">
      <p className="text-sm font-medium">You do not have access to {what}</p>
      <p className="text-sm text-muted-strong">
        This area needs {needs}. Ask an operator to change your role if you need it.
      </p>
    </div>
  );
}
