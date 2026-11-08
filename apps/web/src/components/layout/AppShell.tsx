import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Code2,
  FileWarning,
  Gavel,
  History,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquareWarning,
  Network,
  ScanSearch,
  Settings,
  ShieldHalf,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useMe, useOverview } from "@/lib/query/hooks";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils/cn";
import { Drawer } from "@/components/ui/Overlay";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toaster } from "@/components/ui/Toaster";
import { humanise } from "@/lib/format";
import { DemoBanner, EngineBanner } from "./Banners";
import { Logo } from "./Logo";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Platform roles that see this item (AUTHENTICATION_AUTHORIZATION.md §5.3). Absent = everyone. */
  roles?: string[];
}

const NAV: NavItem[] = [
  { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/app/scan", label: "Scan", icon: ScanSearch },
  { to: "/app/messages", label: "Messages", icon: MessageSquareWarning },
  { to: "/app/intelligence", label: "Intelligence", icon: Network },
  { to: "/app/campaigns", label: "Campaigns", icon: Waypoints },
  { to: "/app/organisations", label: "Organisations", icon: Building2 },
  { to: "/app/certificates", label: "Certificates", icon: ShieldHalf },
  { to: "/app/reports", label: "Reports", icon: FileWarning },
  { to: "/app/appeals", label: "Appeals", icon: Gavel, roles: ["analyst", "operator"] },
  { to: "/app/developers", label: "Developers", icon: Code2 },
  { to: "/app/audit", label: "Audit log", icon: History, roles: ["operator"] },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

function ReportQueueCount() {
  const { data } = useOverview();
  const q = data?.report_queue;
  if (!q) return null;
  const n = q.pending + q.reviewing;
  if (n <= 0) return null;
  return (
    <span className="ml-auto font-mono tabular text-xs text-muted-strong">
      {n}
      <span className="sr-only"> reports waiting</span>
    </span>
  );
}

function NavList({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const role = useMe().data?.role ?? null;
  const items = NAV.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center gap-3 rounded-sm border-l-2 px-3 text-sm transition-colors duration-150",
                isActive
                  ? "border-l-primary bg-surface-secondary text-foreground"
                  : "border-l-transparent text-muted-strong hover:bg-surface-secondary hover:text-foreground",
                compact && "justify-center px-0",
              )
            }
          >
            <item.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className={cn(compact && "sr-only")}>{item.label}</span>
            {item.to === "/app/reports" && !compact ? <ReportQueueCount /> : null}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Account() {
  const { data, isLoading, isError } = useMe();
  const { signOut, mode } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        {isLoading ? (
          <Skeleton className="h-4 w-40" />
        ) : isError ? (
          <p className="text-xs text-muted">Account details unavailable</p>
        ) : (
          <>
            <p className="text-sm leading-tight text-foreground">{data?.display_name || data?.email}</p>
            <p className="text-xs leading-tight text-muted">
              {data ? humanise(data.role) : ""}
              {mode === "dev" ? " · development sign-in" : ""}
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          void signOut().then(() => navigate("/"));
        }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-strong hover:bg-surface-secondary hover:text-foreground"
      >
        <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        Sign out
      </button>
    </div>
  );
}

function ContentFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** Fixed 240 px sidebar (icons-only 1024–1279, drawer < 768) + top bar + 1200 px content. */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const density = useUiStore((s) => s.density);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className={cn("min-h-screen bg-background", density === "compact" && "density-compact")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <DemoBanner />
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-rail shrink-0 flex-col border-r border-border bg-background md:flex xl:w-sidebar">
          <div className="flex h-14 items-center border-b border-border px-4">
            <Logo compactBelowXl />
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
            <div className="xl:hidden">
              <NavList compact />
            </div>
            <div className="hidden xl:block">
              <NavList compact={false} />
            </div>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-4 md:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
                className="rounded-sm p-1.5 text-muted-strong hover:bg-surface-secondary md:hidden"
              >
                <Menu aria-hidden className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <span className="md:hidden">
                <Logo />
              </span>
            </div>
            <Account />
          </header>
          <EngineBanner />
          <main id="main" className="mx-auto w-full max-w-content flex-1 px-4 py-8 md:px-6 md:py-10">
            <Suspense fallback={<ContentFallback />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} title="Navigation" side="left" widthClass="max-w-nav">
        <nav aria-label="Main">
          <NavList compact={false} onNavigate={() => setMobileOpen(false)} />
        </nav>
      </Drawer>
      <Toaster />
    </div>
  );
}
