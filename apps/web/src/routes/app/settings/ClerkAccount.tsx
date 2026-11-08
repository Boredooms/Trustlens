import { lazy, Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

// Loaded only under Clerk; the development sign-in never pulls in the Clerk bundle.
const UserProfile = lazy(() => import("@clerk/clerk-react").then((m) => ({ default: m.UserProfile })));

/** Email, password, connected accounts and active sessions are managed by Clerk (ADR-012). */
export function ClerkAccount() {
  return (
    <Card title="Sign-in and security">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <div className="overflow-x-auto">
          <UserProfile routing="hash" />
        </div>
      </Suspense>
    </Card>
  );
}

export function DevAccountNote() {
  return (
    <Card title="Sign-in and security">
      <p className="text-sm text-muted-strong">
        You are using the development sign-in. Email, password and connected accounts are managed by Clerk when it is
        configured.
      </p>
    </Card>
  );
}
