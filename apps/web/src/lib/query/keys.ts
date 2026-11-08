import type { ReportFilters, ScanFilters } from "@/lib/api/endpoints";
import type { AppealFilters, AuditFilters, CertificateFilters, UsageFilters } from "@/lib/api/types";

// FRONTEND_ARCHITECTURE.md §5 — one place for query keys.
export const qk = {
  me: ["me"] as const,
  demo: ["admin", "demo"] as const,
  overview: ["overview"] as const,
  scans: (f: ScanFilters) => ["scans", f] as const,
  scan: (id: string) => ["scan", id] as const,
  investigation: (id: string) => ["investigation", id] as const,
  graph: (id: string, d: number) => ["graph", id, d] as const,
  campaigns: ["campaigns"] as const,
  campaign: (id: string) => ["campaign", id] as const,
  orgs: ["orgs"] as const,
  org: (id: string) => ["org", id] as const,
  orgDomains: (id: string) => ["org", id, "domains"] as const,
  /** Client-only cache of the one-time challenge returned when a domain is added. */
  orgDomainChallenge: (id: string, domainId: string) => ["org", id, "domain-challenge", domainId] as const,
  orgRecipients: (id: string) => ["org", id, "recipients"] as const,
  orgMembers: (id: string) => ["org", id, "members"] as const,
  orgMonitors: (id: string) => ["certificates", "monitors", id] as const,
  reports: (f: ReportFilters) => ["reports", f] as const,
  report: (id: string) => ["report", id] as const,
  certificates: (f: CertificateFilters) => ["certificates", "inventory", f] as const,
  certificate: (id: string) => ["certificates", "detail", id] as const,
  certMonitors: ["certificates", "monitors"] as const,
  certIncidents: ["certificates", "incidents"] as const,
  apiKeys: ["api-keys"] as const,
  devices: ["devices"] as const,
  appeals: (f: AppealFilters) => ["appeals", f] as const,
  appeal: (id: string) => ["appeal", id] as const,
  usage: (f: UsageFilters) => ["usage", f] as const,
  auditLogs: (f: AuditFilters) => ["audit-logs", f] as const,
};
