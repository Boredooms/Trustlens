import { Suspense } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toaster } from "@/components/ui/Toaster";
import { FloatingNav } from "@/components/marketing/FloatingNav";

/**
 * Public frame. The landing page is a full-bleed marketing surface (floating nav, no footer); every
 * other public page keeps the shared footer, which also carries the reachability guarantee its test
 * asserts.
 */
export function PublicShell() {
  const { pathname } = useLocation();
  const isLanding = pathname === "/";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {/* No demo banner on public pages: it pushed the full-height landing hero into a scroll, and
          "demo environment" belongs with the seeded dashboard it describes. */}
      <FloatingNav />
      <main id="main" className="flex-1">
        <Suspense fallback={<Skeleton className="mx-auto mt-16 h-64 max-w-content" />}>
          <Outlet />
        </Suspense>
      </main>
      {!isLanding && (
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
      )}
      <Toaster />
    </div>
  );
}
