/**
 * Dashboard ↔ TrustLens extension bridge (one-click "Connect this browser").
 *
 * The extension injects `bridge.js` on the dashboard origin only. This module talks to it with
 * window.postMessage on this window and this origin:
 *   PING                          → { type: "TRUSTLENS_EXTENSION", version, paired }
 *   PAIR { code, deviceName }     → { type: "PAIR_RESULT", ok, paired | code }
 *
 * The pairing code comes from POST /auth/extension/pair over the signed-in session; the extension
 * exchanges it for its own device token. No token ever passes through the page.
 */
const FROM_WEB = "trustlens-web";
const FROM_EXT = "trustlens-extension";

export interface ExtensionPresence {
  installed: boolean;
  version: string | null;
  paired: boolean;
}

function isFromExtension(e: MessageEvent): e is MessageEvent<{ source: string; type: string; [k: string]: unknown }> {
  return e.source === window && e.origin === window.location.origin && typeof e.data === "object" && e.data !== null && e.data.source === FROM_EXT;
}

/** Detect the extension (resolves with installed=false after `timeoutMs` if nothing answers). */
export function detectExtension(timeoutMs = 1200): Promise<ExtensionPresence> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: ExtensionPresence) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      resolve(p);
    };
    const onMsg = (e: MessageEvent) => {
      if (!isFromExtension(e) || e.data.type !== "TRUSTLENS_EXTENSION") return;
      finish({ installed: true, version: typeof e.data.version === "string" ? e.data.version : null, paired: e.data.paired === true });
    };
    window.addEventListener("message", onMsg);
    const timer = setTimeout(
      () => finish({ installed: Boolean(document.documentElement.dataset.trustlensExtension), version: document.documentElement.dataset.trustlensExtension ?? null, paired: false }),
      timeoutMs,
    );
    window.postMessage({ source: FROM_WEB, type: "PING" }, window.location.origin);
  });
}

export type ConnectOutcome = { ok: true } | { ok: false; code: string };

/** Hand a freshly generated pairing code to the extension and wait for its exchange result. */
export function connectExtension(code: string, deviceName: string, timeoutMs = 20_000): Promise<ConnectOutcome> {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (!isFromExtension(e) || e.data.type !== "PAIR_RESULT" || e.data.requestId !== requestId) return;
      cleanup();
      resolve(e.data.ok === true ? { ok: true } : { ok: false, code: typeof e.data.code === "string" ? e.data.code : "PAIR_FAILED" });
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, code: "EXTENSION_TIMEOUT" });
    }, timeoutMs);
    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: FROM_WEB, type: "PAIR", code, deviceName, requestId }, window.location.origin);
  });
}

export function browserDeviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "desktop";
  return `${browser} on ${os}`;
}
