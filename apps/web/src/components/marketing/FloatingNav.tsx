import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { buttonClasses } from "@/components/ui/Button";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils/cn";

const ROUTE_LINKS = [
  { label: "Features", to: "/features" },
  { label: "Method", to: "/method" },
  { label: "Demo", to: "/demo" },
  { label: "Docs", to: "/docs" },
  { label: "About", to: "/about" },
  { label: "How it works", to: "/how-it-works" },
] as const;

/**
 * A floating pill header. It sits above the content rather than owning a full-width bar, so the
 * landing page opens on the headline instead of on chrome.
 */
export function FloatingNav() {
  const { status } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = ROUTE_LINKS;


  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      <header
        className={cn(
          "pointer-events-auto w-full max-w-content rounded-full border border-border bar-glass transition-shadow duration-base",
          scrolled ? "shadow-raised" : "shadow-card",
        )}
      >
        <div className="flex h-12 items-center gap-3 pl-3 pr-2 sm:h-14 sm:pl-4">
          <Logo />
          <span aria-hidden className="hidden h-5 w-px bg-border md:block" />

          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
            {links.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="rounded-full px-3 py-1.5 text-xs text-muted-strong transition-colors duration-fast hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="nav-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-strong transition-colors duration-fast hover:text-foreground md:hidden"
            >
              {open ? <X aria-hidden className="h-4 w-4" /> : <Menu aria-hidden className="h-4 w-4" />}
            </button>
            {status === "signed_in" ? (
              <Link to="/app" className={buttonClasses("primary", "sm")}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className={cn(buttonClasses("ghost", "sm"), "hidden sm:inline-flex")}>
                  Sign in
                </Link>
                <Link to="/register" className={buttonClasses("primary", "sm")}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>

        {open && (
          <div id="nav-menu" className="border-t border-border px-3 py-2 md:hidden">
            <nav aria-label="Sections" className="flex flex-col">
              {links.map((link) => (
                <Link
                  key={link.label}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 text-sm text-muted-strong hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm text-muted-strong hover:text-foreground sm:hidden"
              >
                Sign in
              </Link>
            </nav>
          </div>
        )}
      </header>
    </div>
  );
}
