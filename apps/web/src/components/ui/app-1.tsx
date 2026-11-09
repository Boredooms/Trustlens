/**
 * app-1 — the TrustLens application shell, adapted from the app-1 registry block (shadcn/ui
 * structure: SidebarProvider · App1Sidebar · SidebarInset · sticky header · main).
 *
 * Changes from the upstream block, on purpose:
 *   - Real data only. The block's stock projects, teammates and Unsplash avatars are not used;
 *     identity comes from /auth/me (+ the Clerk profile image), counts from /overview.
 *   - No Recharts. The block's area chart is rendered with the dashboard's one chart library
 *     (Bklit UI, components/charts) where charts appear — see docs/04-frontend/DASHBOARD.md §4.
 *   - Fixed chrome: the demo banner and header never scroll away; only the inset scrolls.
 *   - Sign-out lives in the sidebar footer; the header carries search, notifications and New scan.
 *   - The header greeting is not a heading, so each page keeps exactly one <h1>.
 */
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import { m } from "motion/react";
import { Bell, Plus, Search } from "lucide-react";
import { useMe } from "@/lib/query/hooks";
import { variants } from "@/lib/motion";
import { DemoBanner, EngineBanner } from "@/components/layout/Banners";
import { StatusCenter } from "@/components/domain/StatusCenter";
import { useAttentionItems } from "@/components/domain/attention";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonChart, SkeletonRows } from "@/components/ui/Skeleton";
import { Toaster } from "@/components/ui/Toaster";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/app-1-utils/sidebar";
import { App1Sidebar } from "@/components/ui/app-1-utils/app-1-sidebar";
import { firstName } from "@/components/ui/app-1-utils/app-1-data";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Search scanned addresses: hands off to /app/scan?q= (GET /scans?q=, the existing filter). */
function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Search scans" className="h-8 w-8">
          <Search aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-80 rounded-lg border border-border bg-surface p-3 shadow-overlay">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const v = q.trim();
              setOpen(false);
              navigate(v ? `/app/scan?q=${encodeURIComponent(v)}` : "/app/scan");
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="header-search" className="text-xs font-medium text-foreground">
              Search your scans
            </label>
            <Input id="header-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address contains…" />
            <p className="text-2xs text-muted">Searches scanned addresses. Press Enter.</p>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function HeaderNotifications() {
  const { items, isPending } = useAttentionItems();
  const count = items.length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={count ? `Notifications, ${count} need attention` : "Notifications"} className="relative h-8 w-8">
          <Bell aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          {count ? <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning ring-2 ring-background" /> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[22rem] rounded-lg border border-border bg-surface p-4 shadow-overlay">
          <p className="mb-2 text-sm font-medium">Needs attention</p>
          {isPending ? <SkeletonRows rows={2} label="Loading notifications" /> : <StatusCenter items={items} emptyDescription="No reports waiting, no certificates expiring within 14 days." />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ContentFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-6">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <SkeletonChart />
    </div>
  );
}

export interface App1Props {
  children: ReactNode;
}

export function App1({ children }: App1Props) {
  const me = useMe();
  const density = useUiStore((s) => s.density);
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  // The inset is the scroll container, so route changes reset it (window scroll never moves).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [location.pathname]);
  const name = firstName(me.data?.display_name || me.data?.email);

  return (
    <div className={cn("app-canvas flex h-screen flex-col overflow-hidden", density === "compact" && "density-compact")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {/* Fixed chrome: outside the scroll container, so it never scrolls away. */}
      <div className="shrink-0">
        <DemoBanner />
      </div>
      <SidebarProvider>
        <App1Sidebar />
        <SidebarInset ref={scrollRef} className="min-w-0">
          <header className="bar-glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
            <SidebarTrigger aria-label="Toggle navigation" />
            <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
            <div className="min-w-0 truncate py-1 pr-2 text-sm text-muted-strong">
              {me.isPending ? (
                <Skeleton className="h-4 w-48" />
              ) : (
                <>
                  {greeting()}
                  {name ? (
                    <>
                      ,{" "}
                      {/* Italic serif glyphs overhang their box; the padding keeps `truncate` from clipping the last letter. */}
                      <span className="font-display inline-block pr-1.5 align-baseline text-lg italic leading-none text-foreground">{name}</span>
                    </>
                  ) : null}
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <HeaderSearch />
              <HeaderNotifications />
              <Button asChild variant="default" size="sm" className="ml-2 h-8">
                <Link to="/app/scan">
                  <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                  New scan
                </Link>
              </Button>
            </div>
          </header>
          <EngineBanner />
          <main id="main" className="mx-auto w-full max-w-content flex-1 px-4 py-8 md:px-8 md:py-10">
            <Suspense fallback={<ContentFallback />}>
              {/* Keyed fade-in only: an exit animation around routed content would show the next route inside the old one. */}
              <m.div key={location.pathname} initial="hidden" animate="visible" variants={variants.fade}>
                {children}
              </m.div>
            </Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </div>
  );
}

