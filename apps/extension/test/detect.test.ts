// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyForm,
  describeForm,
  detectClickAction,
  detectFormAction,
  payeeFromText,
  payeeFromUpiHref,
} from "../src/shared/detect";

// Mirrors the markup contract of apps/demo-sites (lookalike /pay and /register pages).
const LOOKALIKE = `
<main>
  <section id="login">
    <form id="login-form" method="post" action="https://collect.badhost.example/login">
      <input type="email" name="username" autocomplete="username" value="typed@example.com">
      <input type="password" name="password" autocomplete="current-password" value="hunter2">
      <button type="submit">Log in</button>
    </form>
  </section>
  <section id="payment">
    <p>Application fee ₹1,200. UPI ID: fees@okaxis</p>
    <p>Payee: <span data-payee="upi_vpa">fees@okaxis</span></p>
    <form id="pay-form" method="post" action="https://collect.badhost.example/pay">
      <button type="submit" class="pay">Pay ₹1,200</button>
    </form>
    <a id="upi" href="upi://pay?pa=fees@okaxis&pn=Northstar&am=1200">Open in UPI app</a>
  </section>
  <section id="newsletter">
    <form id="news" method="post" action="/subscribe"><input type="email" name="email"><button>Subscribe</button></form>
  </section>
  <p>Contact admissions@northstar-demo.example</p>
  <a id="paylink" href="https://pay.northstar-demo.example/">Pay fees</a>
</main>`;

beforeEach(() => {
  document.body.innerHTML = LOOKALIKE;
});

const form = (id: string) => document.getElementById(id) as HTMLFormElement;

describe("form classification", () => {
  it("password form → login, with absolute action and no values", () => {
    const f = form("login-form");
    expect(classifyForm(f)).toBe("login");
    const meta = describeForm(f);
    expect(meta).toEqual({
      action: "https://collect.badhost.example/login",
      method: "post",
      hasPassword: true,
      fieldTypes: ["email", "password"],
    });
    expect(JSON.stringify(meta)).not.toContain("hunter2");
    expect(JSON.stringify(meta)).not.toContain("typed@example.com");
  });

  it("pay form → payment with the page-displayed payee", () => {
    const f = form("pay-form");
    const submitter = f.querySelector("button")!;
    expect(detectFormAction(f, submitter)).toEqual({
      intent: "payment",
      destination: "https://collect.badhost.example/pay",
      payee: "fees@okaxis",
    });
  });

  it("login detection never carries a payee", () => {
    expect(detectFormAction(form("login-form"))?.payee).toBeNull();
  });

  it("non-sensitive forms are left alone", () => {
    expect(detectFormAction(form("news"))).toBeNull();
  });

  it("submitter formaction overrides the form action", () => {
    const f = form("pay-form");
    const b = f.querySelector("button")!;
    b.setAttribute("formaction", "https://other.example/checkout");
    expect(detectFormAction(f, b)?.destination).toBe("https://other.example/checkout");
  });
});

describe("click detection", () => {
  it("upi:// link → payment with the pa payee", () => {
    const hit = detectClickAction(document.getElementById("upi"));
    expect(hit?.action).toEqual({ intent: "payment", destination: null, payee: "fees@okaxis" });
  });

  it("submit buttons inside forms are left to the submit handler", () => {
    expect(detectClickAction(form("pay-form").querySelector("button"))).toBeNull();
  });

  it("a 'Pay' link outside a form is a payment trigger", () => {
    const hit = detectClickAction(document.getElementById("paylink"));
    expect(hit?.action.intent).toBe("payment");
    expect(hit?.action.destination).toBe("https://pay.northstar-demo.example/");
  });

  it("a same-site 'Pay' navigation link is not itself a payment", () => {
    document.body.innerHTML = `<nav><a id="nav" href="${new URL("/pay", document.baseURI).toString()}">Pay application fee</a></nav>`;
    expect(detectClickAction(document.getElementById("nav"))).toBeNull();
  });

  it("a 'Pay' button outside a form is a payment trigger", () => {
    document.body.innerHTML = `<section><p>UPI ID: fees@okaxis</p><button type="button" id="b">Pay now</button></section>`;
    expect(detectClickAction(document.getElementById("b"))?.action).toEqual({
      intent: "payment",
      destination: null,
      payee: "fees@okaxis",
    });
  });

  it("ordinary clicks are ignored", () => {
    expect(detectClickAction(document.querySelector("p"))).toBeNull();
  });
});

describe("payee extraction", () => {
  it("reads upi pa parameter", () => {
    expect(payeeFromUpiHref("upi://pay?pa=fees@okaxis&am=1")).toBe("fees@okaxis");
    expect(payeeFromUpiHref("https://x.example")).toBeNull();
  });
  it("finds UPI-looking handles but not e-mail addresses", () => {
    expect(payeeFromText("UPI ID: fees@okaxis")).toBe("fees@okaxis");
    expect(payeeFromText("Pay to fees@northstar-demo now")).toBe("fees@northstar-demo");
    expect(payeeFromText("Write to admissions@northstar-demo.example")).toBeNull();
  });
  it("hidden payee markup is ignored", () => {
    document.body.innerHTML = `<section><span data-payee="upi_vpa" hidden>decoy@okaxis</span><p>UPI ID: real@okicici</p><form action="/pay"><button>Pay</button></form></section>`;
    const f = document.querySelector("form")!;
    expect(detectFormAction(f)?.payee).toBe("real@okicici");
  });
});

describe("detectPageAction (page guard, §5.5)", () => {
  it("finds the payment on a lookalike page (payment beats login), with its payee and form action", async () => {
    const { detectPageAction } = await import("../src/shared/detect");
    document.body.innerHTML = LOOKALIKE;
    const a = detectPageAction(document);
    expect(a).toEqual({ intent: "payment", destination: "https://collect.badhost.example/pay", payee: "fees@okaxis" });
  });

  it("finds a login when there is no payment, and nothing on an ordinary page", async () => {
    const { detectPageAction } = await import("../src/shared/detect");
    document.body.innerHTML = `<form action="https://collect.badhost.example/login"><input type="password"><button>Sign in</button></form>`;
    expect(detectPageAction(document)?.intent).toBe("login");
    document.body.innerHTML = `<form action="/search"><input type="search" name="q"><button>Search</button></form><a href="/about">About</a>`;
    expect(detectPageAction(document)).toBeNull();
  });

  it("ignores hidden forms", async () => {
    const { detectPageAction } = await import("../src/shared/detect");
    document.body.innerHTML = `<div hidden><form action="https://x.example/login"><input type="password"></form></div>`;
    expect(detectPageAction(document)).toBeNull();
  });
});
