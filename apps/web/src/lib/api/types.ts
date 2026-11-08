// TEMPORARY: replace with @trustlens/shared-types once openapi.json covers these routes
//
// Hand-typed mirrors of docs/03-backend/API_ENDPOINTS.md and docs/02-architecture/API_CONTRACTS.md.
// snake_case is kept on purpose (ADR-007) — there is no camelCase mapping layer.
// Enum-typed fields are `string` at the wire boundary and narrowed with the guards in ./enums.ts,
// so an unknown value from a newer API maps to a safe default instead of crashing.

export type Iso8601 = string;

export interface Page {
  limit: number;
  next_cursor: string | null;
  total_estimate?: number;
}

export interface List<T> {
  data: T[];
  page?: Page;
}

export interface ErrorDetail {
  field?: string;
  issue?: string;
  observed?: unknown;
  [key: string]: unknown;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: ErrorDetail[] | Record<string, unknown>;
  };
}

// ── Auth (§3) ─────────────────────────────────────────────────────────────────
export interface MeOrganisation {
  id: string;
  name: string;
  role: string;
}

export interface Me {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  organisations: MeOrganisation[];
  created_at: Iso8601;
  last_login_at: Iso8601 | null;
}

export interface PairingCode {
  code: string;
  expires_at: Iso8601;
  expires_in: number;
}

export interface Device {
  id: string;
  name: string;
  last_used_at: Iso8601 | null;
  created_at: Iso8601;
  expires_at: Iso8601 | null;
}

// ── Scans (§4) ────────────────────────────────────────────────────────────────
export interface Coverage {
  percent: number;
  collected: string[];
  unavailable: string[];
  skipped: string[];
}

export interface ScanCreateBody {
  url: string;
  intent: string;
  organisation_id?: string;
  deep?: boolean;
}

export interface ScanAccepted {
  id: string;
  status: string;
  url: string;
  intent: string;
  created_at: Iso8601;
  poll_after_ms: number;
}

export interface ScanSummary {
  id: string;
  url: string;
  intent: string;
  status: string;
  decision: string | null;
  risk_level: string | null;
  risk_score: number | null;
  created_at: Iso8601;
  completed_at?: Iso8601 | null;
  registrable_domain?: string | null;
}

// §5 — shared finding shape
export interface Finding {
  id: string;
  code: string;
  signal_group: string;
  severity: string;
  confidence: number;
  title: string;
  detail: string;
  observed?: Record<string, unknown> | null;
  expected?: Record<string, unknown> | null;
  evidence_refs?: string[];
  rule_id?: string | null;
  simulated?: boolean;
}

export interface Evidence {
  id: string;
  source: string;
  observed_at: Iso8601;
  summary: string;
  simulated?: boolean;
}

export interface ScanAction {
  intent?: string;
  observed_destination?: string | null;
  expected_destinations?: string[];
  payee?: string | null;
  match?: string;
  simulated?: boolean;
  [key: string]: unknown;
}

export interface ScanResult {
  dns?: Record<string, unknown> | null;
  registration?: Record<string, unknown> | null;
  tls?: Record<string, unknown> | null;
  redirects?: Record<string, unknown> | null;
  page?: Record<string, unknown> | null;
  brand?: Record<string, unknown> | null;
  action?: ScanAction | null;
  [key: string]: unknown;
}

export interface Scan {
  id: string;
  status: string;
  url: string;
  normalised_url?: string;
  registrable_domain?: string;
  intent: string;
  decision?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  coverage?: Coverage | null;
  reasons?: string[];
  overrides?: string[];
  engine_version?: string;
  result?: ScanResult | null;
  findings?: Finding[];
  evidence?: Evidence[];
  cached_groups?: string[];
  duration_ms?: number | null;
  failure_code?: string | null;
  simulated?: boolean;
  created_at: Iso8601;
  completed_at?: Iso8601 | null;
}

// ── Investigations (§14) ──────────────────────────────────────────────────────
export interface InvestigationAccepted {
  id: string;
  status: string;
  poll_after_ms?: number;
}

export interface InvestigationStep {
  name: string;
  status: string;
  duration_ms?: number | null;
}

export interface NarrativeClaim {
  text: string;
  refs: string[];
}

export interface NarrativeSection {
  heading: string;
  claims: NarrativeClaim[];
}

export interface InvestigationReference {
  id: string;
  kind: string;
  finding_id?: string;
  evidence_id?: string;
  entity_id?: string;
  label?: string;
}

export interface InvestigationAi {
  generated: boolean;
  model?: string | null;
  prompt_version?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  latency_ms?: number | null;
}

export interface Investigation {
  id: string;
  scan_id: string;
  status: string;
  decision_context?: { decision: string; risk_level: string; risk_score: number | null } | null;
  steps?: InvestigationStep[];
  narrative?: { sections: NarrativeSection[] } | null;
  references?: InvestigationReference[];
  dropped_claims?: unknown[];
  ai?: InvestigationAi | null;
  created_at: Iso8601;
  completed_at?: Iso8601 | null;
}

// ── Reports (§11) ─────────────────────────────────────────────────────────────
export interface ReportCreateBody {
  url: string;
  justification: string;
  intent?: string;
  observed_payee?: string;
  scan_id?: string;
}

export interface ReportCreated {
  id: string;
  status: string;
  created_at: Iso8601;
  linked_scan_id?: string | null;
}

// ReportSummary fields are not enumerated in API_ENDPOINTS.md; these follow UI_UX §14 (list columns).
export interface ReportSummary {
  id: string;
  url: string;
  status: string;
  intent?: string | null;
  channel?: string | null;
  decision?: string | null;
  linked_scan_id?: string | null;
  created_at: Iso8601;
}

export interface Report extends ReportSummary {
  justification?: string;
  observed_payee?: string | null;
  evidence?: Evidence[];
  linked_scan?: {
    id?: string;
    decision?: string | null;
    risk_level?: string | null;
    risk_score?: number | null;
    coverage?: Coverage | null;
    [k: string]: unknown;
  } | null;
  reporter?: Record<string, unknown> | null;
  review?: { reviewed_by?: string | null; reviewed_at?: Iso8601 | null; reason?: string | null } | null;
}

export interface ReviewBody {
  action: "confirm" | "dismiss";
  reason: string;
}

// ── Intelligence (§12) ────────────────────────────────────────────────────────
export interface CampaignSummary {
  id: string;
  name: string;
  confidence: number;
  member_count: number;
  first_seen_at: Iso8601 | null;
  last_seen_at: Iso8601 | null;
  simulated?: boolean;
}

export interface EntitySummary {
  id: string;
  type: string;
  label: string;
  reputation_score?: number | null;
  attributes?: Record<string, unknown>;
}

export interface SharedIndicator {
  type: string;
  value: string;
  confidence: number;
  member_count?: number;
}

export interface Campaign extends CampaignSummary {
  members: EntitySummary[];
  shared_indicators: SharedIndicator[];
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  confidence: number;
  evidence_refs?: string[];
  observed_count?: number;
}

export interface Graph {
  root: string;
  nodes: EntitySummary[];
  edges: GraphEdge[];
  truncated: boolean;
  counts: { nodes: number; edges: number };
}

// ── Certificates (§13) ────────────────────────────────────────────────────────
export interface CertificateMonitor {
  id: string;
  domain: string;
  organisation_id?: string | null;
  enabled?: boolean;
  issuer_cn?: string | null;
  days_to_expiry: number | null;
  last_checked_at: Iso8601 | null;
  current_certificate_id: string | null;
}

export interface MonitorCreateBody {
  organisation_id: string;
  domain: string;
}

export interface CertificateSummary {
  id: string;
  fingerprint_sha256: string;
  subject_cn: string | null;
  issuer_cn: string;
  root_issuer_cn?: string | null;
  sans?: string[];
  not_before: Iso8601;
  not_after: Iso8601;
  days_to_expiry: number;
  key_type?: string;
  key_bits?: number | null;
  signature_algorithm?: string;
  monitored_domain?: string | null;
  simulated?: boolean;
}

export interface CertificateChainEntry {
  subject_cn?: string | null;
  issuer_cn?: string | null;
  fingerprint_sha256?: string | null;
  not_after?: Iso8601 | null;
  [k: string]: unknown;
}

/** GET /certificates/{id}: "full cert, chain, issuer, first_seen_at, last_seen_at". */
export interface Certificate extends CertificateSummary {
  chain?: CertificateChainEntry[];
  chain_length?: number | null;
  is_self_signed?: boolean;
  monitors?: CertificateMonitor[];
  first_seen_at?: Iso8601 | null;
  last_seen_at?: Iso8601 | null;
}

export interface CertificateFilters {
  organisation_id?: string;
  expiring_within_days?: number;
  issuer?: string;
  limit?: number;
  cursor?: string;
}

export interface IncidentAffected {
  domain: string;
  certificate_id: string | null;
  monitor_id: string | null;
}

export interface CertificateIncident {
  id: string;
  issuer_cn: string;
  title: string;
  severity: string;
  description: string;
  source: string;
  simulated: boolean;
  published_at: Iso8601;
  affected_domain_count: number;
  affected?: IncidentAffected[];
  affected_truncated?: boolean;
}

export interface IncidentCreateBody {
  issuer_cn: string;
  title: string;
  severity: string;
  description: string;
  source: string;
  simulated: true;
}

// ── Organisations (§7–10, ORGANISATION_TRUST_PROFILES.md) ─────────────────────
export interface OrganisationSummary {
  id: string;
  name: string;
  status: string;
  role?: string | null;
  verified_domains_count?: number;
  members_count?: number;
  simulated?: boolean;
}

/** ORGANISATION_TRUST_PROFILES.md §4.1 — instructions returned once at domain creation. */
export interface DomainChallenge {
  method: string; // "dns_txt" | "http_file"
  record_name?: string;
  record_type?: string;
  record_value?: string;
  url?: string;
  file_content?: string;
  expires_at?: Iso8601 | null;
}

export interface OrgDomain {
  id: string;
  domain: string;
  kind: string;
  status: string;
  verified_at: Iso8601 | null;
  expires_at: Iso8601 | null;
  verification_method?: string | null;
  /** Present on the create response (and, if the API chooses, on pending rows). */
  challenges?: DomainChallenge[];
}

export interface DomainCreateBody {
  domain: string;
  kind: string; // "official" | "login" | "payment"
}

export interface DomainVerifyBody {
  method: "dns_txt" | "http_file";
}

export interface DomainVerified {
  id?: string;
  domain?: string;
  status: string;
  verification_method?: string;
  verified_at: Iso8601 | null;
  expires_at?: Iso8601 | null;
  evidence_id?: string | null;
}

export interface OrgRecipient {
  id: string;
  type: string;
  handle: string;
  label?: string | null;
  status: string;
  verified_at: Iso8601 | null;
}

export interface RecipientCreateBody {
  recipient_type: string;
  value: string;
  label?: string;
}

export interface RecipientVerifyBody {
  action: "verify" | "reject";
  reason: string;
  evidence_ref?: string;
}

export interface Organisation extends OrganisationSummary {
  legal_name?: string | null;
  country?: string | null;
  sector?: string | null;
  support_email?: string | null;
  brand_tokens?: string[];
  logo_phash?: string | null;
  login_hosts_mode?: string | null;
  domains?: OrgDomain[];
  recipients?: OrgRecipient[];
  created_at?: Iso8601;
  updated_at?: Iso8601;
}

export interface OrganisationCreateBody {
  name: string;
  legal_name?: string;
  country?: string;
  sector?: string;
  support_email?: string;
}

/** PATCH /organisations/{id}. `status: "active"` publishes; `"suspended"` suspends. */
export interface OrganisationUpdateBody {
  name?: string;
  legal_name?: string;
  country?: string;
  sector?: string;
  support_email?: string;
  brand_tokens?: string[];
  login_hosts_mode?: string;
  status?: string;
  /** 16 hex chars (64-bit pHash, computed in the browser); null removes the logo. */
  logo_phash?: string | null;
}

export interface OrgMember {
  user_id: string;
  email: string;
  display_name?: string | null;
  role: string; // "org_admin" | "org_member"
  created_at: Iso8601;
}

/** Open, unaccepted invites — returned to org admins and operators alongside members. */
export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  expires_at: Iso8601;
  created_at: Iso8601;
  invited_by?: string | null;
}

export interface MemberList {
  data: OrgMember[];
  invites?: OrgInvite[];
}

export interface MemberInviteBody {
  email: string;
  role: string;
}

export interface MemberInvited {
  invite_id: string;
  email?: string;
  role?: string;
  expires_at: Iso8601;
  /** email | logged | not_configured | failed */
  delivery?: string;
  /** Present only when the email was not delivered, so an admin can share the link. */
  accept_url?: string | null;
}

export interface InviteAccepted {
  organisation_id: string;
  organisation_name?: string;
  role?: string;
}

// ── Appeals (§11) ─────────────────────────────────────────────────────────────
export interface AppealCreateBody {
  domain: string;
  email: string;
  message: string;
  challenge_method: "dns_txt" | "http_file";
}

/** dns_txt: TXT record name/value. http_file: record_name is the URL to serve, record_value the file body. */
export interface AppealChallenge {
  method: string;
  record_name: string;
  record_type?: string; // "TXT" | "FILE"
  record_value: string;
  expires_at?: Iso8601 | null;
  instructions?: string;
}

export interface AppealCreated {
  appeal_id: string;
  status?: string;
  challenge: AppealChallenge;
}

export interface AppealVerifyResult {
  appeal_id: string;
  status: string;
  verified: boolean;
  attempts: number;
  message: string;
}

/** Statuses: pending_challenge | challenge_verified | approved | rejected | expired. */
export interface Appeal {
  id: string;
  domain: string;
  email: string;
  message: string;
  challenge_method: string;
  status: string;
  attempts: number;
  challenge_expires_at: Iso8601;
  challenge_verified_at: Iso8601 | null;
  current_reputation: number | null;
  open_reports: number;
  review: Record<string, string | number | null> | null;
  created_at: Iso8601;
}

export interface AppealReviewBody {
  action: "approve" | "reject";
  reason: string;
}

export interface AppealFilters {
  status?: string;
  domain?: string;
  limit?: number;
  cursor?: string;
}

// ── Developer (§15) ───────────────────────────────────────────────────────────
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  kind?: string;
  last_used_at: Iso8601 | null;
  revoked_at: Iso8601 | null;
  created_at: Iso8601;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  secret: string;
}

/** GET /usage — `{data:[{day, endpoint_group, count}], period:{from,to}, quota:{limit,used,reset_at}}`. */
export interface UsageRow {
  day?: string | null;
  endpoint_group?: string | null;
  count: number;
}

export interface Usage {
  data: UsageRow[];
  period: { from: string; to: string };
  quota: { limit: number; used: number; reset_at: Iso8601 | null } | null;
}

export interface UsageFilters {
  from?: string;
  to?: string;
  group_by?: "day" | "endpoint_group";
}

// ── Audit (§16) ───────────────────────────────────────────────────────────────
/** Row shape is not enumerated in API_ENDPOINTS.md; columns follow DATABASE_DESIGN.md audit_logs. */
export interface AuditLogEntry {
  id: string;
  action: string;
  /** Column is actor_user_id; the query param is actor_id (§16). Either may be returned. */
  actor_user_id?: string | null;
  actor_id?: string | null;
  actor_kind?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  organisation_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  request_id?: string | null;
  created_at: Iso8601;
}

export interface AuditFilters {
  action?: string;
  actor_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

// ── Overview (§16) ────────────────────────────────────────────────────────────
export interface Overview {
  recent_scans: Array<{
    id: string;
    url: string;
    decision: string | null;
    risk_level: string | null;
    created_at: Iso8601;
  }> | null;
  high_risk_domains: Array<{ entity_id: string; domain: string; reputation_score: number }> | null;
  certificate_alerts: Array<{ monitor_id: string; domain: string; days_to_expiry: number }> | null;
  campaigns: Array<{ id: string; name: string; confidence: number; member_count: number }> | null;
  report_queue: { pending: number; reviewing: number } | null;
  quota: { scans_used: number; scans_limit: number; resets_at: Iso8601 } | null;
}

// ── Operator demo controls (UI_UX §15) ─────────────────────────────────────────
export interface DemoStatus {
  demo_mode: boolean;
  organisation: { id: string; name: string } | null;
  counts: { scans: number; reports: number; campaigns: number; investigations: number; incidents: number };
  last_seeded_at: string | null;
}
