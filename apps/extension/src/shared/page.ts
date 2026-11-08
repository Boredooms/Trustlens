// Shared helpers for extension pages (popup/options): apply tokens, build DOM via textContent, render status.
import { topReasons, payeeComparison } from "./assessment";
import { COPY, DECISION_COPY, failureText, fill, relativeAgo } from "./copy";
import { appealUrl, fullReportUrl, isAppealable } from "./config";
import { DECISION_TOKENS, tokensCss } from "./tokens";
import type { CheckResult } from "./types";

export function applyTokens(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(tokensCss(":root"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  children: (Node | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.className) e.className = props.className;
  if (props.text !== undefined) e.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) e.setAttribute(k, v);
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

export function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

/** Popup headline + details for a check result (BROWSER_PROTECTION_LOGIC.md §7). */
export function renderStatus(result: CheckResult, now = Date.now(), pageHost: string | null = null): HTMLElement {
  const box = h("div", { className: "card-inner" });
  box.style.setProperty("display", "flex");
  box.style.setProperty("flex-direction", "column");
  box.style.setProperty("gap", "8px");

  const decision = result.kind === "assessment" ? result.assessment.decision : "UNKNOWN";
  const copy = DECISION_COPY[decision];
  const badge = h("span", { className: "badge", text: copy.label, attrs: { "aria-label": copy.srText } });
  badge.style.setProperty("color", `var(--${DECISION_TOKENS[decision].text})`);
  badge.style.setProperty("background", `var(--${DECISION_TOKENS[decision].surface})`);
  box.appendChild(badge);

  if (result.kind === "failure") {
    box.appendChild(
      h("p", { className: "headline", text: fill(copy.headline, { reason: failureText(result.failure.code, result.failure.retryAfter) }) }),
    );
    if (result.failure.requestId) box.appendChild(h("p", { className: "muted", text: `request_id ${result.failure.requestId}` }));
    return box;
  }

  const a = result.assessment;
  const percent = a.coverage.percent;
  const headline = fill(copy.headline, {
    reason: a.reasons[0] ?? copy.label,
    coverage: percent ?? "?",
  });
  box.appendChild(h("p", { className: "headline", text: headline }));
  if (decision === "ALLOW" && percent !== null) {
    box.appendChild(h("p", { className: "muted", text: fill(COPY.allowSublabel, { n: percent }) }));
  }
  const { observed, expected } = payeeComparison(a);
  if ((decision === "BLOCK" || decision === "WARN") && observed && expected.length > 0) {
    const org = a.action?.claimed_organisation?.name ?? COPY.unknownOrg;
    box.appendChild(
      h("p", { className: "payee", text: fill(COPY.payeeMismatch, { observed, org, expected: expected.join(", ") }) }),
    );
  }
  const reasons = topReasons(a).slice(decision === "ALLOW" ? 0 : 1);
  if (reasons.length) box.appendChild(h("ul", {}, reasons.map((r) => h("li", { text: r }))));
  const ago = relativeAgo(a.decided_at, now);
  box.appendChild(
    h("p", {
      className: "muted",
      text: [percent === null ? COPY.coverageMissing : fill(COPY.coverageLine, { n: percent }), ago ? fill(COPY.decidedAgo, { ago }) : ""]
        .filter(Boolean)
        .join(" "),
    }),
  );
  if (a.scan_id) {
    box.appendChild(
      h("a", { text: COPY.fullReport, attrs: { href: fullReportUrl(a.scan_id), target: "_blank", rel: "noopener noreferrer" } }),
    );
  }
  if (pageHost && isAppealable(decision)) {
    box.appendChild(
      h("a", {
        className: "muted",
        text: COPY.appealSite,
        attrs: { href: appealUrl(pageHost), target: "_blank", rel: "noopener noreferrer" },
      }),
    );
  }
  return box;
}
