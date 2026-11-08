import { path, request, downloadFile } from "./client";
import type {
  DemoStatus,
  ApiKey,
  ApiKeyCreated,
  Appeal,
  AppealCreateBody,
  AppealCreated,
  AppealFilters,
  AppealReviewBody,
  AppealVerifyResult,
  AuditFilters,
  AuditLogEntry,
  Campaign,
  CampaignSummary,
  Certificate,
  CertificateFilters,
  CertificateIncident,
  CertificateMonitor,
  CertificateSummary,
  Device,
  DomainCreateBody,
  DomainVerified,
  DomainVerifyBody,
  Graph,
  IncidentCreateBody,
  InviteAccepted,
  Investigation,
  InvestigationAccepted,
  List,
  Me,
  MemberInviteBody,
  MemberInvited,
  MemberList,
  MonitorCreateBody,
  OrgDomain,
  OrgMember,
  OrgRecipient,
  Organisation,
  OrganisationCreateBody,
  OrganisationSummary,
  OrganisationUpdateBody,
  Overview,
  RecipientCreateBody,
  RecipientVerifyBody,
  PairingCode,
  Report,
  ReportCreateBody,
  ReportCreated,
  ReportSummary,
  ReviewBody,
  Scan,
  ScanAccepted,
  ScanCreateBody,
  ScanSummary,
  Usage,
  UsageFilters,
} from "./types";

export interface ScanFilters {
  limit?: number;
  cursor?: string;
  decision?: string;
  status?: string;
  q?: string;
}

export interface ReportFilters {
  status?: string;
  decision?: string;
  limit?: number;
  cursor?: string;
}

export const api = {
  admin: {
    demo: () => request<DemoStatus>("GET", "/api/v1/admin/demo"),
    resetDemo: () => request<DemoStatus>("POST", "/api/v1/admin/demo/reset", { idempotent: true }),
  },
  auth: {
    me: () => request<Me>("GET", "/api/v1/auth/me"),
    logout: () => request<void>("POST", "/api/v1/auth/logout"),
    /** USER_JOURNEYS.md J11. 409 LAST_ADMIN_REMOVAL lists the organisations to hand over first. */
    deleteMe: (confirm_email: string) => request<void>("DELETE", "/api/v1/auth/me", { body: { confirm_email } }),
    pair: (device_name: string) => request<PairingCode>("POST", "/api/v1/auth/extension/pair", { body: { device_name } }),
    devices: () => request<List<Device> | Device[]>("GET", "/api/v1/auth/extension/devices"),
    revokeDevice: (id: string) => request<void>("DELETE", path`/api/v1/auth/extension/devices/${id}`),
  },
  scans: {
    create: (body: ScanCreateBody) => request<ScanAccepted>("POST", "/api/v1/scans", { body, idempotent: true }),
    list: (f: ScanFilters) => request<List<ScanSummary>>("GET", "/api/v1/scans", { query: { ...f } }),
    get: (id: string) => request<Scan>("GET", path`/api/v1/scans/${id}`),
  },
  investigations: {
    create: (scan_id: string) =>
      request<InvestigationAccepted>("POST", "/api/v1/investigations", { body: { scan_id }, idempotent: true }),
    get: (id: string) => request<Investigation>("GET", path`/api/v1/investigations/${id}`),
    export: (id: string) => downloadFile(path`/api/v1/investigations/${id}/export`, `investigation-${id}.md`),
  },
  reports: {
    create: (body: ReportCreateBody) => request<ReportCreated>("POST", "/api/v1/reports", { body, idempotent: true }),
    list: (f: ReportFilters) => request<List<ReportSummary>>("GET", "/api/v1/reports", { query: { ...f } }),
    get: (id: string) => request<Report>("GET", path`/api/v1/reports/${id}`),
    review: (id: string, body: ReviewBody) => request<Report>("POST", path`/api/v1/reports/${id}/review`, { body }),
  },
  campaigns: {
    list: () => request<List<CampaignSummary>>("GET", "/api/v1/campaigns"),
    get: (id: string) => request<Campaign>("GET", path`/api/v1/campaigns/${id}`),
  },
  intelligence: {
    graph: (entityId: string, depth: number) =>
      request<Graph>("GET", path`/api/v1/intelligence/graph/${entityId}`, { query: { depth } }),
  },
  certificates: {
    list: (f: CertificateFilters) => request<List<CertificateSummary>>("GET", "/api/v1/certificates", { query: { ...f } }),
    get: (id: string) => request<Certificate>("GET", path`/api/v1/certificates/${id}`),
    monitors: (organisation_id?: string) =>
      request<List<CertificateMonitor>>("GET", "/api/v1/certificates/monitors", { query: { organisation_id } }),
    createMonitor: (body: MonitorCreateBody) =>
      request<CertificateMonitor>("POST", "/api/v1/certificates/monitors", { body }),
    deleteMonitor: (id: string) => request<void>("DELETE", path`/api/v1/certificates/monitors/${id}`),
    incidents: () => request<List<CertificateIncident>>("GET", "/api/v1/certificates/incidents"),
    createIncident: (body: IncidentCreateBody) =>
      request<CertificateIncident>("POST", "/api/v1/certificates/incidents", { body }),
  },
  organisations: {
    list: () => request<List<OrganisationSummary>>("GET", "/api/v1/organisations"),
    create: (body: OrganisationCreateBody) =>
      request<Organisation>("POST", "/api/v1/organisations", { body, idempotent: true }),
    get: (id: string) => request<Organisation>("GET", path`/api/v1/organisations/${id}`),
    update: (id: string, body: OrganisationUpdateBody) =>
      request<Organisation>("PATCH", path`/api/v1/organisations/${id}`, { body }),
    domains: (id: string) => request<List<OrgDomain>>("GET", path`/api/v1/organisations/${id}/domains`),
    addDomain: (id: string, body: DomainCreateBody) =>
      request<OrgDomain>("POST", path`/api/v1/organisations/${id}/domains`, { body }),
    verifyDomain: (id: string, domainId: string, body: DomainVerifyBody) =>
      request<DomainVerified>("POST", path`/api/v1/organisations/${id}/domains/${domainId}/verify`, { body }),
    removeDomain: (id: string, domainId: string) =>
      request<void>("DELETE", path`/api/v1/organisations/${id}/domains/${domainId}`),
    recipients: (id: string) => request<List<OrgRecipient>>("GET", path`/api/v1/organisations/${id}/recipients`),
    addRecipient: (id: string, body: RecipientCreateBody) =>
      request<OrgRecipient>("POST", path`/api/v1/organisations/${id}/recipients`, { body }),
    verifyRecipient: (id: string, recipientId: string, body: RecipientVerifyBody) =>
      request<OrgRecipient>("POST", path`/api/v1/organisations/${id}/recipients/${recipientId}/verify`, { body }),
    removeRecipient: (id: string, recipientId: string) =>
      request<void>("DELETE", path`/api/v1/organisations/${id}/recipients/${recipientId}`),
    members: (id: string) => request<MemberList>("GET", path`/api/v1/organisations/${id}/members`),
    inviteMember: (id: string, body: MemberInviteBody) =>
      request<MemberInvited>("POST", path`/api/v1/organisations/${id}/members`, { body }),
    updateMember: (id: string, userId: string, role: string) =>
      request<OrgMember>("PATCH", path`/api/v1/organisations/${id}/members/${userId}`, { body: { role } }),
    removeMember: (id: string, userId: string) =>
      request<void>("DELETE", path`/api/v1/organisations/${id}/members/${userId}`),
    revokeInvite: (id: string, inviteId: string) =>
      request<void>("DELETE", path`/api/v1/organisations/${id}/invites/${inviteId}`),
  },
  invites: {
    // Not in API_ENDPOINTS.md §1 (the docs define no accept route); matches the governance backend.
    accept: (token: string) => request<InviteAccepted>("POST", path`/api/v1/invites/${token}/accept`),
  },
  appeals: {
    // Auth: none (§11). Sent without credentials so an owner can appeal without an account.
    create: (body: AppealCreateBody) =>
      request<AppealCreated>("POST", "/api/v1/appeals", { body, auth: false, idempotent: true }),
    verify: (id: string) => request<AppealVerifyResult>("POST", path`/api/v1/appeals/${id}/verify`, { auth: false }),
    list: (f: AppealFilters) => request<List<Appeal>>("GET", "/api/v1/appeals", { query: { ...f } }),
    get: (id: string) => request<Appeal>("GET", path`/api/v1/appeals/${id}`),
    review: (id: string, body: AppealReviewBody) => request<Appeal>("POST", path`/api/v1/appeals/${id}/review`, { body }),
  },
  usage: (f: UsageFilters) => request<Usage>("GET", "/api/v1/usage", { query: { ...f } }),
  auditLogs: (f: AuditFilters) => request<List<AuditLogEntry>>("GET", "/api/v1/audit-logs", { query: { ...f } }),
  apiKeys: {
    list: () => request<List<ApiKey>>("GET", "/api/v1/api-keys"),
    create: (body: { name: string; scopes: string[]; kind: "api_key" }) =>
      request<ApiKeyCreated>("POST", "/api/v1/api-keys", { body }),
    revoke: (id: string) => request<void>("DELETE", path`/api/v1/api-keys/${id}`),
  },
  overview: () => request<Overview>("GET", "/api/v1/overview"),
};

/** Some list endpoints are documented as "list of" without the envelope; accept both. */
export function listData<T>(v: List<T> | T[] | undefined | null): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Array.isArray(v.data) ? v.data : [];
}
