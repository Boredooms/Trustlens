// Content script: observes the page and enforces the server's decision on sensitive actions.
// It reads metadata only (form action, password-field presence, page-displayed payee) and never
// reads, stores or sends anything a user typed.
import { DEMO_SITES_ORIGIN } from "../shared/config";
import { COPY, DECISION_COPY, fill } from "../shared/copy";
import { hostOf, toReportedUrl } from "../shared/demo-url";
import { detectClickAction, detectFormAction, type DetectedAction } from "../shared/detect";
import { send } from "../shared/messages";
import { buildOverlayModel } from "../shared/overlay-model";
import type { CheckResult } from "../shared/types";
import { showChecking, showDecision, showToast, showWarnBanner } from "./overlay";

const MARK = "__trustlensContentLoaded";
type Marked = typeof globalThis & { [MARK]?: boolean };

function init(): void {
  /** Elements whose next submit/click has been released by the user (after an overlay decision). */
  const releasedOnce = new WeakSet<Element>();
  let busy = false;
  let enabled = true;

  async function handleAction(action: DetectedAction, proceed: () => void): Promise<void> {
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
    const result: CheckResult = reply.ok
      ? reply.data
      : { kind: "failure", failure: { code: "UNAVAILABLE" }, checkedAt: Date.now() };

    if (result.kind === "failure" && result.failure.code === "PAUSED") {
      busy = false;
      proceed();
      return;
    }

    // The host the API judged (demo path-mode URLs map back to the impersonated host).
    const pageHost = hostOf(toReportedUrl(location.href, DEMO_SITES_ORIGIN));
    const model = buildOverlayModel(result, action.intent, Date.now(), pageHost);
    if (model.mode === "proceed") {
      if (model.toast) showToast(model.toast);
      busy = false;
      proceed();
      return;
    }

    const choice = await showDecision(model, {
      onReport: async () => {
        const r = await send({
          type: "REPORT",
          url: location.href,
          intent: action.intent,
          observedPayee: model.observedPayee ?? undefined,
          scanId: model.scanId ?? undefined,
        });
        return r.ok ? COPY.reportSent : COPY.reportQueued;
      },
    });
    if (model.mode === "block") void send({ type: "RECORD_OVERRIDE", taken: choice === "proceed" });
    busy = false;
    if (choice === "proceed") proceed();
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

  // Page status (browse check). WARN shows the non-blocking banner, dismissible per domain per session.
  void (async () => {
    const settings = await send({ type: "GET_SETTINGS" });
    if (settings.ok && !settings.data.enabled) {
      enabled = false;
      return;
    }
    const status = await send({ type: "PAGE_READY", url: location.href });
    if (!status.ok || status.data.kind !== "assessment") return;
    const a = status.data.assessment;
    if (a.decision !== "WARN") return;
    const host = location.hostname;
    const dismissed = await send({ type: "IS_WARN_DISMISSED", host });
    if (dismissed.ok && dismissed.data) return;
    const reason = a.reasons[0] ?? COPY.warnNoReason;
    showWarnBanner(fill(DECISION_COPY.WARN.headline, { reason }), a.reasons.slice(0, 3), () => {
      void send({ type: "DISMISS_WARN", host });
    });
  })();
}

const g = globalThis as Marked;
if (!g[MARK]) {
  g[MARK] = true;
  init();
}
