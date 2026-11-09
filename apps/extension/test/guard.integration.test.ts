// @vitest-environment happy-dom
// Page guard (BROWSER_PROTECTION_LOGIC.md §5.5) against the real lookalike /pay markup, with the
// service worker mocked: the page is held on load (before any click), the server is asked with the
// page's own payee and form action, BLOCK keeps it covered, and an override is scoped and remembered.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageHtml = readFileSync(
  resolve(here, "../../demo-sites/sites/apply.northstar-admissions.example/pay.html"),
  "utf8",
);
const liveBlock = JSON.parse(readFileSync(resolve(here, "fixtures/live-assess-payment-block.json"), "utf8"));

const shadowRoots: ShadowRoot[] = [];
const sent: Record<string, unknown>[] = [];
let pageSubmits = 0;
let resolveAction: (() => void) | null = null;

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const overlayText = () => shadowRoots.map((r) => r.textContent ?? "").join(" ");
const overlayButton = (label: string | RegExp) =>
  shadowRoots
    .flatMap((r) => Array.from(r.querySelectorAll("button")))
    .find((b) => (typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? "")));
const scrims = () => shadowRoots.flatMap((r) => Array.from(r.querySelectorAll(".scrim")));

beforeAll(async () => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(pageHtml)?.[1] ?? pageHtml;
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  document.querySelectorAll("form").forEach((f) =>
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      pageSubmits += 1;
    }),
  );
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = original.call(this, { ...init, mode: "open" });
    shadowRoots.push(root);
    return root;
  };
  const { parseAssessment } = await import("../src/shared/assessment");
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
        sent.push(msg);
        switch (msg.type) {
          case "GET_SETTINGS":
            return { ok: true, data: { enabled: true } };
          case "FLAGGED_HOSTS":
            return { ok: true, data: {} };
          case "GET_PAGE_OVERRIDE":
            return { ok: true, data: null };
          case "PAGE_READY":
            // A plain browse check of a lookalike: identity signals only.
            return { ok: true, data: { kind: "failure", failure: { code: "TIMEOUT" }, checkedAt: Date.now() } };
          case "ACTION_INTENT":
            // Hold the answer until the test has seen the "checking" shield.
            await new Promise<void>((r) => (resolveAction = r));
            return { ok: true, data: { kind: "assessment", assessment: parseAssessment(liveBlock), checkedAt: Date.now() } };
          default:
            return { ok: true, data: null };
        }
      }),
    },
  });
  await import("../src/content/content");
  await flush();
});

describe("page guard on the lookalike /pay page", () => {
  it("covers the page on load, before any click, while the server is asked", () => {
    expect(overlayText()).toContain("Checking this payment page before you use it…");
    expect(scrims().some((s) => s.classList.contains("guard"))).toBe(true);
    const action = sent.find((m) => m.type === "ACTION_INTENT")!;
    expect(action).toMatchObject({
      intent: "payment",
      formAction: "https://collect.badhost.example/pay",
      payee: "fees@okaxis",
    });
    // Metadata only: no field values, no page HTML.
    expect(Object.keys(action).sort()).toEqual(["formAction", "intent", "payee", "type", "url"]);
    expect(pageSubmits).toBe(0);
  });

  it("keeps the page covered with the BLOCK interstitial and the payee mismatch", async () => {
    resolveAction?.();
    await flush();
    const text = overlayText();
    expect(text).toContain("TrustLens blocked this payment page");
    expect(text).toContain("fees@okaxis");
    expect(text).toContain("fees@northstar-demo");
    expect(scrims().some((s) => s.classList.contains("guard"))).toBe(true);
    // A failed browse check never replaces or removes the guard's decision.
    expect(text).not.toContain("Could not verify");
  });

  it("needs two clicks to proceed, remembers the override for this host only, and does not ask twice", async () => {
    overlayButton("Proceed anyway")!.click();
    await flush();
    expect(sent.some((m) => m.type === "SET_PAGE_OVERRIDE")).toBe(false);
    overlayButton(/I understand the risk/)!.click();
    await flush();
    const ov = sent.find((m) => m.type === "SET_PAGE_OVERRIDE")!;
    expect(ov).toMatchObject({ decision: "BLOCK" });
    expect(sent.some((m) => m.type === "RECORD_OVERRIDE" && m.taken === true)).toBe(true);
    expect(scrims()).toHaveLength(0);

    // The same payment, already released at the guard: the submit goes through without a second hold.
    const asked = sent.filter((m) => m.type === "ACTION_INTENT").length;
    document.querySelector<HTMLButtonElement>("button.pay")!.click();
    await flush();
    expect(pageSubmits).toBe(1);
    expect(sent.filter((m) => m.type === "ACTION_INTENT").length).toBe(asked);
  });
});
