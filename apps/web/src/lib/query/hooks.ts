import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReportFilters, type ScanFilters } from "@/lib/api/endpoints";
import { isTerminalStatus } from "@/lib/api/enums";
import type {
  AppealCreateBody,
  AppealFilters,
  AppealReviewBody,
  AuditFilters,
  CertificateFilters,
  DomainChallenge,
  DomainCreateBody,
  DomainVerifyBody,
  IncidentCreateBody,
  MemberInviteBody,
  MonitorCreateBody,
  OrganisationCreateBody,
  OrganisationUpdateBody,
  RecipientCreateBody,
  RecipientVerifyBody,
  ReportCreateBody,
  ReviewBody,
  ScanCreateBody,
  UsageFilters,
} from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { qk } from "./keys";

// ── Session ───────────────────────────────────────────────────────────────────
export function useMe() {
  const { status } = useAuth();
  return useQuery({ queryKey: qk.me, queryFn: api.auth.me, enabled: status === "signed_in", staleTime: 60_000 });
}

export function useRole(): string | null {
  return useMe().data?.role ?? null;
}

export function isAnalystRole(role: string | null): boolean {
  return role === "analyst" || role === "operator";
}

// ── Polling with a hard cap (§5.1) ────────────────────────────────────────────
function usePollingCap(id: string, terminal: boolean, capMs: number) {
  const [epoch, setEpoch] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (terminal) return;
    const t = setTimeout(() => setTimedOut(true), capMs);
    return () => clearTimeout(t);
  }, [id, terminal, capMs, epoch]);
  return { timedOut: timedOut && !terminal, keepWaiting: () => setEpoch((e) => e + 1) };
}

export function useScan(id: string) {
  const [stopped, setStopped] = useState(false);
  const query = useQuery({
    queryKey: qk.scan(id),
    queryFn: () => api.scans.get(id),
    staleTime: 0,
    refetchInterval: (q) => (stopped || isTerminalStatus(q.state.data?.status) ? false : 1000),
    // keep polling through a transient failure, but surface it
    retry: 1,
  });
  const terminal = query.data ? isTerminalStatus(query.data.status) : false;
  const cap = usePollingCap(id, terminal, 90_000);
  useEffect(() => setStopped(cap.timedOut), [cap.timedOut]);
  return { ...query, timedOut: cap.timedOut, keepWaiting: cap.keepWaiting };
}

export function useInvestigation(id: string) {
  const [stopped, setStopped] = useState(false);
  const query = useQuery({
    queryKey: qk.investigation(id),
    queryFn: () => api.investigations.get(id),
    staleTime: 0,
    refetchInterval: (q) => (stopped || isTerminalStatus(q.state.data?.status) ? false : 1000),
  });
  const terminal = query.data ? isTerminalStatus(query.data.status) : false;
  const cap = usePollingCap(id, terminal, 120_000);
  useEffect(() => setStopped(cap.timedOut), [cap.timedOut]);
  return { ...query, timedOut: cap.timedOut, keepWaiting: cap.keepWaiting };
}

/** One-shot scan fetch (no polling) — used to resolve investigation references. */
export function useScanSnapshot(id: string | undefined) {
  return useQuery({
    queryKey: qk.scan(id ?? ""),
    queryFn: () => api.scans.get(id ?? ""),
    enabled: Boolean(id),
  });
}

// ── Lists and resources ───────────────────────────────────────────────────────
export function useScans(f: ScanFilters) {
  return useQuery({ queryKey: qk.scans(f), queryFn: () => api.scans.list(f) });
}

export function useOverview() {
  return useQuery({ queryKey: qk.overview, queryFn: api.overview });
}

export function useCampaigns() {
  return useQuery({ queryKey: qk.campaigns, queryFn: api.campaigns.list });
}

export function useCampaign(id: string) {
  return useQuery({ queryKey: qk.campaign(id), queryFn: () => api.campaigns.get(id) });
}

export function useGraph(entityId: string | null, depth: number) {
  return useQuery({
    queryKey: qk.graph(entityId ?? "", depth),
    queryFn: () => api.intelligence.graph(entityId ?? "", depth),
    enabled: Boolean(entityId),
  });
}

export function useCertMonitors() {
  return useQuery({ queryKey: qk.certMonitors, queryFn: () => api.certificates.monitors() });
}

export function useCertIncidents() {
  return useQuery({ queryKey: qk.certIncidents, queryFn: api.certificates.incidents });
}

export function useReports(f: ReportFilters) {
  return useQuery({ queryKey: qk.reports(f), queryFn: () => api.reports.list(f) });
}

export function useReport(id: string) {
  return useQuery({ queryKey: qk.report(id), queryFn: () => api.reports.get(id) });
}

export function useOrganisations() {
  return useQuery({ queryKey: qk.orgs, queryFn: api.organisations.list });
}

export function useOrganisation(id: string) {
  return useQuery({ queryKey: qk.org(id), queryFn: () => api.organisations.get(id) });
}

export function useOrgDomains(id: string) {
  return useQuery({ queryKey: qk.orgDomains(id), queryFn: () => api.organisations.domains(id) });
}

export function useOrgRecipients(id: string) {
  return useQuery({ queryKey: qk.orgRecipients(id), queryFn: () => api.organisations.recipients(id) });
}

export function useApiKeys() {
  return useQuery({ queryKey: qk.apiKeys, queryFn: api.apiKeys.list });
}

export function useDevices() {
  return useQuery({ queryKey: qk.devices, queryFn: api.auth.devices });
}

// ── Mutations (§5.2 — invalidate the narrowest prefix) ────────────────────────
export function useCreateScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScanCreateBody) => api.scans.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useCreateInvestigation() {
  return useMutation({ mutationFn: (scanId: string) => api.investigations.create(scanId) });
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportCreateBody) => api.reports.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reports"] });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useReviewReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewBody) => api.reports.review(id, body),
    onSuccess: (data) => {
      if (data) qc.setQueryData(qk.report(id), data);
      void qc.invalidateQueries({ queryKey: ["reports"] });
      void qc.invalidateQueries({ queryKey: qk.report(id) });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IncidentCreateBody) => api.certificates.createIncident(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["certificates"] });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes: string[] }) => api.apiKeys.create({ ...body, kind: "api_key" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiKeys.revoke(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
}

export function usePairExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceName: string) => api.auth.pair(deviceName),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

export function useDeleteAccount(deleteFn: (confirmEmail: string) => Promise<unknown> = api.auth.deleteMe) {
  return useMutation({ mutationFn: (confirmEmail: string) => deleteFn(confirmEmail) });
}

/** Operator demo controls; `enabled` only for operators (the API refuses everyone else). */
export function useDemoStatus(enabled: boolean) {
  return useQuery({ queryKey: qk.demo, queryFn: api.admin.demo, enabled, staleTime: 30_000 });
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.resetDemo(),
    // Every list and detail may have changed: refetch everything.
    onSuccess: (status) => {
      qc.setQueryData(qk.demo, status);
      void qc.invalidateQueries();
    },
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.auth.revokeDevice(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.devices }),
  });
}

// ── Governance: organisations, domains, recipients, members ───────────────────
export function useOrgMembers(id: string, enabled = true) {
  return useQuery({ queryKey: qk.orgMembers(id), queryFn: () => api.organisations.members(id), enabled });
}

/** The caller's role in one organisation (org_admin | org_member | null), from /auth/me. */
export function useOrgRole(orgId: string): string | null {
  const me = useMe().data;
  return me?.organisations?.find((o) => o.id === orgId)?.role ?? null;
}

/** AUTHENTICATION_AUTHORIZATION.md §5.3: org_admin or a platform operator manage a profile. */
export function canManageOrg(orgRole: string | null, platformRole: string | null): boolean {
  return orgRole === "org_admin" || platformRole === "operator";
}

export function useCreateOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrganisationCreateBody) => api.organisations.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgs });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useUpdateOrganisation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrganisationUpdateBody) => api.organisations.update(id, body),
    onSuccess: (data) => {
      if (data) qc.setQueryData(qk.org(id), data);
      void qc.invalidateQueries({ queryKey: qk.org(id) });
      void qc.invalidateQueries({ queryKey: qk.orgs });
    },
  });
}

export function useAddDomain(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DomainCreateBody) => api.organisations.addDomain(orgId, body),
    onSuccess: (data) => {
      if (data?.challenges?.length) qc.setQueryData(qk.orgDomainChallenge(orgId, data.id), data.challenges);
      void qc.invalidateQueries({ queryKey: qk.orgDomains(orgId) });
    },
  });
}

/** The one-time challenge from the create response, kept in the query cache for this session. */
export function useDomainChallenge(orgId: string, domainId: string): DomainChallenge[] | null {
  const qc = useQueryClient();
  return qc.getQueryData<DomainChallenge[]>(qk.orgDomainChallenge(orgId, domainId)) ?? null;
}

export function useVerifyDomain(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domainId, method }: { domainId: string; method: DomainVerifyBody["method"] }) =>
      api.organisations.verifyDomain(orgId, domainId, { method }),
    onSettled: () => {
      // Attempts are counted and status can change even on failure (ORGANISATION_TRUST_PROFILES §4.2).
      void qc.invalidateQueries({ queryKey: qk.orgDomains(orgId) });
      void qc.invalidateQueries({ queryKey: qk.org(orgId) });
      void qc.invalidateQueries({ queryKey: qk.orgs });
    },
  });
}

export function useRemoveDomain(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => api.organisations.removeDomain(orgId, domainId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgDomains(orgId) });
      void qc.invalidateQueries({ queryKey: qk.org(orgId) });
      void qc.invalidateQueries({ queryKey: qk.orgs });
    },
  });
}

export function useAddRecipient(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecipientCreateBody) => api.organisations.addRecipient(orgId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgRecipients(orgId) }),
  });
}

export function useVerifyRecipient(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recipientId, body }: { recipientId: string; body: RecipientVerifyBody }) =>
      api.organisations.verifyRecipient(orgId, recipientId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgRecipients(orgId) }),
  });
}

export function useRemoveRecipient(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipientId: string) => api.organisations.removeRecipient(orgId, recipientId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgRecipients(orgId) }),
  });
}

export function useInviteMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MemberInviteBody) => api.organisations.inviteMember(orgId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgMembers(orgId) }),
  });
}

export function useUpdateMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.organisations.updateMember(orgId, userId, role),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.organisations.removeMember(orgId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgMembers(orgId) });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.invites.accept(token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.orgs });
    },
  });
}

// ── Appeals ───────────────────────────────────────────────────────────────────
export function useCreateAppeal() {
  return useMutation({ mutationFn: (body: AppealCreateBody) => api.appeals.create(body) });
}

export function useVerifyAppeal() {
  return useMutation({ mutationFn: (id: string) => api.appeals.verify(id) });
}

export function useAppeals(f: AppealFilters, enabled = true) {
  return useQuery({ queryKey: qk.appeals(f), queryFn: () => api.appeals.list(f), enabled });
}

export function useAppeal(id: string) {
  return useQuery({ queryKey: qk.appeal(id), queryFn: () => api.appeals.get(id) });
}

export function useReviewAppeal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppealReviewBody) => api.appeals.review(id, body),
    onSuccess: (data) => {
      if (data) qc.setQueryData(qk.appeal(id), data);
      void qc.invalidateQueries({ queryKey: ["appeals"] });
      void qc.invalidateQueries({ queryKey: ["reports"] });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

// ── Certificates: inventory, detail, monitors ─────────────────────────────────
export function useCertificates(f: CertificateFilters) {
  return useQuery({ queryKey: qk.certificates(f), queryFn: () => api.certificates.list(f) });
}

export function useCertificate(id: string) {
  return useQuery({ queryKey: qk.certificate(id), queryFn: () => api.certificates.get(id) });
}

export function useOrgMonitors(orgId: string) {
  return useQuery({ queryKey: qk.orgMonitors(orgId), queryFn: () => api.certificates.monitors(orgId) });
}

export function useCreateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MonitorCreateBody) => api.certificates.createMonitor(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.certMonitors });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useDeleteMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.certificates.deleteMonitor(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.certMonitors });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

// ── Developer usage and audit ─────────────────────────────────────────────────
export function useUsage(f: UsageFilters) {
  return useQuery({ queryKey: qk.usage(f), queryFn: () => api.usage(f) });
}

export function useAuditLogs(f: AuditFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.auditLogs(f),
    queryFn: ({ pageParam }) => api.auditLogs({ ...f, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last?.page?.next_cursor ?? null,
    enabled,
  });
}

export function useRevokeInvite(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.organisations.revokeInvite(orgId, inviteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgMembers(orgId) }),
  });
}
