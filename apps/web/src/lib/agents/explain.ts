/**
 * "What does this mean?" — the investigation assistant's explanation layer.
 *
 * Implementation choice (recorded in docs/04-frontend/DASHBOARD.md §5): a deterministic, client-side
 * RESHAPE of data the engine already returned for this scan. No model is called and no new endpoint
 * exists. For model-written prose the user starts an Investigation (POST /investigations), whose
 * narrator runs on the server under the same evidence discipline.
 *
 * Guarantees, enforced by explain.test.ts:
 *   - Every citation points at a finding id/code or evidence id that exists on this scan.
 *   - No finding code, decision or score is produced that the scan did not contain.
 *   - What was not checked is said explicitly (coverage.unavailable / skipped), never implied clean.
 */
import { toDecision, toRiskLevel, toSeverity } from "@/lib/api/enums";
import type { Finding, Scan } from "@/lib/api/types";
import { DECISION_COPY, OVERRIDE_COPY, RISK_LEVEL_LABEL, SEVERITY_LABEL, SIGNAL_GROUP_LABEL } from "@/lib/copy";

export const QUESTIONS = [
  { id: "meaning", label: "What does this mean?" },
  { id: "why", label: "Why this decision?" },
  { id: "coverage", label: "What was not checked?" },
  { id: "evidence", label: "What is the strongest evidence?" },
] as const;
export type QuestionId = (typeof QUESTIONS)[number]["id"];

export type Citation =
  | { kind: "finding"; id: string; code: string; label: string }
  | { kind: "evidence"; id: string; label: string }
  | { kind: "override"; id: string; label: string }
  | { kind: "coverage"; id: string; label: string };

export interface ExplanationLine {
  text: string;
  cites: Citation[];
}

export interface Explanation {
  question: QuestionId;
  lines: ExplanationLine[];
  /** Things this explanation cannot speak to, stated rather than skipped. */
  unavailable: string[];
  basis: "scan" ;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function bySeverity(findings: Finding[]): Finding[] {
  return findings.slice().sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.confidence - a.confidence);
}

function findingCite(f: Finding): Citation {
  return { kind: "finding", id: f.id, code: f.code, label: f.title };
}

function groupLabel(g: string): string {
  return SIGNAL_GROUP_LABEL[g] ?? g;
}

export function explainScan(scan: Scan, question: QuestionId): Explanation {
  const decision = toDecision(scan.decision);
  const copy = DECISION_COPY[decision];
  const findings = bySeverity(scan.findings ?? []);
  const evidence = scan.evidence ?? [];
  const coverage = scan.coverage;
  const unavailableGroups = [...(coverage?.unavailable ?? []), ...(coverage?.skipped ?? [])];
  const unavailable = unavailableGroups.map((g) => `${groupLabel(g)} was not checked on this scan.`);
  const lines: ExplanationLine[] = [];

  if (question === "meaning") {
    lines.push({
      text: `The engine decided "${copy.label}" (risk ${RISK_LEVEL_LABEL[toRiskLevel(scan.risk_level)].toLowerCase()}${
        typeof scan.risk_score === "number" ? `, score ${Math.round(scan.risk_score)}/100` : ""
      }). ${copy.meaning}`,
      cites: [],
    });
    if (decision === "ALLOW") {
      lines.push({
        text: `"No known threat" means none of the checks that ran found a problem. It is not a statement that the site is safe${
          typeof coverage?.percent === "number" ? `; ${Math.round(coverage.percent)}% of checks ran` : ""
        }.`,
        cites: coverage ? [{ kind: "coverage", id: "coverage", label: "Coverage" }] : [],
      });
    }
    const top = findings[0];
    if (top) lines.push({ text: `The most serious finding: ${top.title}.`, cites: [findingCite(top)] });
    if (findings.length === 0) lines.push({ text: "No finding was produced by the checks that ran.", cites: [] });
  }

  if (question === "why") {
    (scan.reasons ?? []).forEach((r, i) => {
      // Reasons are the engine's own sentences; attach the finding whose title or detail they restate.
      const match = findings.find((f) => r.includes(f.title) || (f.detail && r.includes(f.detail)));
      lines.push({ text: r, cites: match ? [findingCite(match)] : [{ kind: "coverage", id: `reason-${i}`, label: `Engine reason ${i + 1}` }] });
    });
    for (const o of scan.overrides ?? []) {
      lines.push({
        text: `Hard rule ${o} applied: ${OVERRIDE_COPY[o] ?? "a rule that sets the decision regardless of score."}`,
        cites: [{ kind: "override", id: o, label: o }],
      });
    }
    if (lines.length === 0) lines.push({ text: "The engine returned no reasons for this decision.", cites: [] });
  }

  if (question === "coverage") {
    const collected = coverage?.collected ?? [];
    lines.push({
      text: collected.length ? `Checked: ${collected.map(groupLabel).join(", ")}.` : "The scan did not report which checks ran.",
      cites: coverage ? [{ kind: "coverage", id: "coverage", label: "Coverage" }] : [],
    });
    if (unavailableGroups.length) {
      lines.push({
        text: `Not checked: ${unavailableGroups.map(groupLabel).join(", ")}. A check that did not run is unknown, not a pass.`,
        cites: [{ kind: "coverage", id: "coverage", label: "Coverage" }],
      });
    } else if (coverage) {
      lines.push({ text: "Every signal group ran on this scan.", cites: [{ kind: "coverage", id: "coverage", label: "Coverage" }] });
    }
  }

  if (question === "evidence") {
    for (const f of findings.slice(0, 3)) {
      const refs = (f.evidence_refs ?? []).map((id) => evidence.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
      lines.push({
        text: `${SEVERITY_LABEL[toSeverity(f.severity)]} · ${f.title}${refs[0] ? ` — ${refs[0].summary}` : ""}`,
        cites: [findingCite(f), ...refs.map((e): Citation => ({ kind: "evidence", id: e.id, label: e.source }))],
      });
    }
    if (findings.length === 0) lines.push({ text: "There is no finding, so there is no supporting evidence to rank.", cites: [] });
  }

  return { question, lines, unavailable: question === "coverage" ? [] : unavailable, basis: "scan" };
}

/** Every citation in an explanation must resolve against the scan (used by tests and the UI guard). */
export function citationsResolve(scan: Scan, ex: Explanation): boolean {
  const findingIds = new Set((scan.findings ?? []).map((f) => `${f.id}|${f.code}`));
  const evidenceIds = new Set((scan.evidence ?? []).map((e) => e.id));
  const overrides = new Set(scan.overrides ?? []);
  return ex.lines.every((l) =>
    l.cites.every((c) =>
      c.kind === "finding"
        ? findingIds.has(`${c.id}|${c.code}`)
        : c.kind === "evidence"
          ? evidenceIds.has(c.id)
          : c.kind === "override"
            ? overrides.has(c.id)
            : true,
    ),
  );
}
