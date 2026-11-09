import { Outlet } from "react-router-dom";
import { App1 } from "@/components/ui/app-1";

/**
 * Authenticated application frame. The layout itself is the app-1 shell (components/ui/app-1.tsx):
 * fixed demo banner + header, collapsible grouped sidebar with identity and sign-out at its foot, and
 * a single scrolling content inset.
 */
export function AppShell() {
  return (
    <App1>
      <Outlet />
    </App1>
  );
}
