// TrustLens demo sites — zero-dependency, inert static server.
//
// Serves the seeded genuine Northstar University sites and the lookalikes from DEMO_RUNBOOK §3.
// Two routing modes:
//   1. Host header   — http://apply.northstar-admissions.example:8081/pay (needs a hosts-file entry)
//   2. Path prefix   — http://localhost:8081/site/apply.northstar-admissions.example/pay
//
// Safety properties:
//   - Only GET/HEAD. Request bodies are never read, logged or stored (non-GET → 405, body ignored).
//   - CSP `form-action 'none'` plus static/demo.js preventDefault() keep every form inert.
//   - Pages are resolved from an allowlist of hosts and a strict page-name pattern (no traversal).
//   - No external resources: no CDNs, fonts or remote images.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(ROOT, "sites");
const STATIC_DIR = path.join(ROOT, "static");

/** Canonical demo hosts (DEMO_RUNBOOK §3). Order is the index display order. */
export const DEMO_HOSTS = Object.freeze({
  "northstar-demo.example": { kind: "genuine", label: "Northstar University — official home" },
  "login.northstar-demo.example": { kind: "genuine", label: "Northstar University — official login" },
  "pay.northstar-demo.example": { kind: "genuine", label: "Northstar University — official fee payment (fees@northstar-demo)" },
  "apply.northstar-admissions.example": { kind: "lookalike", label: "Lookalike 1 — admissions + payment (fees@okaxis)", paths: ["/", "/register", "/pay"] },
  "apply.northstar-scholarships.example": { kind: "lookalike", label: "Lookalike 2 — scholarship lure (fees@okaxis)", paths: ["/", "/pay"] },
  "portal.northstar-placement.example": { kind: "lookalike", label: "Lookalike 3 — placement lure (credential sink)" },
});

export const FOOTER_TEXT = "Demonstration site — do not enter real information.";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const STATIC_FILES = Object.freeze({
  "/static/demo.js": { file: "demo.js", type: "text/javascript; charset=utf-8" },
  "/static/demo.css": { file: "demo.css", type: "text/css; charset=utf-8" },
});

const PAGE_NAME = /^[a-z0-9-]{1,40}$/;
const LINK_PLACEHOLDER = /\{\{link:([a-z0-9.-]+):(\/[^}]*)\}\}/g;

function baseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  };
}

function send(req, res, status, contentType, body, extra = {}) {
  res.writeHead(status, { ...baseHeaders(contentType), ...extra });
  res.end(req.method === "HEAD" ? undefined : body);
}

/** Split a Host header into hostname (lowercase, no port) and port string. */
export function parseHostHeader(hostHeader) {
  const raw = String(hostHeader ?? "").trim().toLowerCase();
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return { hostname: "", port: "" };
  return { hostname: m[1], port: m[2] ?? "" };
}

/**
 * Resolve a request into a route.
 * @returns {{type:"static", key:string} | {type:"page", host:string, page:string, mode:"host"|"path"} |
 *           {type:"index"} | {type:"notfound", host?:string, mode?:"host"|"path"}}
 */
export function resolveRoute(hostHeader, rawUrl) {
  let pathname;
  try {
    pathname = new URL(rawUrl ?? "/", "http://demo.invalid").pathname;
  } catch {
    return { type: "notfound" };
  }
  if (Object.hasOwn(STATIC_FILES, pathname)) return { type: "static", key: pathname };

  let host;
  let rest;
  let mode;
  const siteMatch = /^\/site\/([^/]+)(\/.*)?$/.exec(pathname);
  if (siteMatch) {
    host = decodeURIComponentSafe(siteMatch[1]).toLowerCase();
    rest = siteMatch[2] ?? "/";
    mode = "path";
    if (!Object.hasOwn(DEMO_HOSTS, host)) return { type: "notfound" };
  } else {
    const { hostname } = parseHostHeader(hostHeader);
    if (!Object.hasOwn(DEMO_HOSTS, hostname)) {
      return pathname === "/" || pathname === "/index.html" ? { type: "index" } : { type: "notfound" };
    }
    host = hostname;
    rest = pathname;
    mode = "host";
  }

  const trimmed = rest.replace(/^\/+|\/+$/g, "");
  const page = trimmed === "" ? "index" : trimmed;
  if (!PAGE_NAME.test(page)) return { type: "notfound", host, mode };
  return { type: "page", host, page, mode };
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

/** Build a link to a demo host/path for the current routing mode. */
export function buildLink(targetHost, targetPath, mode, port) {
  const p = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  if (mode === "path") return `/site/${targetHost}${p}`;
  const portPart = port && port !== "80" ? `:${port}` : "";
  return `http://${targetHost}${portPart}${p}`;
}

export function rewriteLinks(html, mode, port) {
  return html.replace(LINK_PLACEHOLDER, (whole, host, p) =>
    Object.hasOwn(DEMO_HOSTS, host) ? buildLink(host, p, mode, port) : "#",
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function pageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/static/demo.css">
</head>
<body class="demo-index">
<main class="container">
${bodyHtml}
</main>
<footer class="site-footer"><p class="demo-footer">${FOOTER_TEXT}</p></footer>
</body>
</html>
`;
}

export function renderIndex(port) {
  const rows = Object.entries(DEMO_HOSTS)
    .map(([host, meta]) => {
      const paths = meta.paths ?? ["/"];
      const pathLinks = paths
        .map((p) => `<a href="${escapeHtml(buildLink(host, p, "path", port))}">${escapeHtml(p)}</a>`)
        .join(" · ");
      const hostLinks = paths
        .map((p) => `<a href="${escapeHtml(buildLink(host, p, "host", port))}">${escapeHtml(p)}</a>`)
        .join(" · ");
      return `<tr>
<td><code>${escapeHtml(host)}</code><br><span class="muted">${escapeHtml(meta.label)}</span></td>
<td>${escapeHtml(meta.kind)}</td>
<td>${pathLinks}</td>
<td>${hostLinks}</td>
</tr>`;
    })
    .join("\n");
  return pageShell(
    "TrustLens demo sites",
    `<h1>TrustLens demo sites</h1>
<p>Seeded genuine and lookalike sites for the TrustLens demo. Every form is inert: nothing is submitted, logged or stored.</p>
<table class="index-table">
<thead><tr><th>Host</th><th>Kind</th><th>Path mode (no hosts file)</th><th>Host mode (needs hosts-file entry)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`,
  );
}

function render404(host) {
  return pageShell(
    "Not found — demo site",
    `<h1>Page not found</h1><p>${host ? `No such page on <code>${escapeHtml(host)}</code>.` : "No such demo page."} <a href="/">Demo index</a></p>`,
  );
}

async function handle(req, res) {
  // Never read the body; anything but GET/HEAD is refused outright.
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.resume(); // discard without buffering or inspecting
    send(req, res, 405, "text/plain; charset=utf-8", "Method not allowed — demonstration site, nothing is accepted.\n", {
      Allow: "GET, HEAD",
      Connection: "close",
    });
    return;
  }

  const { port } = parseHostHeader(req.headers.host);
  const route = resolveRoute(req.headers.host, req.url);

  if (route.type === "static") {
    const { file, type } = STATIC_FILES[route.key];
    const body = await readFile(path.join(STATIC_DIR, file));
    send(req, res, 200, type, body);
    return;
  }
  if (route.type === "index") {
    send(req, res, 200, "text/html; charset=utf-8", renderIndex(port));
    return;
  }
  if (route.type === "page") {
    const file = path.join(SITES_DIR, route.host, `${route.page}.html`);
    // Defence in depth: the resolved file must stay inside the host's directory.
    if (path.dirname(file) !== path.join(SITES_DIR, route.host)) {
      send(req, res, 404, "text/html; charset=utf-8", render404(route.host));
      return;
    }
    let html;
    try {
      html = await readFile(file, "utf8");
    } catch {
      send(req, res, 404, "text/html; charset=utf-8", render404(route.host));
      return;
    }
    send(req, res, 200, "text/html; charset=utf-8", rewriteLinks(html, route.mode, port));
    return;
  }
  send(req, res, 404, "text/html; charset=utf-8", render404(route.host));
}

export function createDemoServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(req, res, 500, "text/plain; charset=utf-8", "Internal error\n");
      else res.end();
    });
  });
}

/** Start listening. Resolves with the server once bound. */
export function startServer({ port = Number(process.env.PORT ?? 8081), host = process.env.HOST ?? "127.0.0.1" } = {}) {
  const server = createDemoServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function isMain() {
  if (!process.argv[1]) return false;
  const self = import.meta.url;
  const invoked = pathToFileURL(path.resolve(process.argv[1])).href;
  return process.platform === "win32" ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (isMain()) {
  const server = await startServer();
  const addr = server.address();
  const shownPort = typeof addr === "object" && addr ? addr.port : process.env.PORT ?? 8081;
  console.log(`TrustLens demo sites listening on http://${process.env.HOST ?? "127.0.0.1"}:${shownPort}/`);
  console.log(`  Path mode: http://localhost:${shownPort}/site/apply.northstar-admissions.example/pay`);
  console.log(`  Host mode: http://apply.northstar-admissions.example:${shownPort}/pay (needs hosts-file entry)`);
  console.log("All forms are inert. Request bodies are never read or logged.");
}
