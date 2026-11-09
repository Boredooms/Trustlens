import { NavLink, useNavigate } from "react-router-dom";
import { m } from "motion/react";
import { LogOut, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useMe, useOverview } from "@/lib/query/hooks";
import { THEMES, useUiStore, type Theme } from "@/stores/ui";
import { humanise } from "@/lib/format";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/Logo";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Overlay";
import { Avatar, AvatarFallback, initialsOf } from "@/components/ui/avatar";
import { UserAvatarImage } from "@/components/ui/app-1-utils/user-avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";
import { app1Nav } from "./app-1-data";

function ReportBadge() {
  const q = useOverview().data?.report_queue;
  const n = q ? q.pending + q.reviewing : 0;
  if (n <= 0) return null;
  return (
    <SidebarMenuBadge>
      {n}
      <span className="sr-only"> reports waiting</span>
    </SidebarMenuBadge>
  );
}

const THEME_ICON: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL: Record<Theme, string> = { system: "Match system", light: "Light", dark: "Dark" };

/** Compact three-way theme switch (radio group), part of the sidebar footer. */
function ThemeSwitch() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  if (collapsed) {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
    const Icon = THEME_ICON[theme];
    return (
      <Tooltip content={`Theme: ${THEME_LABEL[theme]} (click for ${THEME_LABEL[next]})`} side="right">
        <button type="button" onClick={() => setTheme(next)} className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground">
          <Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          <span className="sr-only">Theme: {THEME_LABEL[theme]}</span>
        </button>
      </Tooltip>
    );
  }
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 rounded-md border border-sidebar-border bg-background p-0.5">
      {THEMES.map((t) => {
        const Icon = THEME_ICON[t];
        const active = t === theme;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            title={THEME_LABEL[t]}
            onClick={() => setTheme(t)}
            className={cn(
              "flex h-7 items-center justify-center rounded-sm transition-colors duration-fast",
              active ? "bg-sidebar-accent text-foreground shadow-card" : "text-sidebar-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="sr-only">{THEME_LABEL[t]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Identity and sign-out live at the foot of the sidebar (never in the top bar). */
function AccountFooter() {
  const me = useMe();
  const { signOut, mode } = useAuth();
  const navigate = useNavigate();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const name = me.data?.display_name || me.data?.email || "";
  const doSignOut = () => {
    void signOut().then(() => navigate("/"));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-2.5 rounded-md", collapsed ? "justify-center" : "px-1")}>
        <Avatar className="h-8 w-8">
          {mode === "clerk" ? <UserAvatarImage /> : null}
          <AvatarFallback>{me.isPending ? "·" : initialsOf(name)}</AvatarFallback>
        </Avatar>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            {me.isPending ? (
              <Skeleton className="h-4 w-28" />
            ) : me.isError ? (
              <p className="text-xs text-muted">Account unavailable</p>
            ) : (
              <>
                <p className="truncate text-sm leading-tight text-foreground">{name}</p>
                <p className="truncate text-2xs leading-tight text-muted">
                  {me.data ? humanise(me.data.role) : ""}
                  {mode === "dev" ? " · development sign-in" : ""}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={doSignOut} tooltip="Sign out" className="text-sidebar-foreground hover:text-danger">
            <LogOut aria-hidden strokeWidth={1.5} />
            <span>Sign out</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}

/** TrustLens navigation in the app-1 sidebar: grouped sections, role-filtered, spring active pill. */
export function App1Sidebar() {
  const role = useMe().data?.role ?? null;
  const { setOpenMobile, isMobile, state } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <Sidebar>
      <SidebarHeader className={cn("h-14 justify-center", collapsed && "items-center px-0")}>
        <Logo to="/app" compactBelowXl={false} hideWordmark={collapsed} />
      </SidebarHeader>
      <SidebarContent>
        {app1Nav.map((section) => {
          const items = section.items.filter((i) => !i.roles || (role !== null && i.roles.includes(role)));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => isMobile && setOpenMobile(false)}
                      className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {({ isActive }) => (
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                          <span aria-current={isActive ? "page" : undefined}>
                            {isActive ? (
                              <m.span
                                layoutId={isMobile ? "nav-active-mobile" : "nav-active"}
                                transition={transitions.layout}
                                aria-hidden
                                data-keep=""
                                className="nav-glow absolute inset-0 rounded-md bg-sidebar-accent"
                              />
                            ) : null}
                            <item.icon aria-hidden className="relative h-4 w-4 shrink-0" strokeWidth={1.5} />
                            <span className="relative">{item.label}</span>
                            {item.badge === "reports" ? <ReportBadge /> : null}
                          </span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <ThemeSwitch />
        <AccountFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
