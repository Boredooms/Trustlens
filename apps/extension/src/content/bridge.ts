// Dashboard bridge (one-click "Connect this browser"). Injected ONLY on the TrustLens dashboard
// origin (WEB_BASE_URL, see build.mjs). It relays two requests from the dashboard page to the worker:
//
//   PING  → { type: "TRUSTLENS_EXTENSION", version, paired }   (presence + pairing state)
//   PAIR  → exchanges a pairing code the signed-in dashboard just generated, replies PAIR_RESULT
//
// Security: messages are accepted only from this window, from this origin, and with the expected
// shape. The worker re-checks that the sender is the top frame of the dashboard origin. The code is
// single-use and short-lived; the device token never leaves extension storage and is never posted back.
import { EXT_VERSION } from "../shared/config";
import { send } from "../shared/messages";

const FROM_WEB = "trustlens-web";
const FROM_EXT = "trustlens-extension";
const MARK = "__trustlensBridgeLoaded";
type Marked = typeof globalThis & { [MARK]?: boolean };

function post(payload: Record<string, unknown>): void {
  window.postMessage({ source: FROM_EXT, ...payload }, location.origin);
}

async function announce(): Promise<void> {
  const hello = await send({ type: "BRIDGE_HELLO" });
  post({ type: "TRUSTLENS_EXTENSION", version: EXT_VERSION, paired: hello.ok ? hello.data.paired : false });
}

function init(): void {
  document.documentElement.dataset.trustlensExtension = EXT_VERSION;
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { source?: unknown; type?: unknown; code?: unknown; deviceName?: unknown; requestId?: unknown } | null;
    if (!d || d.source !== FROM_WEB || typeof d.type !== "string") return;
    if (d.type === "PING") {
      void announce();
      return;
    }
    if (d.type === "PAIR" && typeof d.code === "string") {
      const requestId = typeof d.requestId === "string" ? d.requestId.slice(0, 64) : null;
      const deviceName = typeof d.deviceName === "string" ? d.deviceName.slice(0, 100) : "Chrome";
      void (async () => {
        const reply = await send({ type: "PAIR_FROM_DASHBOARD", code: d.code as string, deviceName });
        post(
          reply.ok
            ? { type: "PAIR_RESULT", requestId, ok: true, paired: reply.data.paired }
            : { type: "PAIR_RESULT", requestId, ok: false, code: reply.error.code },
        );
      })();
    }
  });
  void announce();
  // Lets the popup describe this tab ("This is TrustLens itself"); the worker never scans its own site.
  void send({ type: "PAGE_READY", url: location.href });
}

const g = globalThis as Marked;
if (!g[MARK]) {
  g[MARK] = true;
  init();
}
