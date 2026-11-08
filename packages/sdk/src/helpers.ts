import type { Decision } from "./types.js";

/** `true` only for `BLOCK`. No policy beyond the enum (SDK_SPECIFICATION.md §7). */
export function shouldBlock(result: { decision: Decision }): boolean {
  return result.decision === "BLOCK";
}

/** `true` only for `WARN`. `REVIEW` and `UNKNOWN` are deliberately distinct; handle them yourself. */
export function requiresConfirmation(result: { decision: Decision }): boolean {
  return result.decision === "WARN";
}
