/**
 * app-1 configuration for TrustLens. The upstream block ships stock data (projects, teammates,
 * Unsplash avatars); TrustLens shows only real data, so this file holds navigation, not content.
 * Every figure the shell displays comes from the API (useMe, useOverview).
 */
import {
  Building2,
  Code2,
  FileWarning,
  Gavel,
  History,
  LayoutGrid,
  MessageSquareWarning,
  Network,
  ScanSearch,
  Settings,
  ShieldHalf,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export interface App1NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Platform roles that see this item (AUTHENTICATION_AUTHORIZATION.md §5.3). Absent = everyone. */
  roles?: string[];
  /** Show the report-queue count as a badge. */
  badge?: "reports";
}

export interface App1NavSection {
  label: string;
  items: App1NavItem[];
}

/** Information architecture: what you do, what you learn, who you trust, your workspace. */
export const app1Nav: App1NavSection[] = [
  {
    label: "Investigate",
    items: [
      { to: "/app", label: "Overview", icon: LayoutGrid, end: true },
      { to: "/app/scan", label: "Scan", icon: ScanSearch },
      { to: "/app/messages", label: "Messages", icon: MessageSquareWarning },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/app/intelligence", label: "Intelligence", icon: Network },
      { to: "/app/campaigns", label: "Campaigns", icon: Waypoints },
      { to: "/app/certificates", label: "Certificates", icon: ShieldHalf },
    ],
  },
  {
    label: "Trust",
    items: [
      { to: "/app/organisations", label: "Organisations", icon: Building2 },
      { to: "/app/reports", label: "Reports", icon: FileWarning, badge: "reports" },
      { to: "/app/appeals", label: "Appeals", icon: Gavel, roles: ["analyst", "operator"] },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/app/developers", label: "Developers", icon: Code2 },
      { to: "/app/audit", label: "Audit log", icon: History, roles: ["operator"] },
      { to: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function firstName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  if (n.includes("@")) return n.split("@")[0] ?? "";
  return n.split(/\s+/)[0] ?? "";
}
