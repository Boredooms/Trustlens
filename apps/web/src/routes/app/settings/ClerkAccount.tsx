import { lazy, Suspense } from "react";
import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useClerkAppearance } from "@/lib/auth/clerk-appearance";

// Loaded only under Clerk; the development sign-in never pulls in the Clerk bundle.
const UserProfile = lazy(() => import("@clerk/clerk-react").then((m) => ({ default: m.UserProfile })));

/** Email, password, connected accounts and active sessions are managed by Clerk (ADR-012). */
export function ClerkAccount() {
  const appearance = useClerkAppearance();
  return (
    <Card
      id="sign-in"
      title="Sign-in and security"
      description="Email addresses, password, connected accounts and active sessions — managed by Clerk."
      icon={KeyRound}
      bodyClassName="p-3 sm:p-4"
    >
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
        <div className="overflow-x-auto">
          <UserProfile routing="hash" appearance={appearance} />
        </div>
      </Suspense>
    </Card>
  );
}

export function DevAccountNote() {
  return (
    <Card id="sign-in" title="Sign-in and security" icon={KeyRound} description="Managed by Clerk when it is configured.">
      <p className="text-sm text-muted-strong">
        You are using the development sign-in. Email, password and connected accounts are managed by Clerk when it is
        configured.
      </p>
    </Card>
  );
}
