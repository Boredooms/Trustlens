// Action-detection helpers (BROWSER_PROTECTION_LOGIC.md §5.1). Metadata only:
// these functions read element types, attributes and the text a page itself displays. They never
// read what a user typed — no `.value` access on any input (enforced by eslint for this file).

export type DetectedIntent = "login" | "payment";

export interface FormMetadata {
  /** Absolute action URL (empty action → the page itself). `null` if unparseable. */
  action: string | null;
  method: string;
  hasPassword: boolean;
  fieldTypes: string[];
}

export interface DetectedAction {
  intent: DetectedIntent;
  /** Absolute destination URL (form action or link href), before demo normalisation. */
  destination: string | null;
  /** Payee string displayed by the page (not user input), if any. */
  payee: string | null;
}

const PAY_WORDS_RE = /\b(pay|pay now|payment|checkout|check out|donate|upi)\b/i;
const PAY_PATH_RE = /(^|[/._-])(pay|payment|payments|checkout|donate)([/._-]|$)/i;
/** UPI-looking handle in visible text; excludes e-mail addresses (handle@domain.tld). */
const VPA_TEXT_RE = /(?<![\w.-])([a-z0-9][\w.-]{1,63}@[a-z][a-z-]{1,31})(?![\w-]|\.[a-z])/gi;
const MAX_PAYEE_LEN = 128;

function isHidden(el: Element): boolean {
  return Boolean(el.closest("[hidden], [aria-hidden='true']"));
}

function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Visible label of a clickable element: text content, `aria-label`, or a submit input's label attribute. */
export function labelOf(el: Element): string {
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    // For submit/button inputs the `value` attribute is the button's printed label, not user data.
    return t === "submit" || t === "button" ? cleanText(el.getAttribute("value")) : "";
  }
  return cleanText(el.getAttribute("aria-label")) || cleanText(el.textContent);
}

export function resolveUrl(raw: string | null, base: string): string | null {
  try {
    return new URL(raw ?? "", base).toString();
  } catch {
    return null;
  }
}

export function describeForm(form: HTMLFormElement): FormMetadata {
  const base = form.ownerDocument.baseURI;
  return {
    action: resolveUrl(form.getAttribute("action"), base),
    method: (form.getAttribute("method") ?? "get").toLowerCase(),
    hasPassword: Boolean(form.querySelector('input[type="password"]')),
    fieldTypes: Array.from(form.querySelectorAll("input"), (i) => i.type),
  };
}

/** `pa` parameter of a `upi://pay?...` link. */
export function payeeFromUpiHref(href: string | null): string | null {
  if (!href || !/^upi:/i.test(href)) return null;
  const q = href.indexOf("?");
  if (q === -1) return null;
  const pa = new URLSearchParams(href.slice(q + 1)).get("pa");
  return pa ? cleanText(pa).slice(0, MAX_PAYEE_LEN) || null : null;
}

/** First UPI-looking handle in a text, or `null`. */
export function payeeFromText(text: string): string | null {
  VPA_TEXT_RE.lastIndex = 0;
  const m = VPA_TEXT_RE.exec(text);
  return m?.[1] ?? null;
}

function payeeWithin(scope: ParentNode, allowText: boolean): string | null {
  for (const el of Array.from(scope.querySelectorAll("[data-payee]"))) {
    if (isHidden(el)) continue;
    const text = cleanText(el.textContent);
    if (text && text.length <= MAX_PAYEE_LEN) return text;
  }
  for (const a of Array.from(scope.querySelectorAll('a[href^="upi:" i]'))) {
    const pa = payeeFromUpiHref(a.getAttribute("href"));
    if (pa) return pa;
  }
  if (allowText && scope instanceof Element) {
    const text = visibleText(scope);
    if (PAY_WORDS_RE.test(text)) return payeeFromText(text);
  }
  return null;
}

/** Text the page displays inside `scope`, skipping hidden subtrees, scripts and styles. */
export function visibleText(scope: Element, maxChars = 20_000): string {
  const doc = scope.ownerDocument;
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let total = 0;
  for (let n = walker.nextNode(); n && total < maxChars; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || isHidden(parent) || parent.closest("script, style, noscript, template")) continue;
    const t = n.textContent ?? "";
    parts.push(t);
    total += t.length;
  }
  return cleanText(parts.join(" "));
}

/**
 * Payee displayed near a trigger: the trigger's form, then its enclosing section, then (markup
 * only, no free-text scan) the whole document.
 */
export function findPayee(trigger: Element): string | null {
  const form = trigger.closest("form");
  if (form) {
    const p = payeeWithin(form, true);
    if (p) return p;
  }
  const section = trigger.closest("section, article, [role='main'], main, fieldset");
  if (section) {
    const p = payeeWithin(section, true);
    if (p) return p;
  }
  return payeeWithin(trigger.ownerDocument, false);
}

/** Classify a form submission as a sensitive action. `null` = not sensitive, let it through. */
export function classifyForm(form: HTMLFormElement, submitter?: Element | null): DetectedIntent | null {
  const meta = describeForm(form);
  if (meta.hasPassword) return "login";
  if (form.querySelector("[data-payee]") || form.querySelector('a[href^="upi:" i]')) return "payment";
  const buttons = submitter
    ? [submitter]
    : Array.from(form.querySelectorAll('button:not([type]), button[type="submit"], input[type="submit"]'));
  if (buttons.some((b) => PAY_WORDS_RE.test(labelOf(b)))) return "payment";
  if (meta.action) {
    try {
      if (PAY_PATH_RE.test(new URL(meta.action).pathname)) return "payment";
    } catch {
      /* unparseable action: not classified */
    }
  }
  return null;
}

export function detectFormAction(form: HTMLFormElement, submitter?: Element | null): DetectedAction | null {
  const intent = classifyForm(form, submitter);
  if (!intent) return null;
  // A submitter's `formaction` overrides the form's action.
  const override = submitter?.getAttribute("formaction");
  const destination = override
    ? resolveUrl(override, form.ownerDocument.baseURI)
    : describeForm(form).action;
  return { intent, destination, payee: intent === "payment" ? findPayee(submitter ?? form) : null };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

const CLICKABLE ="a[href], button, [role='button'], input[type='submit'], input[type='button']";

/**
 * Detect a payment trigger from a click. Submit buttons inside forms are left to the `submit`
 * handler (so the form's own action is used); this covers `upi://` links and pay links/buttons
 * outside forms.
 */
export function detectClickAction(target: EventTarget | null): { element: Element; action: DetectedAction } | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(CLICKABLE);
  if (!el) return null;
  const inForm = el.closest("form");
  const isSubmit =
    (el instanceof HTMLButtonElement && (el.type === "submit" || !el.getAttribute("type"))) ||
    (el instanceof HTMLInputElement && el.type === "submit");
  if (inForm && isSubmit) return null;

  const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") : null;
  const upiPayee = payeeFromUpiHref(href);
  if (upiPayee) {
    return { element: el, action: { intent: "payment", destination: null, payee: upiPayee } };
  }
  if (!PAY_WORDS_RE.test(labelOf(el))) return null;
  const destination = href ? resolveUrl(href, el.ownerDocument.baseURI) : null;
  if (destination && !/^https?:/i.test(destination)) return null;
  // A same-site navigation link ("Pay application fee" → /pay) is not the payment itself; the
  // payment form on the next page is checked when it is submitted.
  if (destination && sameOrigin(destination, el.ownerDocument.baseURI)) return null;
  return { element: el, action: { intent: "payment", destination, payee: findPayee(el) } };
}
