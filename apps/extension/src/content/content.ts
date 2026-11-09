// Content script: observes the page and enforces the server's decision.
//   - Actions (§5.2): a login/payment submit or pay click is held until the server decides.
//   - Page guard (§5.5): a page that asks for a password or a payment is covered before it can be
//     used, and the server is asked with that page's own form destination and payee up front.
//   - Page verdict: a BLOCK/WARN for the page itself covers it (two clicks past BLOCK, one past WARN).
//   - Links: a click to a host the server flagged BLOCK/WARN in the last 10 minutes is stopped
//     before navigating; an unknown destination is guarded when it loads.
// It reads metadata only (form action, password-field presence, page-displayed payee) and never
// reads, stores or sends anything a user typed. The decision is always the server's.
import { DEMO_SITES_ORIGIN } from "../shared/config";
import { COPY } from "../shared/copy";
import { hostOf, toReportedUrl } from "../shared/demo-url";
import { detectClickAction, detectFormAction, detectPageAction, type DetectedAction } from "../shared/detect";
import { send } from "../shared/messages";
import { buildLinkModel, buildOverlayModel, type OverlayModel } from "../shared/overlay-model";
import type { CheckResult } from "../shared/types";
import { showChecking, showDecision, showLeft, showToast } from "./overlay";

const MARK = "__trustlensContentLoaded";
type Marked = typeof globalThis & { [MARK]?: boolean };

/** Failures that mean "not a check the user needs to decide on" (paused, local page, TrustLens itself, not paired). */
const SILENT_FAILURES = new Set(["PAUSED", "LOCAL_PAGE", "OWN_SITE", "NOT_PAIRED", "RECONNECT"]);
/** How long the page guard keeps looking for a login/payment form a script renders after load. */
const LATE_FORM_WINDOW_MS = 8_000;

function init(): void {
  /** Elements whose next submit/click has been released by the user (after an overlay decision). */
  const releasedOnce = new WeakSet<Element>();
  /** Actions the user already released at the page guard: their submit is not asked about twice. */
  const releasedActions = new Set<string>();
  let busy = false;
  let enabled = true;
  /** Page-level hold: idle → holding (a guard or verdict overlay is up) → decided. */
  let gate: "idle" | "holding" | "decided" = "idle";
  let flagged: Record<string, "BLOCK" | "WARN"> = {};

  // The host the API judged (demo path-mode URLs map back to the impersonated host).
  const pageHost = hostOf(toReportedUrl(location.href, DEMO_SITES_ORIGIN));
  const actionKey = (a: DetectedAction) => [a.intent, a.destination ?? "", a.payee ?? ""].join("|");
  const failed = (): CheckResult => ({ kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: Date.now() });

  const refreshFlags = () =>
    void send({ type: "FLAGGED_HOSTS" }).then((r) => {
      if (r.ok) flagged = r.data;
    });

  function reportHandler(model: OverlayModel, url: string, intent?: DetectedAction["intent"]) {
    return async () => {
      const r = await send({
        type: "REPORT",
        url,
        intent,
        observedPayee: model.observedPayee ?? undefined,
        scanId: model.scanId ?? undefined,
      });
      return r.ok ? COPY.reportSent : COPY.reportQueued;
    };
  }

  /** "Go back" from a held page: previous page if there is one, otherwise keep it covered. */
  function leavePage(): void {
    const before = location.href;
    if (history.length > 1) history.back();
    // No history (new tab) or the back navigation did not happen: the page stays covered.
    setTimeout(() => {
      if (location.href === before) showLeft(COPY.page.leaveBody);
    }, 400);
  }

  async function handleAction(action: DetectedAction, proceed: () => void): Promise<void> {
    // Already released at the page guard (same action, same page): do not ask twice.
    if (releasedActions.has(actionKey(action))) {
      proceed();
      return;
    }
    busy = true;
    let cancelled = false;
    const closeChecking = showChecking(action.intent, () => {
      cancelled = true;
      closeChecking();
      busy = false;
    });

    const reply = await send({
      type: "ACTION_INTENT",
      url: location.href,
      intent: action.intent,
      formAction: action.destination ?? undefined,
      payee: action.payee ?? undefined,
    });
    if (cancelled) return;
    closeChecking();

    // Extension unreachable is a failed check, never a pass.
    const result: CheckResult = reply.ok ? reply.data : failed();

    // Paused, local/private address, or TrustLens itself: not a check the user needs to decide on.
    if (result.kind === "failure" && (result.failure.code === "PAUSED" || result.failure.code === "LOCAL_PAGE" || result.failure.code === "OWN_SITE")) {
      busy = false;
      proceed();
      return;
    }

    const model = buildOverlayModel(result, action.intent, Date.now(), pageHost);
    refreshFlags();
    if (model.mode === "proceed") {
      if (model.toast) showToast(model.toast);
      busy = false;
      proceed();
      return;
    }

    const choice = await showDecision(model, { onReport: reportHandler(model, location.href, action.intent) });
    if (model.mode === "block") void send({ type: "RECORD_OVERRIDE", taken: choice === "proceed" });
    busy = false;
    if (choice === "proceed") proceed();
  }

  /** Page guard (§5.5): hold a login/payment page and ask the server about its own action first. */
  async function guardPage(action: DetectedAction): Promise<void> {
    if (gate !== "idle" || !enabled) return;
    gate = "holding";
    const override = pageHost ? await send({ type: "GET_PAGE_OVERRIDE", host: pageHost }) : null;
    if (override?.ok && override.data === "BLOCK") {
      gate = "decided"; // the user already proceeded past a block on this site; submits are still checked
      return;
    }

    let cancelled = false;
    const close = showChecking(
      action.intent,
      () => {
        cancelled = true;
        close();
        leavePage();
      },
      { guard: true, title: COPY.page.checking[action.intent], note: COPY.page.held },
    );
    const reply = await send({
      type: "ACTION_INTENT",
      url: location.href,
      intent: action.intent,
      formAction: action.destination ?? undefined,
      payee: action.payee ?? undefined,
    });
    if (cancelled) return;
    close();
    refreshFlags();

    const result: CheckResult = reply.ok ? reply.data : failed();
    if (result.kind === "failure") {
      gate = "decided";
      // Fail open with disclosure (§6): the page is usable; its submit is still checked.
      if (!SILENT_FAILURES.has(result.failure.code)) showToast(COPY.page.notChecked, 8000);
      return;
    }
    const model = buildOverlayModel(result, action.intent, Date.now(), pageHost, "page");
    if (model.mode === "proceed" || (model.mode === "confirm" && override?.ok && override.data === "WARN")) {
      if (model.toast) showToast(model.toast);
      releasedActions.add(actionKey(action));
      gate = "decided";
      return;
    }
    const choice = await showDecision(model, { onReport: reportHandler(model, location.href, action.intent) }, { guard: true });
    if (model.mode === "block") void send({ type: "RECORD_OVERRIDE", taken: choice === "proceed" });
    gate = "decided";
    if (choice === "back") {
      leavePage();
      return;
    }
    releasedActions.add(actionKey(action));
    if (pageHost && (model.mode === "block" || model.mode === "confirm")) {
      void send({ type: "SET_PAGE_OVERRIDE", host: pageHost, decision: model.mode === "block" ? "BLOCK" : "WARN" });
    }
  }

  /** Page-load verdict: a BLOCK/WARN for the page itself covers it, unless the guard already decided. */
  async function enforcePageVerdict(result: CheckResult): Promise<void> {
    if (result.kind !== "assessment" || gate !== "idle") return;
    const d = result.assessment.decision;
    if (d !== "BLOCK" && d !== "WARN") return;
    gate = "holding";
    if (pageHost) {
      const ov = await send({ type: "GET_PAGE_OVERRIDE", host: pageHost });
      if (ov.ok && (ov.data === "BLOCK" || (ov.data === "WARN" && d === "WARN"))) {
        gate = "decided";
        return;
      }
    }
    const model = buildOverlayModel(result, "browse", Date.now(), pageHost, "page");
    const choice = await showDecision(model, { onReport: reportHandler(model, location.href) }, { guard: true });
    if (d === "BLOCK") void send({ type: "RECORD_OVERRIDE", taken: choice === "proceed" });
    gate = "decided";
    if (choice === "back") {
      leavePage();
      return;
    }
    if (pageHost) void send({ type: "SET_PAGE_OVERRIDE", host: pageHost, decision: d });
  }

  // Capture phase on window: runs before page handlers (BROWSER_PROTECTION_LOGIC.md §5.2).
  window.addEventListener(
    "submit",
    (e: SubmitEvent) => {
      if (!enabled) return;
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (releasedOnce.has(form)) {
        releasedOnce.delete(form);
        return;
      }
      const action = detectFormAction(form, e.submitter);
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (busy) return;
      const submitter = e.submitter;
      void handleAction(action, () => {
        releasedOnce.add(form);
        if (submitter instanceof HTMLElement && submitter.isConnected && form.contains(submitter)) {
          form.requestSubmit(submitter as HTMLButtonElement);
        } else {
          form.requestSubmit();
        }
      });
    },
    true,
  );

  window.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (!enabled || e.button !== 0) return;
      const hit = detectClickAction(e.target);
      if (!hit) return;
      if (releasedOnce.has(hit.element)) {
        releasedOnce.delete(hit.element);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (busy) return;
      void handleAction(hit.action, () => {
        releasedOnce.add(hit.element);
        (hit.element as HTMLElement).click();
      });
    },
    true,
  );

  // Link pre-check: stop navigation to a host the server flagged in the last 10 minutes.
  window.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (!enabled || e.button !== 0 || e.defaultPrevented) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      let dest: URL;
      try {
        dest = new URL(a.href);
      } catch {
        return;
      }
      if (dest.protocol !== "https:" && dest.protocol !== "http:") return;
      const destHost = hostOf(toReportedUrl(dest.href, DEMO_SITES_ORIGIN));
      if (!destHost || destHost === pageHost) return;
      const decision = flagged[destHost];
      if (!decision) return;
      if (releasedOnce.has(a)) {
        releasedOnce.delete(a);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (busy) return;
      busy = true;
      void (async () => {
        const model = buildLinkModel(decision, destHost);
        const choice = await showDecision(model, { onReport: reportHandler(model, dest.href) });
        if (decision === "BLOCK") void send({ type: "RECORD_OVERRIDE", taken: choice === "proceed" });
        busy = false;
        if (choice !== "proceed") return;
        // Navigate the way the link would have (same tab, or a new one for target=_blank).
        if (a.target === "_blank") window.open(dest.href, "_blank", "noopener,noreferrer");
        else location.assign(dest.href);
      })();
    },
    true,
  );

  // Page guard: look for the page's own login/payment form once the DOM exists, and for a while
  // after (single-page apps render forms late).
  const lookForAction = (): boolean => {
    if (gate !== "idle") return true;
    const action = detectPageAction(document);
    if (!action) return false;
    void guardPage(action);
    return true;
  };
  const onReady = () => {
    if (lookForAction()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (lookForAction()) observer.disconnect();
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), LATE_FORM_WINDOW_MS);
  };

  void (async () => {
    const settings = await send({ type: "GET_SETTINGS" });
    if (settings.ok && !settings.data.enabled) {
      enabled = false;
      return;
    }
    refreshFlags();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady, { once: true });
    else onReady();
    // Page status (browse check). A fresh cached verdict answers before the page renders.
    const status = await send({ type: "PAGE_READY", url: location.href });
    refreshFlags();
    if (status.ok) await enforcePageVerdict(status.data);
  })();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshFlags();
  });
}

const g = globalThis as Marked;
if (!g[MARK]) {
  g[MARK] = true;
  init();
}
