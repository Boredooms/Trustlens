import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_HOSTS, FOOTER_TEXT, buildLink, resolveRoute, startServer } from "../server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server;
let port;

before(async () => {
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Raw request so we control the Host header and the un-normalised path. */
function request({ method = "GET", path: reqPath = "/", host, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: reqPath, agent: false, headers: { Host: host ?? `127.0.0.1:${port}` } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listHtmlFiles() {
  const out = [];
  for (const host of await readdir(path.join(ROOT, "sites"))) {
    for (const f of await readdir(path.join(ROOT, "sites", host))) {
      if (f.endsWith(".html")) out.push({ host, page: f.replace(/\.html$/, ""), file: path.join(ROOT, "sites", host, f) });
    }
  }
  return out;
}

test("Host-header routing serves the admissions lookalike with a machine-readable payee", async () => {
  const res = await request({ path: "/pay", host: `apply.northstar-admissions.example:${port}` });
  assert.equal(res.status, 200);
  assert.match(res.body, /<span data-payee="upi_vpa">fees@okaxis<\/span>/);
  assert.match(res.body, /action="https:\/\/collect\.badhost\.example\/pay"/);
  assert.match(res.body, /Pay ₹1,200/);
  // Host mode links keep the port.
  assert.ok(res.body.includes(`http://apply.northstar-admissions.example:${port}/register`));
});

test("Path-mode routing serves the same page and rewrites links under /site/<host>/", async () => {
  const res = await request({ path: "/site/apply.northstar-admissions.example/pay" });
  assert.equal(res.status, 200);
  assert.match(res.body, /data-payee="upi_vpa"/);
  assert.match(res.body, /fees@okaxis/);
  assert.ok(res.body.includes('href="/site/apply.northstar-admissions.example/register"'));
  assert.ok(!res.body.includes("{{link:"), "no unreplaced placeholders");
});

test("Admissions landing has the fee, a password form to the credential sink and the payment form", async () => {
  const res = await request({ path: "/site/apply.northstar-admissions.example/" });
  assert.equal(res.status, 200);
  assert.match(res.body, /Application fee ₹1,200/);
  assert.match(res.body, /action="https:\/\/collect\.badhost\.example\/login"/);
  assert.match(res.body, /type="password"/);
  assert.match(res.body, /data-payee="upi_vpa">fees@okaxis</);
});

test("Genuine sites carry the genuine form action and payee", async () => {
  const login = await request({ path: "/", host: "login.northstar-demo.example" });
  assert.match(login.body, /action="https:\/\/login\.northstar-demo\.example\/session"/);
  const pay = await request({ path: "/site/pay.northstar-demo.example/" });
  assert.match(pay.body, /<span data-payee="upi_vpa">fees@northstar-demo<\/span>/);
  const home = await request({ path: "/", host: "northstar-demo.example" });
  assert.ok(home.body.includes('href="http://pay.northstar-demo.example/"'), "port 80 omitted in host mode");
});

test("Unknown host at / lists all six demo hosts in both modes", async () => {
  const res = await request({ path: "/" });
  assert.equal(res.status, 200);
  assert.equal(Object.keys(DEMO_HOSTS).length, 6);
  for (const host of Object.keys(DEMO_HOSTS)) {
    assert.ok(res.body.includes(`/site/${host}/`), `path-mode link for ${host}`);
    assert.ok(res.body.includes(`http://${host}:${port}/`), `host-mode link for ${host}`);
  }
});

test("Unknown page on a known host is 404", async () => {
  const res = await request({ path: "/site/northstar-demo.example/nope" });
  assert.equal(res.status, 404);
});

test("Non-GET methods are refused with 405", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await request({ method, path: "/site/apply.northstar-admissions.example/pay", body: "password=hunter2" });
    assert.equal(res.status, 405);
    assert.ok(!res.body.includes("hunter2"));
  }
});

test("Path traversal does not leak files", async () => {
  for (const p of [
    "/site/../../package.json",
    "/site/apply.northstar-admissions.example/../../package.json",
    "/site/apply.northstar-admissions.example/..%2f..%2fpackage.json",
    "/site/apply.northstar-admissions.example/%2e%2e/%2e%2e/server.mjs",
    "/static/../server.mjs",
    "/site/..%2f..%2fpackage.json/x",
  ]) {
    const res = await request({ path: p });
    assert.ok(!res.body.includes("@trustlens/demo-sites"), `leaked package.json via ${p}`);
    assert.ok(!res.body.includes("createDemoServer"), `leaked server.mjs via ${p}`);
  }
});

test("Security headers: CSP with form-action 'none', nosniff, no-referrer", async () => {
  const res = await request({ path: "/site/apply.northstar-admissions.example/pay" });
  const csp = res.headers["content-security-policy"];
  assert.ok(csp.includes("form-action 'none'"));
  assert.ok(csp.includes("script-src 'self'"));
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
});

test("Static assets are served", async () => {
  const js = await request({ path: "/static/demo.js" });
  assert.equal(js.status, 200);
  assert.match(js.headers["content-type"], /javascript/);
  assert.match(js.body, /Demonstration only — nothing was sent/);
  assert.match(js.body, /preventDefault/);
  const css = await request({ path: "/static/demo.css" });
  assert.equal(css.status, 200);
});

test("demo.js never reads field values, logs, stores or makes requests", async () => {
  const src = await readFile(path.join(ROOT, "static", "demo.js"), "utf8");
  for (const forbidden of [/\.value\b/, /console\./, /localStorage/, /sessionStorage/, /fetch\(/, /XMLHttpRequest/, /FormData/, /document\.cookie/]) {
    assert.ok(!forbidden.test(src), `demo.js must not contain ${forbidden}`);
  }
});

test("Every page renders with the demonstration footer in both modes", async () => {
  const files = await listHtmlFiles();
  assert.ok(files.length >= 9);
  for (const { host, page } of files) {
    const p = page === "index" ? "/" : `/${page}`;
    const viaPath = await request({ path: `/site/${host}${p}` });
    assert.equal(viaPath.status, 200, `${host}${p} (path mode)`);
    assert.ok(viaPath.body.includes(FOOTER_TEXT), `footer on ${host}${p}`);
    const viaHost = await request({ path: p, host: `${host}:${port}` });
    assert.equal(viaHost.status, 200, `${host}${p} (host mode)`);
    assert.ok(viaHost.body.includes(FOOTER_TEXT));
  }
  const index = await request({ path: "/" });
  assert.ok(index.body.includes(FOOTER_TEXT));
});

test("No inline handlers, inline scripts, inline styles or external resources in any page", async () => {
  for (const { file } of await listHtmlFiles()) {
    const html = await readFile(file, "utf8");
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `inline handler in ${file}`);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `inline <script> in ${file}`);
    assert.ok(!/\sstyle\s*=/i.test(html), `inline style in ${file}`);
    assert.ok(!/<style[\s>]/i.test(html), `<style> block in ${file}`);
    assert.ok(!/(src|href)="(https?:)?\/\//i.test(html), `external resource in ${file}`);
    assert.ok(!/javascript:/i.test(html), `javascript: URL in ${file}`);
  }
});

test("Login forms follow the markup contract; payee is never an input", async () => {
  for (const { file } of await listHtmlFiles()) {
    const html = await readFile(file, "utf8");
    if (html.includes('type="password"')) {
      assert.match(html, /<input type="(email|text)" name="username" autocomplete="username">/);
      assert.match(html, /<input type="password" name="password" autocomplete="current-password">/);
    }
    assert.ok(!/<input[^>]*name="(vpa|upi_id|payee)"/i.test(html), `payee input in ${file}`);
  }
});

test("resolveRoute and buildLink unit behaviour", () => {
  assert.deepEqual(resolveRoute("apply.northstar-admissions.example:8081", "/pay"), {
    type: "page", host: "apply.northstar-admissions.example", page: "pay", mode: "host",
  });
  assert.deepEqual(resolveRoute("localhost:8081", "/site/apply.northstar-admissions.example/pay/"), {
    type: "page", host: "apply.northstar-admissions.example", page: "pay", mode: "path",
  });
  assert.equal(resolveRoute("localhost:8081", "/").type, "index");
  assert.equal(resolveRoute("localhost:8081", "/site/evil.example/").type, "notfound");
  assert.equal(buildLink("pay.northstar-demo.example", "/", "host", "80"), "http://pay.northstar-demo.example/");
  assert.equal(buildLink("pay.northstar-demo.example", "/", "host", "8081"), "http://pay.northstar-demo.example:8081/");
  assert.equal(buildLink("pay.northstar-demo.example", "/x", "path", "8081"), "/site/pay.northstar-demo.example/x");
});
