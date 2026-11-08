// Service worker: message router, API calls, cache, badge. Observes and enforces nothing itself —
// it fetches the server's decision and hands it to the content script / popup unchanged.
import { DECISION_COPY } from "../shared/copy";
import { DEMO_SITES_ORIGIN } from "../shared/config";
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

async function browseCheck(rawUrl: string, forceRefresh = false): Promise<CheckResult> {
  const settings = await store.getSettings();
  if (!settings.enabled) return fail("PAUSED");
  const url = toReportedUrl(rawUrl, DEMO_SITES_ORIGIN);
  if (!url || isLocalHost(url)) return fail("CANNOT_CHECK_PAGE");
  const token = await store.getToken();
  if (!token) return fail((await store.getPairing()).needsReconnect ? "RECONNECT" : "NOT_PAIRED");

  if (!forceRefresh) {
    const cached = await store.readVerdict(url);
    if (cached.state === "fresh") return cached.result;
  }
  const until = await store.getRateLimitedUntil();
  if (until > Date.now()) return fail("RATE_LIMITED", { retryAfter: Math.ceil((until - Date.now()) / 1000) });

  const result = await afterResult(await assess({ url, intent: "browse" }, token));
  await store.writeVerdict(url, result);
  return result;
}

/** Action checks never use the browse cache: intent changes the decision (§5). */
async function actionCheck(msg: Extract<Msg, { type: "ACTION_INTENT" }>): Promise<CheckResult> {
  const settings = await store.getSettings();
  if (!settings.enabled) return fail("PAUSED");
  const url = toReportedUrl(msg.url, DEMO_SITES_ORIGIN);
  if (!url) return fail("CANNOT_CHECK_PAGE");
  const token = await store.getToken();
  if (!token) return fail((await store.getPairing()).needsReconnect ? "RECONNECT" : "NOT_PAIRED");

  const body: AssessBody = { url, intent: msg.intent };
  const formAction = msg.formAction ? toReportedUrl(msg.formAction, DEMO_SITES_ORIGIN) : null;
  if (formAction) {
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
  // Protection over quota: action checks still attempt once during a 429 window (§7).
  return afterResult(await assess(body, token));
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

const EXTENSION_PAGE_ONLY = new Set<Msg["type"]>([
  "GET_STATUS",
  "PAIR",
  "GET_PAIRING",
  "UNPAIR",
  "CLEAR_DATA",
  "API_STATUS",
  "SET_SETTINGS",
]);
const CONTENT_ALLOWED = new Set<Msg["type"]>([
  "PAGE_READY",
  "ACTION_INTENT",
  "REPORT",
  "GET_SETTINGS",
  "RECORD_OVERRIDE",
  "DISMISS_WARN",
  "IS_WARN_DISMISSED",
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
      const r = await browseCheck(msg.url);
      await setBadge(sender.tab?.id, r);
      return { ok: true, data: r };
    }
    case "GET_STATUS": {
      if (!str(msg.url)) break;
      return { ok: true, data: await browseCheck(msg.url, msg.refresh === true) };
    }
    case "ACTION_INTENT": {
      if (!str(msg.url) || (msg.intent !== "login" && msg.intent !== "payment")) break;
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
