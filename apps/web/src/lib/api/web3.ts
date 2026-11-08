// Web3 report registry calls (docs/02-architecture/WEB3_REGISTRY.md §5).
// Types come from the generated OpenAPI package (AGENTS.md rule 9), not hand-written mirrors.
import type { components } from "@trustlens/shared-types";
import { path, request } from "./client";

export type Anchor = components["schemas"]["AnchorOut"];
export type AnchorVerification = components["schemas"]["AnchorVerification"];

export const web3 = {
  anchor: (reportId: string) => request<Anchor>("GET", path`/api/v1/reports/${reportId}/anchor`),
  createAnchor: (reportId: string) => request<Anchor>("POST", path`/api/v1/reports/${reportId}/anchor`),
  // Public: no credentials, so the page works signed out and in a private window.
  verify: (reportId: string) => request<AnchorVerification>("GET", path`/api/v1/public/verify/${reportId}`, { auth: false }),
  verifyPayload: (reportId: string, payload: Record<string, unknown>) =>
    request<AnchorVerification>("POST", path`/api/v1/public/verify/${reportId}`, { body: { payload }, auth: false }),
};

/** Shorten a 0x hash for display; the full value stays copyable. */
export function shortHex(value: string | null | undefined, keep = 10): string {
  if (!value) return "—";
  return value.length > keep * 2 + 2 ? `${value.slice(0, keep + 2)}…${value.slice(-keep)}` : value;
}
