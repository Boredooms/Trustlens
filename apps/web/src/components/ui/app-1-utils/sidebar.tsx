/**
 * shadcn/ui-style Sidebar for the app-1 shell (the registry block imports it from
 * `@/components/ui/app-1-utils/sidebar`; its source was not part of the block, so this is a compact
 * implementation of the same API on TrustLens tokens).
 *
 * Owns: expanded ⇄ icon-rail state (persisted per device), Ctrl/⌘+B toggle, a left Sheet below 768 px,
 * tooltips on collapsed items, and focus-visible styling. Layout contract: the provider is a full-height
 * flex row; <Sidebar> is fixed width; <SidebarInset> is the only scroll container.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Overlay";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const STORAGE_KEY = "trustlens-sidebar";
const MOBILE_QUERY = "(max-width: 767px)";

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within <SidebarProvider>");
  return ctx;
}

function useIsMobile(): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_QUERY).matches : false);
  const [mobile, setMobile] = React.useState(get);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

export function SidebarProvider({ children, className }: { children: React.ReactNode; className?: string }) {
  const isMobile = useIsMobile();
  const [open, setOpenState] = React.useState(readOpen);
  const [openMobile, setOpenMobile] = React.useState(false);

  const setOpen = React.useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "expanded" : "collapsed");
    } catch {
      /* storage unavailable: state still works for this session */
    }
  }, []);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((o) => !o);
    else setOpen(!open);
  }, [isMobile, open, setOpen]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const value = React.useMemo<SidebarContextValue>(
    () => ({ state: open ? "expanded" : "collapsed", open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }),
    [open, setOpen, openMobile, isMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div data-sidebar-state={value.state} className={cn("flex min-h-0 w-full flex-1", className)}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children, className, label = "Main" }: { children: React.ReactNode; className?: string; label?: string }) {
  const { isMobile, openMobile, setOpenMobile, state } = useSidebar();
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="w-[17rem] gap-0 bg-sidebar p-0" hideClose>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <nav aria-label={label} className="flex h-full flex-col">
            {children}
          </nav>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      data-state={state}
      className={cn(
        "group/sidebar relative hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-slow ease-emphasis md:flex",
        state === "expanded" ? "w-[16rem]" : "w-[3.75rem]",
        className,
      )}
    >
      <nav aria-label={label} className="flex h-full min-h-0 flex-col">
        {children}
      </nav>
    </aside>
  );
}

export function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const expanded = isMobile ? openMobile : state === "expanded";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-expanded={expanded}
      className={cn("h-8 w-8", className)}
      title="Toggle navigation (Ctrl+B)"
      {...props}
    >
      <PanelLeft aria-hidden className="h-4 w-4" strokeWidth={1.5} />
    </Button>
  );
}

export const SidebarInset = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function SidebarInset({ className, ...props }, ref) {
  return <div ref={ref} className={cn("scroll-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto", className)} {...props} />;
});

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col gap-2 p-3", className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-3 py-2", className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col gap-2 border-t border-sidebar-border p-3", className)} {...props} />;
}

export function SidebarSeparator({ className }: { className?: string }) {
  return <div aria-hidden className={cn("mx-1 h-px bg-sidebar-border", className)} />;
}

export function SidebarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { state, isMobile } = useSidebar();
  return (
    <p
      className={cn("label-eyebrow px-2 pb-0.5 text-2xs", state === "collapsed" && !isMobile && "sr-only", className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cn("relative", className)} {...props} />;
}

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  isActive?: boolean;
  /** Shown as a tooltip when the sidebar is collapsed to icons. */
  tooltip?: string;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(function SidebarMenuButton(
  { asChild = false, isActive = false, tooltip, className, ...props },
  ref,
) {
  const { state, isMobile } = useSidebar();
  const Comp = asChild ? Slot : "button";
  const collapsed = state === "collapsed" && !isMobile;
  const button = (
    <Comp
      ref={ref}
      data-active={isActive || undefined}
      className={cn(
        "relative flex h-8 w-full items-center gap-3 overflow-hidden rounded-md px-2 text-left text-sm outline-none transition-colors duration-fast",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0 [&>span:not([data-keep])]:sr-only",
        "[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
  return collapsed && tooltip ? (
    <Tooltip content={tooltip} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
});

export function SidebarMenuBadge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) return null;
  return (
    <span
      className={cn("pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface px-1.5 font-mono tabular text-2xs leading-5 text-muted-strong", className)}
      {...props}
    />
  );
}
