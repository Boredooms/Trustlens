/**
 * Action planner: proposes next steps for a person to take on a scan. It PROPOSES; the user executes
 * through the existing mutations (each of which the API audits). A proposal never changes a decision
 * and is derived only from the scan's stored state and its linked context.
 */
import { toDecision, toScanStatus } from "@/lib/api/enums";
import type { Scan } from "@/lib/api/types";
import type { ScanContext } from "./coordinator";

export type ActionKind = "investigate" | "report" | "rescan" | "note" | "campaign" | "appeal";

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  label: string;
  /** Why this is suggested, in one plain sentence tied to stored data. */
  reason: string;
  to?: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function proposeActions(scan: Scan, ctx: ScanContext | null | undefined, now: number = Date.now()): ProposedAction[] {
  const status = toScanStatus(scan.status);
  if (status !== "completed" && status !== "partial") return [];
  const d = toDecision(scan.decision);
  const out: ProposedAction[] = [];
  const reported = (ctx?.reports ?? []).length > 0;

  if (d === "BLOCK" || d === "WARN" || d === "REVIEW") {
    out.push({
      id: "investigate",
      kind: "investigate",
      label: "Start an investigation",
      reason: "Builds a cited narrative and connected infrastructure for this decision.",
    });
  }
  if ((d === "BLOCK" || d === "WARN") && !reported) {
    out.push({ id: "report", kind: "report", label: "Report this site", reason: "No community report about this domain is in your reports yet." });
  }
  for (const c of (ctx?.campaigns ?? []).slice(0, 2)) {
    out.push({ id: `campaign-${c.id}`, kind: "campaign", label: `Open campaign "${c.name}"`, reason: `It lists ${c.matchedMember} as a member.`, to: `/app/campaigns/${c.id}` });
  }
  const age = now - new Date(scan.completed_at ?? scan.created_at).getTime();
  if (age > DAY || status === "partial") {
    out.push({
      id: "rescan",
      kind: "rescan",
      label: "Re-scan now",
      reason: status === "partial" ? "Some checks did not finish on this scan." : "This result is more than a day old.",
    });
  }
  out.push({ id: "note", kind: "note", label: "Add an investigation note", reason: "Notes are saved to your account, next to this scan." });
  return out;
}
