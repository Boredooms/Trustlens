// Build-time configuration (scripts/build.mjs injects these via esbuild `define`).
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
export const WEB_BASE_URL: string = (import.meta.env.VITE_WEB_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
export const DEMO_SITES_ORIGIN: string | null = import.meta.env.VITE_DEMO_SITES_ORIGIN || null;
export const EXT_VERSION: string = import.meta.env.EXT_VERSION || "0.0.0";

export function fullReportUrl(scanId: string): string {
  return `${WEB_BASE_URL}/app/scan/${encodeURIComponent(scanId)}`;
}

/** Public appeal form, pre-filled with the host the decision was about (site owners only). */
export function appealUrl(host: string): string {
  return `${WEB_BASE_URL}/appeal?domain=${encodeURIComponent(host)}`;
}

/** Decisions a site owner may appeal: the ones that warn or stop users. */
export function isAppealable(decision: string): boolean {
  return decision === "BLOCK" || decision === "WARN";
}
