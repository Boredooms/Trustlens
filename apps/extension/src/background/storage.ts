// chrome.storage wrappers (EXTENSION_ARCHITECTURE.md §5). No in-memory state that matters:
// the worker can be terminated at any time and rehydrates from here.
import { readCache, isCacheable, type CachedVerdict, type CacheRead } from "../shared/cache";
import { sha256Hex } from "../shared/hash";
import { DEFAULT_SETTINGS, type CheckResult, type Settings } from "../shared/types";
import type { PairingState } from "../shared/messages";

const SCHEMA_VERSION = 1;
const MAX_VERDICTS = 200;

export async function migrate(): Promise<void> {
  const { schemaVersion } = await chrome.storage.local.get("schemaVersion");
  if (schemaVersion === SCHEMA_VERSION) return;
  if (typeof schemaVersion === "number" && schemaVersion > SCHEMA_VERSION) {
    // Unknown future version: reset to defaults rather than crash (§9).
    await chrome.storage.local.clear();
  }
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION });
}

// ---- pairing --------------------------------------------------------------------------------

export async function getToken(): Promise<string | null> {
  const { device_token } = await chrome.storage.local.get("device_token");
  return typeof device_token === "string" && device_token.startsWith("tl_ext_") ? device_token : null;
}

export async function savePairing(p: { device_token: string; device_id: string | null; expires_at: string | null }) {
  await chrome.storage.local.set({
    device_token: p.device_token,
    device_id: p.device_id,
    device_expires_at: p.expires_at,
    needs_reconnect: false,
    last_me_check: Date.now(),
  });
}

/** 401 handling: clear the token, remember to show "Reconnect", drop cached verdicts. */
export async function clearToken(needsReconnect: boolean): Promise<void> {
  await chrome.storage.local.remove(["device_token", "device_id", "device_expires_at", "last_me_check"]);
  await chrome.storage.local.set({ needs_reconnect: needsReconnect });
  await clearVerdicts();
}

export async function getPairing(): Promise<PairingState> {
  const s = await chrome.storage.local.get(["device_token", "device_id", "device_expires_at", "needs_reconnect"]);
  return {
    paired: typeof s.device_token === "string" && s.device_token.startsWith("tl_ext_"),
    needsReconnect: s.needs_reconnect === true,
    deviceId: typeof s.device_id === "string" ? s.device_id : null,
    expiresAt: typeof s.device_expires_at === "string" ? s.device_expires_at : null,
  };
}

// ---- settings -------------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings && typeof settings === "object" ? (settings as Partial<Settings>) : {};
  return { enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_SETTINGS.enabled };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()) };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  await chrome.storage.local.set({ settings: next });
  return next;
}

// ---- verdict cache (storage.session, keyed by sha256 of the normalised URL) ------------------

async function verdictKey(url: string): Promise<string> {
  return `verdict:${await sha256Hex(url)}`;
}

export async function readVerdict(url: string, now = Date.now()): Promise<CacheRead> {
  const key = await verdictKey(url);
  const got = await chrome.storage.session.get(key);
  return readCache(got[key], now);
}

export async function writeVerdict(url: string, result: CheckResult): Promise<void> {
  if (!isCacheable(result)) return;
  const entry: CachedVerdict = { result, cachedAt: result.checkedAt };
  try {
    await chrome.storage.session.set({ [await verdictKey(url)]: entry });
    await evictVerdicts();
  } catch {
    // Quota: evict and continue without caching (§8 storage quota row).
    await evictVerdicts(0).catch(() => undefined);
  }
}

async function evictVerdicts(keep = MAX_VERDICTS): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith("verdict:"))
    .map(([k, v]) => [k, (v as Partial<CachedVerdict>)?.cachedAt ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const drop = entries.slice(keep).map(([k]) => k);
  if (drop.length) await chrome.storage.session.remove(drop);
}

export async function clearVerdicts(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("verdict:"));
  if (keys.length) await chrome.storage.session.remove(keys);
}

// ---- rate-limit window, WARN dismissals, override counters -----------------------------------

export async function getRateLimitedUntil(): Promise<number> {
  const { rate_limited_until } = await chrome.storage.session.get("rate_limited_until");
  return typeof rate_limited_until === "number" ? rate_limited_until : 0;
}

export async function setRateLimitedFor(seconds: number | null | undefined): Promise<void> {
  const s = typeof seconds === "number" && seconds > 0 ? seconds : 60;
  await chrome.storage.session.set({ rate_limited_until: Date.now() + s * 1000 });
}

export async function dismissWarn(host: string): Promise<void> {
  await chrome.storage.session.set({ [`warn_dismissed:${host}`]: true });
}

export async function isWarnDismissed(host: string): Promise<boolean> {
  const k = `warn_dismissed:${host}`;
  const got = await chrome.storage.session.get(k);
  return got[k] === true;
}

export async function recordOverride(taken: boolean): Promise<void> {
  const { overrides } = await chrome.storage.local.get("overrides");
  const o = overrides && typeof overrides === "object" ? (overrides as { shown?: number; taken?: number }) : {};
  await chrome.storage.local.set({
    overrides: { shown: (o.shown ?? 0) + 1, taken: (o.taken ?? 0) + (taken ? 1 : 0) },
  });
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION });
}
