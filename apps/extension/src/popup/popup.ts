// Popup (360×420): paired state, current-page decision, pair form, report, on-demand watch.
import { COPY, fill } from "../shared/copy";
import { DEMO_SITES_ORIGIN, EXT_VERSION } from "../shared/config";
import { hostOf, toReportedUrl } from "../shared/demo-url";
import { send, type PairingState } from "../shared/messages";
import { applyTokens, byId, h, renderStatus } from "../shared/page";
import { wirePairForm } from "../shared/pair-form";
import type { CheckResult } from "../shared/types";

applyTokens();

const pageStatus = byId<HTMLDivElement>("page-status");
const pairCard = byId<HTMLElement>("pair-card");
const reportCard = byId<HTMLElement>("report-card");
const watchBtn = byId<HTMLButtonElement>("watch");
const watchStatus = byId<HTMLParagraphElement>("watch-status");

byId("version").textContent = fill(COPY.popup.version, { v: EXT_VERSION });
byId("pair-body").textContent = COPY.pair.body;
byId("report-hint").textContent = COPY.reportJustificationHint;
watchBtn.textContent = COPY.popup.watchPage;
byId("open-options").addEventListener("click", () => void chrome.runtime.openOptionsPage());

let activeTab: chrome.tabs.Tab | undefined;
let lastResult: CheckResult | null = null;

async function loadStatus(refresh = false): Promise<void> {
  const url = activeTab?.url;
  if (!url || !/^https?:/i.test(url)) {
    pageStatus.replaceChildren(h("p", { className: "muted", text: COPY.popup.noPage }));
    watchBtn.hidden = true;
    reportCard.hidden = true;
    return;
  }
  pageStatus.replaceChildren(h("p", { className: "muted", text: "Checking…" }));
  const reply = await send({ type: "GET_STATUS", url, refresh });
  const result: CheckResult = reply.ok
    ? reply.data
    : { kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: Date.now() };
  lastResult = result;
  pageStatus.replaceChildren(renderStatus(result, Date.now(), hostOf(toReportedUrl(url, DEMO_SITES_ORIGIN))));
}

function renderPairing(state: PairingState): void {
  pairCard.hidden = state.paired;
  if (!state.paired) {
    byId("pair-heading").textContent = state.needsReconnect ? COPY.pair.reconnect : COPY.pair.heading;
  }
  reportCard.hidden = !state.paired;
}

wirePairForm(byId<HTMLFormElement>("pair-form"), byId<HTMLInputElement>("pair-code"), byId("pair-error"), (state) => {
  renderPairing(state);
  void loadStatus(true);
});

byId("report-send").addEventListener("click", async () => {
  const url = activeTab?.url;
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
  status.textContent = reply.ok
    ? COPY.reportSent
    : reply.error.code === "VALIDATION_FAILED"
      ? reply.error.message
      : COPY.reportQueued;
});

// activeTab + scripting: protect the current tab on demand, even outside the declared demo hosts.
watchBtn.addEventListener("click", async () => {
  if (activeTab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
    watchStatus.textContent = COPY.popup.watching;
  } catch {
    watchStatus.textContent = COPY.popup.noPage;
  }
});

void (async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pairing = await send({ type: "GET_PAIRING" });
  if (pairing.ok) renderPairing(pairing.data);
  await loadStatus();
})();
