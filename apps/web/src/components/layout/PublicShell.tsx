import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toaster } from "@/components/ui/Toaster";
import { FloatingNav } from "@/components/marketing/FloatingNav";
import { HalftoneWordmarkFooter, type FooterColumn } from "@/components/ui/halftone-wordmark-footer";

/** Every public page is reachable from here (info.test.tsx "footer links reach every public page"). */
const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Method", href: "/method" },
      { label: "Demo", href: "/demo" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Security", href: "/security" },
      { label: "Developers", href: "/developers" },
      { label: "Appeal a decision about your site", href: "/appeal" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/Boredooms/Trustlens" },
      { label: "Browser extension", href: "https://github.com/Boredooms/Trustlens/releases/latest" },
      { label: "API status", href: "https://trustlens-api-m65a.onrender.com/ready" },
      { label: "About", href: "/about" },
    ],
  },
];

/**
 * Public frame. The landing page is a full-bleed marketing surface (floating nav, no footer); every
 * other public page ends on the halftone wordmark footer, whose "Footer" landmark carries the
 * reachability guarantee its test asserts.
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
        <HalftoneWordmarkFooter
          wordmark="trustlens"
          label="TrustLens"
          meta="Website trust intelligence. Rules decide; the model only explains. We never say a site is safe — we say what we checked."
          columns={FOOTER_COLUMNS}
          fontFamily='"Geist Sans", "Inter Tight", "Helvetica Neue", Arial, system-ui, sans-serif'
          fontWeight={500}
          height="clamp(420px, 46vw, 560px)"
          crop={0.18}
        >
          © {new Date().getFullYear()} TrustLens · MIT licensed
        </HalftoneWordmarkFooter>
      )}
      <Toaster />
    </div>
  );
}
