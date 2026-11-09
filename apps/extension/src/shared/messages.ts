// Single discriminated union for runtime messaging (EXTENSION_ARCHITECTURE.md §4).
// No message ever carries a password, OTP, cookie, card number, field value or page HTML.
import type { ActionIntent, CheckResult, Settings } from "./types";

export type Msg =
  | { type: "PAGE_READY"; url: string }
  | { type: "GET_STATUS"; url: string; refresh?: boolean; tabId?: number }
  | {
      type: "ACTION_INTENT";
      url: string;
      intent: ActionIntent;
      formAction?: string;
      payee?: string;
      destinationHost?: string;
    }
  | {
      type: "REPORT";
      url: string;
      intent?: ActionIntent;
      observedPayee?: string;
      scanId?: string;
      justification?: string;
    }
  | { type: "PAIR"; code: string; deviceName: string }
  | { type: "GET_PAIRING" }
  | { type: "UNPAIR" }
  | { type: "CLEAR_DATA" }
  | { type: "API_STATUS" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; patch: Partial<Settings> }
  | { type: "RECORD_OVERRIDE"; taken: boolean }
  | { type: "DISMISS_WARN"; host: string }
  | { type: "IS_WARN_DISMISSED"; host: string }
  /** Popup: the saved result and/or an in-flight check for this URL, without starting a request. */
  | { type: "PEEK_STATUS"; url: string }
  /** Popup: the page URL this tab's content script last reported (when the tab URL is not visible). */
  | { type: "TAB_URL"; tabId: number }
  /** Dashboard bridge (bridge.ts, dashboard origin only): is the extension here, and is it paired? */
  | { type: "BRIDGE_HELLO" }
  /** Dashboard bridge: exchange a code the signed-in dashboard just generated (one-click connect). */
  | { type: "PAIR_FROM_DASHBOARD"; code: string; deviceName: string };

export interface PeekResult {
  /** A fresh (≤ 10 min) server assessment, or a neutral not-checked state (local page, own site). */
  result: CheckResult | null;
  /** Epoch ms when an in-flight check for this URL started, or null. */
  pendingSince: number | null;
}

export interface BridgeHello {
  version: string;
  paired: boolean;
}

export interface PairingState {
  paired: boolean;
  needsReconnect: boolean;
  deviceId: string | null;
  expiresAt: string | null;
}

export interface ResponseMap {
  PAGE_READY: CheckResult;
  GET_STATUS: CheckResult;
  ACTION_INTENT: CheckResult;
  REPORT: { id: string | null; status: string | null };
  PAIR: PairingState;
  GET_PAIRING: PairingState;
  UNPAIR: PairingState;
  CLEAR_DATA: null;
  API_STATUS: { reachable: boolean; version: string | null };
  GET_SETTINGS: Settings;
  SET_SETTINGS: Settings;
  RECORD_OVERRIDE: null;
  DISMISS_WARN: null;
  IS_WARN_DISMISSED: boolean;
  PEEK_STATUS: PeekResult;
  TAB_URL: string | null;
  BRIDGE_HELLO: BridgeHello;
  PAIR_FROM_DASHBOARD: PairingState;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Send a message to the service worker. Never throws: transport errors become `{ok:false}`. */
export async function send<M extends Msg>(msg: M): Promise<Reply<ResponseMap[M["type"]]>> {
  try {
    const reply = (await chrome.runtime.sendMessage(msg)) as Reply<ResponseMap[M["type"]]> | undefined;
    if (!reply || typeof reply !== "object" || !("ok" in reply)) {
      return { ok: false, error: { code: "NO_REPLY", message: "The extension did not respond." } };
    }
    return reply;
  } catch (err) {
    return { ok: false, error: { code: "TRANSPORT", message: err instanceof Error ? err.message : String(err) } };
  }
}
