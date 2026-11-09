// Service worker: message router, API calls, cache, badge. Observes and enforces nothing itself —
// it fetches the server's decision and hands it to the content script / popup unchanged.
import { DECISION_COPY, NEUTRAL_FAILURES, failureText } from "../shared/copy";
import { DEMO_SITES_ORIGIN, EXT_VERSION, WEB_BASE_URL, isOwnPage } from "../shared/config";
import { hostOf, isLocalHost, toReportedUrl } from "../shared/demo-url";
import type { Msg, PairingState, Reply, ResponseMap } from "../shared/messages";
import { badgeColour } from "../shared/tokens";
import type { CheckFailure, CheckResult, Decision } from "../shared/types";
import { apiFetch, assess, errorCodeOf, TransportError, type AssessBody } from "./api";
import * as store from "./storage";

const ME_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_PAYEE_LEN = 128;
const PAIRING_TIMEOUT_MS = 10_000;

const fail = (code: CheckFailure["code"], extra: Partial<CheckFailure> = {}): CheckResult => ({
  kind: "failure",
  failure: { code, ...extra },
  checkedAt: Date.now(),
});

function decisionOf(r: CheckResult): Decision {
  return r.kind === "assessment" ? r.assessment.decision : "UNKNOWN";
}

async function setBadge(tabId: number | undefined, r: CheckResult): Promise<void> {
  if (tabId === undefined) return;
  const d = decisionOf(r);
  try {
    if (r.kind === "failure" && NEUTRAL_FAILURES.has(r.failure.code)) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: `TrustLens — ${failureText(r.failure.code)}` });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: DECISION_COPY[d].badge });
    if (DECISION_COPY[d].badge) await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColour(d) });
    await chrome.action.setTitle({ tabId, title: `TrustLens — ${DECISION_COPY[d].label}` });
  } catch {
    /* tab closed */
  }
}

/** After any API result: a 401 clears the token; a 429 opens a back-off window. */
async function afterResult(r: CheckResult): Promise<CheckResult> {
  if (r.kind === "failure") {
    if (r.failure.code === "RECONNECT") await store.clearToken(true);
    if (r.failure.code === "RATE_LIMITED") await store.setRateLimitedFor(r.failure.retryAfter);
  }
  return r;
}

/** Neutral states decided locally (no request): TrustLens itself, and addresses the server refuses. */
function localState(rawUrl: string): { url: string | null; result: CheckResult | null } {
  const url = toReportedUrl(rawUrl, DEMO_SITES_ORIGIN);
  if (!url) return { url: null, result: fail("CANNOT_CHECK_PAGE") };
  if (isOwnPage(rawUrl)) return { url, result: fail("OWN_SITE") };
  if (isLocalHost(url)) return { url, result: fail("LOCAL_PAGE") };
  return { url, result: null };
}

/**
 * In-flight browse checks, keyed by reported URL. The content script (page load) and the popup share
 * one request instead of racing two scans. Memory only: if the worker restarts, the next check simply
 * starts again — nothing here is a decision.
 */
const inflight = new Map<string, { promise: Promise<CheckResult>; startedAt: number }>();

async function setPendingBadge(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.action.setBadgeText({ tabId, text: "…" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColour("UNKNOWN") });
    await chrome.action.setTitle({ tabId, title: "TrustLens — checking this page" });
  } catch {
    /* tab closed */
  }
}

async function browseCheck(rawUrl: string, forceRefresh = false, tabId?: number): Promise<CheckResult> {
  const settings = await store.getSettings();
  if (!settings.enabled) return fail("PAUSED");
  const local = localState(rawUrl);
  if (local.result || !local.url) return local.result ?? fail("CANNOT_CHECK_PAGE");
  const url = local.url;
  const token = await store.getToken();
  if (!token) return fail((await store.getPairing()).needsReconnect ? "RECONNECT" : "NOT_PAIRED");

  if (!forceRefresh) {
    const cached = await store.readVerdict(url);
    if (cached.state === "fresh") return cached.result;
    const running = inflight.get(url);
    if (running) return running.promise;
  }
  const until = await store.getRateLimitedUntil();
  if (until > Date.now()) return fail("RATE_LIMITED", { retryAfter: Math.ceil((until - Date.now()) / 1000) });

  await setPendingBadge(tabId);
  const promise = (async () => {
    const result = await afterResult(await assess({ url, intent: "browse" }, token));
    await store.writeVerdict(url, result);
    await noteFlag(url, result);
    return result;
  })();
  inflight.set(url, { promise, startedAt: Date.now() });
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

async function peekStatus(rawUrl: string): Promise<ResponseMap["PEEK_STATUS"]> {
  const settings = await store.getSettings();
  if (!settings.enabled) return { result: fail("PAUSED"), pendingSince: null, enforced: null };
  const local = localState(rawUrl);
  if (local.result || !local.url) return { result: local.result, pendingSince: null, enforced: null };
  const cached = await store.readVerdict(local.url);
  return {
    result: cached.state === "fresh" ? cached.result : null,
    pendingSince: inflight.get(local.url)?.startedAt ?? null,
    enforced: await store.readEnforced(local.url),
  };
}

/** Origin of a sender's page, or null. Used to scope the dashboard bridge to the dashboard origin. */
function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}

/** Host of a content script's page (demo path-mode URLs map back to the impersonated host). */
function hostOfSender(sender: chrome.runtime.MessageSender): string | null {
  return sender.url ? hostOf(toReportedUrl(sender.url, DEMO_SITES_ORIGIN)) : null;
}

/** Remember BLOCK/WARN answers per host so the link pre-check can stop navigation to them. */
async function noteFlag(url: string, result: CheckResult): Promise<void> {
  if (result.kind !== "assessment") return;
  const d = result.assessment.decision;
  const host = hostOf(url);
  if (host && (d === "BLOCK" || d === "WARN")) await store.flagHost(host, d);
}

function fromDashboard(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.tab?.id === "number" && sender.frameId === 0 && senderOrigin(sender) === new URL(WEB_BASE_URL).origin;
}

/** Action checks never use the browse cache: intent changes the decision (§5). */
async function actionCheck(msg: Extract<Msg, { type: "ACTION_INTENT" }>): Promise<CheckResult> {
  const settings = await store.getSettings();
  if (!settings.enabled) return fail("PAUSED");
  const local = localState(msg.url);
  if (local.result || !local.url) return local.result ?? fail("CANNOT_CHECK_PAGE");
  const url = local.url;
  const token = await store.getToken();
  if (!token) return fail((await store.getPairing()).needsReconnect ? "RECONNECT" : "NOT_PAIRED");

  const body: AssessBody = { url, intent: msg.intent };
  const formAction = msg.formAction ? toReportedUrl(msg.formAction, DEMO_SITES_ORIGIN) : null;
  if (msg.intent === "download") {
    // A download is judged by the host that serves the file (its site root: the API never fetches
    // the file itself). Same-host downloads are judged with the page.
    const fileHost = formAction ? hostOf(formAction) : null;
    if (formAction && fileHost && fileHost !== hostOf(url)) {
      const local2 = localState(new URL(formAction).origin + "/");
      if (local2.url) body.url = local2.url;
    }
    if (fileHost) body.destination_host = fileHost;
  } else if (formAction) {
    body.form_action = formAction;
    const host = hostOf(formAction);
    if (host) body.destination_host = host;
  } else if (msg.destinationHost && /^[a-z0-9.-]{1,253}$/i.test(msg.destinationHost)) {
    body.destination_host = msg.destinationHost.toLowerCase();
  }
  if (msg.intent === "payment" && typeof msg.payee === "string") {
    const payee = msg.payee.trim().slice(0, MAX_PAYEE_LEN);
    if (payee) body.payee = payee;
  }
  // Same action, same page, within 10 minutes: reuse the server's answer (the page guard asks on
  // load, the submit asks again). Keyed by the full request identity, so a different payee or
  // destination is always a new check. Only server assessments are cached; failures retry.
  const actionKey = ["action", url, body.intent, body.payee ?? "", body.form_action ?? "", body.destination_host ?? ""].join("\n");
  const cached = await store.readVerdict(actionKey);
  if (cached.state === "fresh") return cached.result;
  const running = inflight.get(actionKey);
  if (running) return running.promise;
  // Protection over quota: action checks still attempt once during a 429 window (§7).
  const promise = (async () => {
    const result = await afterResult(await assess(body, token));
    await store.writeVerdict(actionKey, result);
    await noteFlag(body.url, result);
    await store.recordEnforced(url, msg.intent, result);
    return result;
  })();
  inflight.set(actionKey, { promise, startedAt: Date.now() });
  try {
    return await promise;
  } finally {
    inflight.delete(actionKey);
  }
}

async function pair(code: string, deviceName: string): Promise<Reply<PairingState>> {
  const compact = code.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{8}$/.test(compact)) {
    return { ok: false, error: { code: "INVALID_CODE", message: "Enter the 8-character code." } };
  }
  // Documented wire format is "7K4Q-2M9X" (API_ENDPOINTS.md §3); accept either form from the user.
  const cleaned = `${compact.slice(0, 4)}-${compact.slice(4)}`;
  try {
    const res = await apiFetch({
      method: "POST",
      path: "/api/v1/auth/extension/exchange",
      body: { code: cleaned, device_name: deviceName.slice(0, 100) || "Chrome" },
      timeoutMs: PAIRING_TIMEOUT_MS,
    });
    const b = res.body as { device_token?: unknown; device_id?: unknown; expires_at?: unknown } | null;
    if (res.status >= 200 && res.status < 300 && b && typeof b.device_token === "string" && b.device_token.startsWith("tl_ext_")) {
      await store.savePairing({
        device_token: b.device_token,
        device_id: typeof b.device_id === "string" ? b.device_id : null,
        expires_at: typeof b.expires_at === "string" ? b.expires_at : null,
      });
      await store.clearVerdicts();
      return { ok: true, data: await store.getPairing() };
    }
    if (res.status === 401 || res.status === 410 || res.status === 422) {
      return { ok: false, error: { code: "INVALID_CODE", message: errorCodeOf(res.body) ?? `HTTP ${res.status}` } };
    }
    return { ok: false, error: { code: "PAIR_FAILED", message: errorCodeOf(res.body) ?? `HTTP ${res.status}` } };
  } catch (err) {
    return { ok: false, error: { code: "PAIR_FAILED", message: err instanceof TransportError ? err.code : "UNAVAILABLE" } };
  }
}

/** Token expiry check on wake: `/auth/me` at most once per 24 h; 401 → clear + "Reconnect". */
async function maybeCheckMe(): Promise<void> {
  const token = await store.getToken();
  if (!token) return;
  const { last_me_check } = await chrome.storage.local.get("last_me_check");
  if (typeof last_me_check === "number" && Date.now() - last_me_check < ME_CHECK_INTERVAL_MS) return;
  try {
    const res = await apiFetch({ method: "GET", path: "/api/v1/auth/me", token, timeoutMs: 8_000 });
    if (res.status === 401) await store.clearToken(true);
    else if (res.status >= 200 && res.status < 300) await chrome.storage.local.set({ last_me_check: Date.now() });
  } catch {
    /* unreachable: try again next wake */
  }
}

async function report(msg: Extract<Msg, { type: "REPORT" }>): Promise<Reply<ResponseMap["REPORT"]>> {
  const token = await store.getToken();
  if (!token) return { ok: false, error: { code: "NOT_PAIRED", message: "Not connected" } };
  const url = toReportedUrl(msg.url, DEMO_SITES_ORIGIN);
  if (!url) return { ok: false, error: { code: "CANNOT_CHECK_PAGE", message: "This page can't be reported." } };
  const body: Record<string, unknown> = { url };
  if (msg.intent) body.intent = msg.intent;
  if (msg.observedPayee) body.observed_payee = msg.observedPayee.slice(0, MAX_PAYEE_LEN);
  if (msg.scanId) body.scan_id = msg.scanId;
  const j = msg.justification?.trim();
  if (j) {
    if (j.length < 10 || j.length > 500) {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: "Use 10–500 characters, or leave it empty." } };
    }
    body.justification = j;
  }
  try {
    const res = await apiFetch({
      method: "POST",
      path: "/api/v1/reports",
      body,
      token,
      idempotencyKey: `ext-report-${crypto.randomUUID()}`,
      timeoutMs: 10_000,
    });
    if (res.status === 401) {
      await store.clearToken(true);
      return { ok: false, error: { code: "RECONNECT", message: "Reconnect" } };
    }
    const code = errorCodeOf(res.body);
    // A duplicate report is success for UX (SDK_INTEGRATION_GUIDE.md §10).
    if (res.status === 409 && code === "REPORT_DUPLICATE") return { ok: true, data: { id: null, status: "pending" } };
    if (res.status >= 200 && res.status < 300) {
      const b = res.body as { id?: unknown; status?: unknown } | null;
      return {
        ok: true,
        data: { id: typeof b?.id === "string" ? b.id : null, status: typeof b?.status === "string" ? b.status : null },
      };
    }
    return { ok: false, error: { code: code ?? `HTTP_${res.status}`, message: `HTTP ${res.status}` } };
  } catch (err) {
    return { ok: false, error: { code: err instanceof TransportError ? err.code : "UNAVAILABLE", message: "Unreachable" } };
  }
}

async function apiStatus(): Promise<ResponseMap["API_STATUS"]> {
  try {
    const res = await apiFetch({ method: "GET", path: "/health", timeoutMs: 5_000 });
    const b = res.body as { version?: unknown } | null;
    return { reachable: res.status === 200, version: typeof b?.version === "string" ? b.version : null };
  } catch {
    return { reachable: false, version: null };
  }
}

// ---- router ---------------------------------------------------------------------------------

const ACTION_INTENTS: ReadonlySet<unknown> = new Set(["login", "payment", "data_submission", "download"]);

const EXTENSION_PAGE_ONLY = new Set<Msg["type"]>([
  "GET_STATUS",
  "PEEK_STATUS",
  "TAB_URL",
  "PAIR",
  "GET_PAIRING",
  "UNPAIR",
  "CLEAR_DATA",
  "API_STATUS",
  "SET_SETTINGS",
]);
/** Only the TrustLens dashboard tab (bridge.ts, top frame, WEB_BASE_URL origin) may send these. */
const DASHBOARD_ONLY = new Set<Msg["type"]>(["BRIDGE_HELLO", "PAIR_FROM_DASHBOARD"]);
const CONTENT_ALLOWED = new Set<Msg["type"]>([
  "PAGE_READY",
  "ACTION_INTENT",
  "REPORT",
  "GET_SETTINGS",
  "RECORD_OVERRIDE",
  "DISMISS_WARN",
  "IS_WARN_DISMISSED",
  "FLAGGED_HOSTS",
  "SET_PAGE_OVERRIDE",
  "GET_PAGE_OVERRIDE",
]);

function isMsg(m: unknown): m is Msg {
  return Boolean(m) && typeof m === "object" && typeof (m as { type?: unknown }).type === "string";
}

/**
 * Popup or options page. The options page opens in a tab, so `sender.tab` may be set; the URL is
 * what distinguishes it. A content script's sender.url is the web page's URL, so it cannot pass this.
 */
function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
}

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<Reply<unknown>> {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: { code: "FORBIDDEN", message: "Unknown sender" } };
  const fromPage = isExtensionPage(sender);
  const fromTab = !fromPage && typeof sender.tab?.id === "number";
  if (EXTENSION_PAGE_ONLY.has(msg.type) && !fromPage) {
    return { ok: false, error: { code: "FORBIDDEN", message: "Not allowed from a web page" } };
  }
  if (DASHBOARD_ONLY.has(msg.type)) {
    if (!fromDashboard(sender)) return { ok: false, error: { code: "FORBIDDEN", message: "Only the TrustLens dashboard may do this" } };
    if (msg.type === "BRIDGE_HELLO") return { ok: true, data: { version: EXT_VERSION, paired: (await store.getPairing()).paired } };
    if (msg.type === "PAIR_FROM_DASHBOARD" && typeof msg.code === "string") {
      return pair(msg.code, typeof msg.deviceName === "string" ? msg.deviceName : "Chrome");
    }
    return { ok: false, error: { code: "BAD_MESSAGE", message: "Malformed message" } };
  }
  if (!EXTENSION_PAGE_ONLY.has(msg.type) && !CONTENT_ALLOWED.has(msg.type)) {
    return { ok: false, error: { code: "UNKNOWN_MESSAGE", message: msg.type } };
  }
  if (CONTENT_ALLOWED.has(msg.type) && !fromTab && !fromPage) {
    return { ok: false, error: { code: "FORBIDDEN", message: "Missing tab" } };
  }
  const str = (v: unknown) => typeof v === "string";

  switch (msg.type) {
    case "PAGE_READY": {
      if (!str(msg.url)) break;
      void maybeCheckMe();
      // Session-only map tab → page URL (already sent to the server for the check), so the popup can
      // describe the tab even where Chrome hides its URL. Cleared when the browser closes.
      if (typeof sender.tab?.id === "number") void chrome.storage.session.set({ [`tab_url:${sender.tab.id}`]: msg.url });
      const r = await browseCheck(msg.url, false, sender.tab?.id);
      await setBadge(sender.tab?.id, r);
      return { ok: true, data: r };
    }
    case "GET_STATUS": {
      if (!str(msg.url)) break;
      const tabId = typeof msg.tabId === "number" ? msg.tabId : undefined;
      const r = await browseCheck(msg.url, msg.refresh === true, tabId);
      await setBadge(tabId, r);
      return { ok: true, data: r };
    }
    case "PEEK_STATUS":
      if (!str(msg.url)) break;
      return { ok: true, data: await peekStatus(msg.url) };
    case "TAB_URL": {
      if (typeof msg.tabId !== "number") break;
      const key = `tab_url:${msg.tabId}`;
      const got = await chrome.storage.session.get(key);
      return { ok: true, data: typeof got[key] === "string" ? (got[key] as string) : null };
    }
    case "ACTION_INTENT": {
      if (!str(msg.url) || !ACTION_INTENTS.has(msg.intent)) break;
      const r = await actionCheck({
        type: "ACTION_INTENT",
        url: msg.url,
        intent: msg.intent,
        formAction: str(msg.formAction) ? msg.formAction : undefined,
        payee: str(msg.payee) ? msg.payee : undefined,
        destinationHost: str(msg.destinationHost) ? msg.destinationHost : undefined,
      });
      await setBadge(sender.tab?.id, r);
      return { ok: true, data: r };
    }
    case "REPORT":
      if (!str(msg.url)) break;
      return report(msg);
    case "PAIR":
      if (!str(msg.code)) break;
      return pair(msg.code, str(msg.deviceName) ? msg.deviceName : "Chrome");
    case "GET_PAIRING":
      void maybeCheckMe();
      return { ok: true, data: await store.getPairing() };
    case "UNPAIR":
      // Server-side revocation needs a dashboard session (DELETE /auth/extension/devices/{id});
      // the extension can only forget its token.
      await store.clearToken(false);
      return { ok: true, data: await store.getPairing() };
    case "CLEAR_DATA":
      await store.clearAll();
      return { ok: true, data: null };
    case "API_STATUS":
      return { ok: true, data: await apiStatus() };
    case "GET_SETTINGS":
      return { ok: true, data: await store.getSettings() };
    case "SET_SETTINGS":
      return { ok: true, data: await store.setSettings(msg.patch ?? {}) };
    case "RECORD_OVERRIDE":
      await store.recordOverride(msg.taken === true);
      return { ok: true, data: null };
    case "DISMISS_WARN":
      if (!str(msg.host)) break;
      await store.dismissWarn(msg.host);
      return { ok: true, data: null };
    case "IS_WARN_DISMISSED":
      if (!str(msg.host)) break;
      return { ok: true, data: await store.isWarnDismissed(msg.host) };
    case "FLAGGED_HOSTS":
      return { ok: true, data: await store.flaggedHosts() };
    case "SET_PAGE_OVERRIDE": {
      // Scoped to the sender's own page: a content script can only override the host it runs on.
      const own = hostOfSender(sender);
      if (!str(msg.host) || (msg.decision !== "BLOCK" && msg.decision !== "WARN") || own !== msg.host) break;
      await store.setPageOverride(msg.host, msg.decision);
      return { ok: true, data: null };
    }
    case "GET_PAGE_OVERRIDE":
      if (!str(msg.host)) break;
      return { ok: true, data: await store.getPageOverride(msg.host) };
  }
  return { ok: false, error: { code: "BAD_MESSAGE", message: "Malformed message" } };
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (!isMsg(msg)) {
    sendResponse({ ok: false, error: { code: "BAD_MESSAGE", message: "Malformed message" } });
    return false;
  }
  handle(msg, sender)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : "error" } }),
    );
  return true; // async response
});

chrome.runtime.onInstalled.addListener(() => {
  void store.migrate();
});

// Clear the per-tab badge when a tab starts loading a new page (no `tabs` permission needed for this).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`tab_url:${tabId}`).catch(() => undefined);
});
