// Options: API status, pairing / unpair, protection toggle, privacy statement, clear local data.
import { COPY, fill } from "../shared/copy";
import { API_BASE_URL, EXT_VERSION } from "../shared/config";
import { send, type PairingState } from "../shared/messages";
import { applyTokens, byId, h } from "../shared/page";
import { wirePairForm } from "../shared/pair-form";

applyTokens();

byId("version").textContent = fill(COPY.popup.version, { v: EXT_VERSION });
byId("api-origin").textContent = API_BASE_URL;
byId("privacy").replaceChildren(...COPY.options.privacy.map((p) => h("li", { text: p })));

async function checkApi(): Promise<void> {
  const el = byId("api-status");
  el.textContent = "Checking…";
  const r = await send({ type: "API_STATUS" });
  el.textContent =
    r.ok && r.data.reachable
      ? `${COPY.options.apiUp}${r.data.version ? ` · API ${r.data.version}` : ""}`
      : COPY.options.apiDown;
}

function renderPairing(s: PairingState): void {
  const state = byId("pair-state");
  if (s.paired) {
    state.textContent = `${COPY.pair.connected}${s.deviceId ? ` · device ${s.deviceId}` : ""}${s.expiresAt ? ` · expires ${s.expiresAt}` : ""}`;
  } else {
    state.textContent = s.needsReconnect ? COPY.pair.reconnect : COPY.pair.body;
  }
  byId("pair-form").hidden = s.paired;
  byId("unpair").hidden = !s.paired;
}

wirePairForm(byId<HTMLFormElement>("pair-form"), byId<HTMLInputElement>("pair-code"), byId("pair-error"), renderPairing);

byId("unpair").addEventListener("click", async () => {
  const r = await send({ type: "UNPAIR" });
  if (r.ok) {
    renderPairing(r.data);
    byId("pair-state").textContent = COPY.options.unpaired;
  }
});

byId("clear").addEventListener("click", async () => {
  const r = await send({ type: "CLEAR_DATA" });
  byId("clear-status").textContent = r.ok ? COPY.options.cleared : COPY.pair.failed;
  const p = await send({ type: "GET_PAIRING" });
  if (p.ok) renderPairing(p.data);
});

const enabled = byId<HTMLInputElement>("enabled");
enabled.addEventListener("change", () => void send({ type: "SET_SETTINGS", patch: { enabled: enabled.checked } }));
byId("api-recheck").addEventListener("click", () => void checkApi());

void (async () => {
  const [p, s] = await Promise.all([send({ type: "GET_PAIRING" }), send({ type: "GET_SETTINGS" })]);
  if (p.ok) renderPairing(p.data);
  if (s.ok) enabled.checked = s.data.enabled;
  await checkApi();
})();
