// Popup (360 px). Opens instantly: shows the saved result for this tab, then the live check.
// It renders the SERVER's decision only — score, coverage, reasons and findings exactly as returned.
import { topReasons } from "../shared/assessment";
import { COPY, DECISION_COPY, NEUTRAL_FAILURES, failureText, fill, relativeAgo } from "../shared/copy";
import { CONNECT_URL, DEMO_SITES_ORIGIN, EXT_VERSION, aiExplainUrl, appealUrl, fullReportUrl, isAppealable } from "../shared/config";
import { hostOf, toReportedUrl } from "../shared/demo-url";
import { send, type PairingState } from "../shared/messages";
import { byId, h } from "../shared/page";
import { wirePairForm } from "../shared/pair-form";
import { DECISION_TOKENS } from "../shared/tokens";
import type { Assessment, CheckResult, Decision } from "../shared/types";

// Tokens are applied by tokens.js in <head>, so the first frame is already themed.

const SVG = "http://www.w3.org/2000/svg";
const pageStatus = byId<HTMLDivElement>("page-status");
const pageHost = byId<HTMLParagraphElement>("page-host");
const recheck = byId<HTMLButtonElement>("recheck");
const pairCard = byId<HTMLElement>("pair-card");
const reportCard = byId<HTMLElement>("report-card");
const watchBtn = byId<HTMLButtonElement>("watch");
const watchStatus = byId<HTMLParagraphElement>("watch-status");
const protect = byId<HTMLInputElement>("protect");
const chip = byId<HTMLSpanElement>("conn-chip");

byId("version").textContent = fill(COPY.popup.version, { v: EXT_VERSION });
byId("pair-body").textContent = COPY.pair.body;
byId("connect-one-click").textContent = COPY.pair.oneClick;
byId("connect-hint").textContent = COPY.pair.oneClickHint;
byId("manual-toggle").textContent = COPY.pair.manualToggle;
byId("manual-body").textContent = COPY.pair.manualBody;
byId("report-hint").textContent = COPY.reportJustificationHint;
watchBtn.textContent = COPY.popup.watchPage;
byId("open-options").addEventListener("click", () => void chrome.runtime.openOptionsPage());
byId("connect-one-click").addEventListener("click", () => void chrome.tabs.create({ url: CONNECT_URL }));

let activeTab: chrome.tabs.Tab | undefined;
let lastResult: CheckResult | null = null;
let paired = false;
let ticker: ReturnType<typeof setInterval> | null = null;

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Score ring coloured by the engine's decision (never by the score alone). */
function scoreRing(decision: Decision, score: number | null): HTMLElement {
  const size = 64;
  const r = 27;
  const c = 2 * Math.PI * r;
  const has = typeof score === "number" && Number.isFinite(score);
  const v = has ? Math.max(0, Math.min(100, Math.round(score as number))) : 0;
  const wrap = h("div", { className: "ring", attrs: { role: "img", "aria-label": has ? `${COPY.popup.scoreLabel} ${v} of 100` : "Risk score not reported" } });
  const s = svg("svg", { width: String(size), height: String(size), viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" });
  s.appendChild(svg("circle", { cx: "32", cy: "32", r: String(r), fill: "none", stroke: "var(--surface-secondary)", "stroke-width": "6" }));
  const arc = svg("circle", {
    class: "arc",
    cx: "32",
    cy: "32",
    r: String(r),
    fill: "none",
    stroke: `var(--${DECISION_TOKENS[decision].text})`,
    "stroke-width": "6",
    "stroke-linecap": "round",
    "stroke-dasharray": String(c),
    "stroke-dashoffset": String(c),
  });
  s.appendChild(arc);
  wrap.appendChild(s);
  const num = h("div", { className: "num" }, [document.createTextNode(has ? String(v) : "—"), h("small", { text: "/100" })]);
  wrap.appendChild(num);
  requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", String(c * (1 - v / 100))));
  return wrap;
}

function renderAssessment(a: Assessment, checkedAt: number): HTMLElement {
  const d = a.decision;
  const copy = DECISION_COPY[d];
  const reasons = topReasons(a);
  const label = h("p", { className: "v-label", text: copy.label, attrs: { "aria-label": copy.srText } });
  label.style.setProperty("color", `var(--${DECISION_TOKENS[d].text})`);
  const reasonText =
    d === "ALLOW"
      ? fill(COPY.allowSublabel, { n: a.coverage.percent ?? "?" })
      : (reasons[0] ?? copy.headline.replace(": {reason}", ""));
  const box = h("div", { className: "scanning" }, [
    h("div", { className: "verdict" }, [scoreRing(d, a.risk_score), h("div", { className: "v-text" }, [label, h("p", { className: "v-reason", text: reasonText })])]),
  ]);

  const pct = a.coverage.percent;
  const meter = h("div", { className: "meter", attrs: { role: "meter", "aria-label": "Coverage", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct ?? 0) } }, [h("span")]);
  (meter.firstElementChild as HTMLElement).style.setProperty("width", `${pct ?? 0}%`);
  box.appendChild(
    h("div", { className: "cov" }, [
      h("div", { className: "cov-top" }, [h("span", { text: "Coverage" }), h("span", { text: pct === null ? "not reported" : `${pct}% checked` })]),
      meter,
    ]),
  );

  // What the checks found: the engine's findings (or its reasons), never a local inference.
  const items = a.findings.length
    ? a.findings.slice(0, 4).map((f) => h("li", {}, [h("span", { className: "sev", attrs: { "data-s": f.severity ?? "info", "aria-hidden": "true" } }), h("span", { text: f.title })]))
    : reasons.slice(d === "ALLOW" ? 0 : 1).map((r) => h("li", {}, [h("span", { className: "sev", attrs: { "aria-hidden": "true" } }), h("span", { text: r })]));
  box.appendChild(h("p", { className: "muted", text: COPY.popup.findings }));
  box.appendChild(items.length ? h("ul", { className: "findings" }, items) : h("p", { className: "neutral", text: COPY.popup.noFindings }));

  const actions = h("div", { className: "actions" });
  if (a.scan_id) {
    actions.appendChild(h("a", { className: "btn primary", text: COPY.fullReport, attrs: { href: fullReportUrl(a.scan_id), target: "_blank", rel: "noopener noreferrer" } }));
    actions.appendChild(
      h("a", { className: "btn", text: COPY.popup.explainAi, attrs: { href: aiExplainUrl(a.scan_id), target: "_blank", rel: "noopener noreferrer", title: COPY.popup.explainHint } }),
    );
  }
  const host = hostOf(toReportedUrl(activeTab?.url ?? knownUrl ?? "", DEMO_SITES_ORIGIN));
  if (host && isAppealable(d)) {
    actions.appendChild(h("a", { className: "btn", text: "Appeal", attrs: { href: appealUrl(host), target: "_blank", rel: "noopener noreferrer", title: COPY.appealSite } }));
  }
  box.appendChild(actions);
  const ago = relativeAgo(a.decided_at, Date.now());
  const saved = Date.now() - checkedAt > 5_000;
  box.appendChild(h("p", { className: "muted tiny", text: [saved ? fill(COPY.popup.fromCache, { ago: ago ?? "just now" }) : ago ? fill(COPY.decidedAgo, { ago }) : "", a.cached ? "server reuse" : ""].filter(Boolean).join(" · ") }));
  return box;
}

function renderFailure(r: Extract<CheckResult, { kind: "failure" }>): HTMLElement {
  const neutral = NEUTRAL_FAILURES.has(r.failure.code);
  if (neutral) return h("p", { className: "neutral", text: failureText(r.failure.code, r.failure.retryAfter) });
  const copy = DECISION_COPY.UNKNOWN;
  const box = h("div", { className: "scanning" }, [
    h("div", { className: "verdict" }, [
      scoreRing("UNKNOWN", null),
      h("div", { className: "v-text" }, [h("p", { className: "v-label", text: copy.label }), h("p", { className: "v-reason", text: failureText(r.failure.code, r.failure.retryAfter) })]),
    ]),
  ]);
  if (r.failure.requestId) box.appendChild(h("p", { className: "muted tiny", text: `request_id ${r.failure.requestId}` }));
  return box;
}

function render(result: CheckResult): void {
  stopTicker();
  lastResult = result;
  pageStatus.replaceChildren(result.kind === "assessment" ? renderAssessment(result.assessment, result.checkedAt) : renderFailure(result));
  const neutral = result.kind === "failure" && NEUTRAL_FAILURES.has(result.failure.code);
  recheck.hidden = !(paired && !neutral);
  reportCard.hidden = !paired || neutral;
  // Nothing to watch on TrustLens itself or a local address.
  watchBtn.hidden = result.kind === "failure" && (result.failure.code === "OWN_SITE" || result.failure.code === "LOCAL_PAGE");
}

function renderChecking(host: string, since: number): void {
  stopTicker();
  const elapsed = h("span", { className: "elapsed" });
  const tick = () => {
    elapsed.textContent = `${Math.max(0, Math.round((Date.now() - since) / 1000))} s`;
  };
  tick();
  ticker = setInterval(tick, 1000);
  pageStatus.replaceChildren(
    h("div", { className: "scanning", attrs: { role: "status" } }, [
      h("div", { className: "cov-top" }, [h("span", { text: fill(COPY.popup.checkingLive, { host }) }), elapsed]),
      h("div", { className: "scanbar", attrs: { "aria-hidden": "true" } }),
      h("p", { className: "muted", text: COPY.popup.checkingHint }),
    ]),
  );
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

let knownUrl: string | null = null;

/** The tab's URL: from Chrome (granted on toolbar click), else what its content script reported. */
async function tabUrl(): Promise<string | null> {
  if (activeTab?.url) return activeTab.url;
  if (knownUrl) return knownUrl;
  if (activeTab?.id === undefined) return null;
  const r = await send({ type: "TAB_URL", tabId: activeTab.id });
  knownUrl = r.ok ? r.data : null;
  return knownUrl;
}

async function loadStatus(refresh = false): Promise<void> {
  const url = await tabUrl();
  if (!url || !/^https?:/i.test(url)) {
    pageHost.textContent = "";
    pageStatus.replaceChildren(h("p", { className: "neutral", text: COPY.popup.noPage }));
    watchBtn.hidden = true;
    reportCard.hidden = true;
    return;
  }
  const host = hostOf(toReportedUrl(url, DEMO_SITES_ORIGIN)) ?? "";
  pageHost.textContent = host;
  if (!refresh) {
    const peek = await send({ type: "PEEK_STATUS", url });
    if (peek.ok && peek.data.result) {
      render(peek.data.result);
      return;
    }
    renderChecking(host, peek.ok && peek.data.pendingSince ? peek.data.pendingSince : Date.now());
  } else {
    renderChecking(host, Date.now());
  }
  const reply = await send({ type: "GET_STATUS", url, refresh, tabId: activeTab?.id });
  render(reply.ok ? reply.data : { kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: Date.now() });
}

function renderPairing(state: PairingState, enabled: boolean): void {
  paired = state.paired;
  pairCard.hidden = state.paired;
  if (!state.paired) byId("pair-heading").textContent = state.needsReconnect ? COPY.pair.reconnect : COPY.pair.heading;
  chip.dataset.state = !state.paired ? "none" : enabled ? "on" : "off";
  chip.textContent = !state.paired ? COPY.popup.notConnected : enabled ? COPY.popup.connected : COPY.popup.protectionOff;
  protect.disabled = !state.paired;
}

wirePairForm(byId<HTMLFormElement>("pair-form"), byId<HTMLInputElement>("pair-code"), byId("pair-error"), (state) => {
  renderPairing(state, protect.checked);
  void loadStatus(true);
});

protect.addEventListener("change", async () => {
  const s = await send({ type: "SET_SETTINGS", patch: { enabled: protect.checked } });
  const enabled = s.ok ? s.data.enabled : protect.checked;
  byId("protect-label").textContent = enabled ? COPY.popup.protectionOn : COPY.popup.protectionOff;
  const pairing = await send({ type: "GET_PAIRING" });
  if (pairing.ok) renderPairing(pairing.data, enabled);
  void loadStatus(true);
});

recheck.addEventListener("click", () => void loadStatus(true));

byId("report-send").addEventListener("click", async () => {
  const url = await tabUrl();
  if (!url) return;
  const status = byId("report-status");
  const button = byId<HTMLButtonElement>("report-send");
  button.disabled = true;
  status.textContent = COPY.pair.working;
  const a = lastResult?.kind === "assessment" ? lastResult.assessment : null;
  const reply = await send({
    type: "REPORT",
    url,
    justification: byId<HTMLTextAreaElement>("report-text").value,
    observedPayee: a?.action?.payee ?? undefined,
    scanId: a?.scan_id ?? undefined,
  });
  button.disabled = false;
  status.textContent = reply.ok ? COPY.reportSent : reply.error.code === "VALIDATION_FAILED" ? reply.error.message : COPY.reportQueued;
});

// activeTab + scripting: (re)attach protection to a tab that was open before the extension loaded.
watchBtn.addEventListener("click", async () => {
  if (activeTab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
    watchStatus.textContent = COPY.popup.watching;
  } catch {
    watchStatus.textContent = COPY.popup.noPage;
  }
});

/**
 * Open path, ordered for speed. Only local reads (tab, pairing, settings — chrome.storage, a few ms)
 * gate the first render; the page status uses the saved result when there is one. The server health
 * line is filled in asynchronously and NEVER blocks the popup: when the API is busy scanning, a
 * health call can take seconds, and an earlier build awaited it before drawing anything.
 */
void (async () => {
  // popup.html?tab=<id> renders the popup for a specific tab (opened as a page, e.g. in tests);
  // otherwise it describes the active tab, as when opened from the toolbar.
  const tabParam = Number(new URLSearchParams(location.search).get("tab"));
  activeTab = Number.isInteger(tabParam) && tabParam > 0 ? await chrome.tabs.get(tabParam).catch(() => undefined) : undefined;
  if (!activeTab) [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [pairing, settings] = await Promise.all([send({ type: "GET_PAIRING" }), send({ type: "GET_SETTINGS" })]);
  const enabled = settings.ok ? settings.data.enabled : true;
  protect.checked = enabled;
  byId("protect-label").textContent = enabled ? COPY.popup.protectionOn : COPY.popup.protectionOff;
  if (pairing.ok) renderPairing(pairing.data, enabled);
  byId("api-line").textContent = "Server…";
  void send({ type: "API_STATUS" }).then((api) => {
    byId("api-dot").dataset.up = String(api.ok && api.data.reachable);
    byId("api-line").textContent = api.ok && api.data.reachable ? `Server ${api.data.version ?? ""}`.trim() : COPY.popup.apiDown;
  });
  await loadStatus();
})();
