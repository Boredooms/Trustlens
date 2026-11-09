// Shadow-DOM overlay UI (BROWSER_PROTECTION_LOGIC.md §5.3–§5.4, design-system-guardrails §6).
// - closed shadow root, `all: initial` on the host, constructed stylesheet (survives page CSP)
// - system fonts only, legible at 320 px, never taller than 90vh
// - takes focus only when it is holding an action; every API string goes in via textContent
import { COPY, DECISION_COPY } from "../shared/copy";
import type { OverlayModel } from "../shared/overlay-model";
import { DECISION_TOKENS, tokensCss, Z_TOP } from "../shared/tokens";
import type { ActionIntent, Decision } from "../shared/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const SHIELD = "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
// Lucide icon geometry (DESIGN_SYSTEM.md §6), embedded so nothing is fetched at runtime.
const ICONS: Record<string, string[]> = {
  "shield-x": [SHIELD, "m14.5 9.5-5 5", "m9.5 9.5 5 5"],
  "shield-alert": [SHIELD, "M12 8v4", "M12 16h.01"],
  "shield-check": [SHIELD, "m9 12 2 2 4-4"],
  "shield-question": [SHIELD, "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  search: ["M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16z", "m21 21-4.3-4.3"],
};

function icon(name: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

const STYLES = `
${tokensCss(":host")}
:host{all:initial;position:fixed;inset:0;z-index:${Z_TOP};pointer-events:none;font-family:var(--font-sans);color:var(--foreground);}
*{box-sizing:border-box;margin:0;padding:0;font:inherit;color:inherit;}
.scrim{position:fixed;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb, var(--foreground) 45%, transparent);}
.scrim.guard{background:color-mix(in srgb, var(--surface) 97%, transparent);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);}
.panel{width:100%;max-width:440px;max-height:90vh;overflow:auto;background:var(--surface);color:var(--foreground);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-modal);font-size:14px;line-height:1.55;}
.head{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid var(--border);font-size:12px;font-weight:500;letter-spacing:.02em;}
.head .brand{color:var(--muted-strong);}
.head .label{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;}
.body{padding:20px;display:flex;flex-direction:column;gap:16px;}
h2{font-size:18px;line-height:1.35;font-weight:500;}
.mismatch{display:flex;flex-direction:column;gap:4px;padding:12px 16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-secondary);}
.mismatch .k{color:var(--muted-strong);font-size:13px;}
.mismatch .v{font-family:var(--font-mono);font-size:15px;line-height:1.4;word-break:break-all;margin-bottom:6px;}
.v.observed{color:var(--danger);font-weight:500;}
.v.expected{color:var(--foreground);}
.reasons h3{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--muted-strong);margin-bottom:4px;}
.reasons ul{padding-left:18px;display:flex;flex-direction:column;gap:4px;}
.note{font-size:12px;line-height:1.4;color:var(--muted-strong);}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;}
.links{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;}
button,a{cursor:pointer;border-radius:var(--radius-md);text-decoration:none;}
button:focus-visible,a:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;}
.primary{background:var(--primary);color:var(--primary-foreground);border:1px solid var(--primary);height:36px;padding:0 16px;font-weight:500;}
.primary:hover{background:var(--primary-hover);}
.secondary{background:transparent;color:var(--foreground);border:1px solid var(--border-strong);height:36px;padding:0 16px;}
.linkbtn{background:none;border:none;padding:4px 0;color:var(--muted-strong);text-decoration:underline;text-underline-offset:2px;}
.linkbtn.armed{color:var(--danger);border:1px solid var(--danger);padding:0 12px;height:36px;text-decoration:none;}
.link{color:var(--foreground);text-decoration:underline;text-underline-offset:2px;}
.link.subtle{color:var(--muted-strong);font-size:12px;}
.status{font-size:12px;color:var(--muted-strong);min-height:1em;}
.toast,.banner{position:fixed;pointer-events:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.4;max-width:calc(100vw - 32px);}
.toast{right:16px;bottom:16px;padding:10px 14px;}
.banner{right:16px;top:16px;min-height:44px;padding:6px 8px 6px 12px;}
.banner .msg{overflow:hidden;text-overflow:ellipsis;}
.banner button{height:28px;padding:0 10px;font-size:12px;}
.spin{width:14px;height:14px;border:2px solid var(--border-strong);border-top-color:var(--foreground);border-radius:50%;animation:s 0.8s linear infinite;}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.spin{animation:none}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensureRoot(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement("trustlens-overlay");
  root = host.attachShadow({ mode: "closed" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);
  }
  document.documentElement.appendChild(host);
  return root;
}

function clear(selector: string): void {
  root?.querySelectorAll(selector).forEach((n) => n.remove());
}

function toneStyle(node: HTMLElement, tone: Decision): void {
  const t = DECISION_TOKENS[tone];
  node.style.setProperty("color", `var(--${t.text})`);
  node.style.setProperty("background", `var(--${t.surface})`);
}

function header(tone: Decision, label: string): HTMLElement {
  const head = el("div", "head");
  head.appendChild(el("span", "brand", COPY.product));
  const badge = el("span", "label");
  toneStyle(badge, tone);
  badge.appendChild(icon(DECISION_COPY[tone].icon, 14));
  badge.appendChild(el("span", undefined, label));
  head.appendChild(badge);
  return head;
}

export interface HoldOptions {
  /** Page guard: hide the page behind an opaque shield instead of dimming it. */
  guard?: boolean;
  title?: string;
  note?: string;
}

/** Holds the action while the server is asked. Focus moves here because the action is held. */
export function showChecking(intent: ActionIntent, onCancel: () => void, opts: HoldOptions = {}): () => void {
  const r = ensureRoot();
  clear(".scrim");
  const scrim = el("div", opts.guard ? "scrim guard" : "scrim");
  const panel = el("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-busy", "true");
  panel.appendChild(header("UNKNOWN", COPY.product));
  const body = el("div", "body");
  const row = el("div", "actions");
  row.appendChild(el("span", "spin"));
  const h = el("h2", undefined, opts.title ?? COPY.checking[intent]);
  h.id = "tl-title";
  row.appendChild(h);
  body.appendChild(row);
  if (opts.note) body.appendChild(el("p", "note", opts.note));
  const cancel = el("button", "secondary", COPY.goBack);
  cancel.type = "button";
  cancel.addEventListener("click", onCancel);
  body.appendChild(cancel);
  panel.setAttribute("aria-labelledby", "tl-title");
  panel.appendChild(body);
  scrim.appendChild(panel);
  r.appendChild(scrim);
  cancel.focus({ preventScroll: true });
  return () => scrim.remove();
}

export interface DecisionHandlers {
  onReport: () => Promise<string>;
}

/**
 * Show a holding overlay for block/confirm/unknown modes. Resolves "proceed" or "back".
 * BLOCK needs two clicks to proceed ("Proceed anyway" → "I understand the risk — proceed").
 */
export function showDecision(
  model: OverlayModel,
  handlers: DecisionHandlers,
  opts: Pick<HoldOptions, "guard"> = {},
): Promise<"proceed" | "back"> {
  const r = ensureRoot();
  clear(".scrim");
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    const scrim = el("div", opts.guard ? "scrim guard" : "scrim");
    const panel = el("div", "panel");
    panel.setAttribute("role", model.mode === "block" ? "alertdialog" : "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "tl-title");
    panel.setAttribute("aria-describedby", "tl-desc");
    panel.appendChild(header(model.tone, model.label));

    const body = el("div", "body");
    const title = el("h2", undefined, model.title);
    title.id = "tl-title";
    body.appendChild(title);

    const desc = el("div");
    desc.id = "tl-desc";
    desc.style.setProperty("display", "contents");
    if (model.mismatch?.kind === "payee") {
      const m = model.mismatch;
      const box = el("div", "mismatch");
      box.appendChild(el("span", "k", "This page asks you to pay"));
      box.appendChild(el("span", "v observed", m.observed));
      if (m.expected.length > 0) {
        box.appendChild(el("span", "k", `${m.org} has registered`));
        box.appendChild(el("span", "v expected", m.expected.join(", ")));
      }
      desc.appendChild(box);
    } else if (model.mismatch?.kind === "credential") {
      const box = el("div", "mismatch");
      box.appendChild(el("span", undefined, model.mismatch.text));
      desc.appendChild(box);
    }
    if (model.body) desc.appendChild(el("p", undefined, model.body));
    if (model.reasons.length > 0) {
      const sec = el("div", "reasons");
      sec.appendChild(el("h3", undefined, COPY.reasonsHeading));
      const ul = el("ul");
      for (const reason of model.reasons) ul.appendChild(el("li", undefined, reason));
      sec.appendChild(ul);
      desc.appendChild(sec);
    }
    body.appendChild(desc);

    const actions = el("div", "actions");
    const back = el("button", "primary", model.primaryLabel);
    back.type = "button";
    const proceedBtn = el("button", model.mode === "block" ? "linkbtn" : "secondary", model.secondaryLabel);
    proceedBtn.type = "button";
    actions.append(back, proceedBtn);
    body.appendChild(actions);

    const links = el("div", "links");
    if (model.fullReportUrl) {
      const a = el("a", "link", COPY.fullReport);
      a.href = model.fullReportUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      links.appendChild(a);
    }
    const reportBtn = el("button", "linkbtn", COPY.reportPage);
    reportBtn.type = "button";
    links.appendChild(reportBtn);
    if (model.appealUrl) {
      // Opens the owner appeal form in a new tab; it does not dismiss or release the action.
      const appeal = el("a", "link subtle", COPY.appealSite);
      appeal.href = model.appealUrl;
      appeal.target = "_blank";
      appeal.rel = "noopener noreferrer";
      links.appendChild(appeal);
    }
    body.appendChild(links);

    const status = el("p", "status");
    status.setAttribute("role", "status");
    body.appendChild(status);

    const foot = [model.coverageLine, model.decidedLine].filter(Boolean).join(" ");
    body.appendChild(el("p", "note", foot));

    panel.appendChild(body);
    scrim.appendChild(panel);
    r.appendChild(scrim);

    const finish = (choice: "proceed" | "back") => {
      document.removeEventListener("keydown", onKey, true);
      scrim.remove();
      previouslyFocused?.focus({ preventScroll: true });
      resolve(choice);
    };
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>("button, a[href]"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish("back");
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog while it holds the action.
        const list = focusables();
        if (list.length === 0) return;
        const active = r.activeElement;
        const idx = list.indexOf(active as HTMLElement);
        const next = e.shiftKey ? (idx <= 0 ? list.length - 1 : idx - 1) : idx === list.length - 1 ? 0 : idx + 1;
        e.preventDefault();
        list[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    back.addEventListener("click", () => finish("back"));
    let armed = false;
    proceedBtn.addEventListener("click", () => {
      if (model.secondaryConfirmLabel && !armed) {
        armed = true;
        proceedBtn.textContent = model.secondaryConfirmLabel;
        proceedBtn.classList.add("armed");
        proceedBtn.focus();
        return;
      }
      finish("proceed");
    });
    reportBtn.addEventListener("click", async () => {
      reportBtn.disabled = true;
      status.textContent = COPY.pair.working;
      status.textContent = await handlers.onReport();
    });

    back.focus({ preventScroll: true });
  });
}

/** ALLOW: small non-blocking toast; never takes focus. */
export function showToast(text: string, ms = 6000): void {
  const r = ensureRoot();
  clear(".toast");
  const t = el("div", "toast");
  t.setAttribute("role", "status");
  const ic = el("span");
  ic.style.setProperty("color", "var(--success)");
  ic.appendChild(icon("shield-check", 16));
  t.append(ic, el("span", undefined, text));
  r.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** WARN on page load: 44 px top-right banner, one line + Details + Dismiss (§5.4). Never takes focus. */
export function showWarnBanner(text: string, reasons: string[], onDismiss: () => void): void {
  const r = ensureRoot();
  clear(".banner");
  const b = el("div", "banner");
  b.setAttribute("role", "status");
  toneStyle(b, "WARN");
  b.appendChild(icon("shield-alert", 16));
  const msg = el("span", "msg", text);
  b.appendChild(msg);
  if (reasons.length > 1) {
    const details = el("button", "secondary", COPY.details);
    details.type = "button";
    details.addEventListener("click", () => {
      msg.textContent = reasons.join(" · ");
      details.remove();
    });
    b.appendChild(details);
  }
  const dismiss = el("button", "secondary", COPY.dismiss);
  dismiss.type = "button";
  dismiss.addEventListener("click", () => {
    b.remove();
    onDismiss();
  });
  b.appendChild(dismiss);
  r.appendChild(b);
}

/** Page guard, after "Go back" when there is no history: the page stays covered. */
export function showLeft(text: string): void {
  const r = ensureRoot();
  clear(".scrim");
  const scrim = el("div", "scrim guard");
  const panel = el("div", "panel");
  panel.setAttribute("role", "status");
  panel.appendChild(header("BLOCK", COPY.product));
  const body = el("div", "body");
  body.appendChild(el("p", undefined, text));
  panel.appendChild(body);
  scrim.appendChild(panel);
  r.appendChild(scrim);
}

/** Remove any page-guard shield (used when the check lets the page through). */
export function clearGuard(): void {
  clear(".scrim");
}
