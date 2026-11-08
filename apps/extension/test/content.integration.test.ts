// @vitest-environment happy-dom
// Content-script round trip against the real demo-site markup, with chrome.runtime mocked.
// Not a browser test: happy-dom stands in for Chrome, and the service worker is mocked.
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

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function overlayText(): string {
  return shadowRoots.map((r) => r.textContent ?? "").join(" ");
}
function overlayButton(label: string | RegExp): HTMLButtonElement | undefined {
  return shadowRoots
    .flatMap((r) => Array.from(r.querySelectorAll("button")))
    .find((b) => (typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? "")));
}

beforeAll(async () => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(pageHtml)?.[1] ?? pageHtml;
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Stand-in for demo.js: the page's own (bubble-phase) submit handler.
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
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
        sent.push(msg);
        switch (msg.type) {
          case "GET_SETTINGS":
            return { ok: true, data: { enabled: true } };
          case "PAGE_READY":
            return { ok: true, data: { kind: "failure", failure: { code: "NOT_PAIRED" }, checkedAt: Date.now() } };
          case "ACTION_INTENT":
            return {
              ok: true,
              data: {
                kind: "assessment",
                assessment: (await import("../src/shared/assessment")).parseAssessment(liveBlock),
                checkedAt: Date.now(),
              },
            };
          default:
            return { ok: true, data: null };
        }
      }),
    },
  });
  await import("../src/content/content");
  await flush();
});

describe("content script on the lookalike /pay page", () => {
  it("intercepts the Pay click before the page's handler and shows the BLOCK overlay", async () => {
    const pay = document.querySelector<HTMLButtonElement>("button.pay")!;
    pay.click();
    await flush();

    expect(pageSubmits).toBe(0);
    const action = sent.find((m) => m.type === "ACTION_INTENT")!;
    expect(action).toMatchObject({
      intent: "payment",
      formAction: "https://collect.badhost.example/pay",
      payee: "fees@okaxis",
    });
    expect(Object.keys(action).sort()).toEqual(["formAction", "intent", "payee", "type", "url"]);

    const text = overlayText();
    expect(text).toContain("Payment stopped");
    expect(text).toContain("This page asks you to pay");
    expect(text).toContain("fees@okaxis");
    expect(text).toContain("Northstar University has registered");
    expect(text).toContain("fees@northstar-demo");
    expect(text).toMatch(/We checked 100% of signal groups\./);
    expect(text).toContain("Full report");

    // Low-emphasis owner appeal link: opens a new tab, does not release the action.
    const appeal = shadowRoots
      .flatMap((r) => Array.from(r.querySelectorAll<HTMLAnchorElement>("a")))
      .find((a) => a.textContent === "Is this your site? Appeal this decision");
    expect(appeal).toBeTruthy();
    expect(appeal!.href.startsWith("http://localhost:5173/appeal?domain=")).toBe(true);
    expect(appeal!.target).toBe("_blank");
    expect(appeal!.rel).toContain("noopener");
    expect(appeal!.className).toContain("subtle");
    expect(pageSubmits).toBe(0);
  });

  it("requires two clicks to proceed, then releases the original submit exactly once", async () => {
    const proceed = overlayButton("Proceed anyway")!;
    proceed.click();
    await flush();
    expect(pageSubmits).toBe(0);
    const confirm = overlayButton(/I understand the risk/)!;
    expect(confirm).toBeTruthy();
    confirm.click();
    await flush();
    expect(pageSubmits).toBe(1);
    expect(sent.some((m) => m.type === "RECORD_OVERRIDE" && m.taken === true)).toBe(true);
  });

  it("an unreachable worker yields 'Could not verify', and Go back keeps the action stopped", async () => {
    const sendMessage = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } })
      .chrome.runtime.sendMessage;
    sendMessage.mockImplementationOnce(async () => {
      throw new Error("Extension context invalidated");
    });
    const before = pageSubmits;
    document.querySelector<HTMLButtonElement>("button.pay")!.click();
    await flush();
    expect(overlayText()).toContain("Could not verify this page");
    overlayButton("Go back")!.click();
    await flush();
    expect(pageSubmits).toBe(before);
  });
});
