import { lazy, Suspense, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { DEV_PERSONAS } from "@/lib/auth/token";
import { COPY } from "@/lib/copy";
import { Banner } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";

const ClerkSignIn = lazy(() => import("@clerk/clerk-react").then((m) => ({ default: m.SignIn })));
const ClerkSignUp = lazy(() => import("@clerk/clerk-react").then((m) => ({ default: m.SignUp })));

/** UI_UX §6 /register: Clerk sign-up; the development sign-in has no registration, so it goes to /login. */
export function Register() {
  const { status, mode } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  useEffect(() => {
    document.title = "Create account · TrustLens";
  }, []);
  if (status === "signed_in") return <Navigate to={next} replace />;
  if (mode !== "clerk") return <Navigate to={`/login${params.toString() ? `?${params.toString()}` : ""}`} replace />;
  return (
    <div className="mx-auto flex max-w-auth flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-muted-strong">Check websites, report impersonation and manage your organisation.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <ClerkSignUp routing="hash" forceRedirectUrl={next} signInForceRedirectUrl={next} />
      </Suspense>
    </div>
  );
}

/** Honour ?next= only when it points inside /app (UI_UX §6). */
export function safeNext(next: string | null): string {
  if (next && next.startsWith("/app") && !next.startsWith("//")) return next;
  return "/app";
}

export function Login() {
  const { status, mode, devSignIn, endedReason } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  useEffect(() => {
    document.title = "Sign in · TrustLens";
  }, []);

  if (status === "signed_in") return <Navigate to={next} replace />;

  return (
    <div className="mx-auto flex max-w-auth flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-strong">Use your TrustLens account to open the dashboard.</p>
      </div>
      {endedReason ? <Banner tone="neutral" title={endedReason} /> : null}
      {mode === "clerk" ? (
        <Suspense fallback={<Skeleton className="h-80 w-full" />}>
          <ClerkSignIn routing="hash" forceRedirectUrl={next} signUpForceRedirectUrl={next} />
        </Suspense>
      ) : (
        <section
          aria-labelledby="dev-signin"
          className="rounded-md border border-warning bg-warning-surface p-5"
        >
          <h2 id="dev-signin" className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical aria-hidden className="h-4 w-4 text-warning" strokeWidth={1.5} />
            {COPY.devSignInTitle}
          </h2>
          <p className="mt-2 text-xs text-muted-strong">
            No Clerk key is configured, so this build signs in with a development token. The API accepts it only when
            it runs with <code className="font-mono">DEV_AUTH_ENABLED=true</code> in development.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {DEV_PERSONAS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => devSignIn?.(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left hover:border-border-strong"
                >
                  <span>
                    <span className="block text-sm font-medium">Continue as {p.label.toLowerCase()}</span>
                    <span className="block font-mono text-xs text-muted">{p.email}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-strong">{p.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
