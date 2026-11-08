import { Suspense } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth/AuthProvider";
import { buttonClasses } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toaster } from "@/components/ui/Toaster";
import { DemoBanner } from "./Banners";
import { Logo } from "./Logo";

export function PublicShell() {
  const { status } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <DemoBanner />
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-4 md:px-6">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-2">
            {status === "signed_in" ? (
              <Link to="/app" className={buttonClasses("primary", "sm")}>
                Open dashboard
              </Link>
            ) : (
              <Link to="/login" className={buttonClasses("secondary", "sm")}>
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Suspense fallback={<Skeleton className="mx-auto mt-16 h-64 max-w-content" />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col gap-2 px-4 py-8 text-xs text-muted md:flex-row md:justify-between md:px-6">
          <p>TrustLens — website trust intelligence. Rules decide; the model only explains.</p>
          <p>We never say a site is safe. We say what we checked.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link to="/how-it-works" className="underline underline-offset-4 hover:text-foreground">
              How it works
            </Link>
            <Link to="/developers" className="underline underline-offset-4 hover:text-foreground">
              Developers
            </Link>
            <Link to="/security" className="underline underline-offset-4 hover:text-foreground">
              Security
            </Link>
            <Link to="/appeal" className="underline underline-offset-4 hover:text-foreground">
              Appeal a decision about your site
            </Link>
          </nav>
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
