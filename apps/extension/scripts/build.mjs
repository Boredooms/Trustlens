// Builds a loadable unpacked MV3 extension into apps/extension/dist.
// Plain esbuild multi-entry build (no CRXJS): the service worker is an ES module, the content script
// and page scripts are IIFEs (content scripts cannot be modules), and manifest.json is generated here
// so host permissions follow the build-time API / demo origins.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { checkDir } from "./check-bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// ---- env: process env wins over .env ---------------------------------------------------------
function loadDotEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = loadDotEnv(join(root, ".env"));
const env = (k, d = "") => (process.env[k] ?? fileEnv[k] ?? d).trim();

function origin(value, name, required) {
  if (!value) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const u = new URL(value);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${name} must be http(s)`);
  return u.origin;
}

const API_BASE_URL = origin(env("VITE_API_BASE_URL", "http://localhost:8000"), "VITE_API_BASE_URL", true);
const WEB_BASE_URL = origin(env("VITE_WEB_BASE_URL", "http://localhost:5173"), "VITE_WEB_BASE_URL", true);
const DEMO_SITES_ORIGIN = origin(env("VITE_DEMO_SITES_ORIGIN", ""), "VITE_DEMO_SITES_ORIGIN", false);

// ---- bundles ---------------------------------------------------------------------------------
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const define = {
  "import.meta.env.VITE_API_BASE_URL": JSON.stringify(API_BASE_URL),
  "import.meta.env.VITE_WEB_BASE_URL": JSON.stringify(WEB_BASE_URL),
  "import.meta.env.VITE_DEMO_SITES_ORIGIN": JSON.stringify(DEMO_SITES_ORIGIN ?? ""),
  "import.meta.env.EXT_VERSION": JSON.stringify(pkg.version),
};
const common = { bundle: true, target: "chrome110", define, legalComments: "none", logLevel: "warning", charset: "utf8" };

await Promise.all([
  build({ ...common, entryPoints: [join(root, "src/background/service-worker.ts")], outfile: join(dist, "background.js"), format: "esm" }),
  build({ ...common, entryPoints: [join(root, "src/content/content.ts")], outfile: join(dist, "content.js"), format: "iife" }),
  build({ ...common, entryPoints: [join(root, "src/popup/popup.ts")], outfile: join(dist, "popup.js"), format: "iife" }),
  build({ ...common, entryPoints: [join(root, "src/options/options.ts")], outfile: join(dist, "options.js"), format: "iife" }),
]);

for (const [from, to] of [
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/options/options.html", "options.html"],
  ["src/options/options.css", "options.css"],
  ["src/shared/page.css", "page.css"],
]) {
  copyFileSync(join(root, from), join(dist, to));
}

// ---- icons: tiny generated PNGs (monochrome shield outline on ink), no binary assets in git ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function iconPng(size) {
  const ink = [0x17, 0x17, 0x17, 255];
  const paper = [0xf6, 0xf5, 0xf1, 255];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      // Shield: flat top, straight sides to 55% height, then tapering to a point.
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size;
      const top = 0.14, mid = 0.55, bottom = 0.9, half = 0.33;
      let inside = false, inner = false;
      if (ny >= top && ny <= bottom) {
        const w = ny <= mid ? half : half * (1 - (ny - mid) / (bottom - mid));
        inside = Math.abs(nx) <= w;
        const t = Math.max(1.5 / size, 0.09);
        const wi = w - t;
        inner = ny >= top + t && ny <= bottom - t * 1.6 && Math.abs(nx) <= wi;
      }
      row.push(...(inside && !inner ? paper : ink));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync(join(dist, "icons"), { recursive: true });
const icons = {};
for (const s of [16, 32, 48, 128]) {
  writeFileSync(join(dist, "icons", `icon-${s}.png`), iconPng(s));
  icons[s] = `icons/icon-${s}.png`;
}

// ---- manifest --------------------------------------------------------------------------------
// Demo hosts (DEMO_RUNBOOK.md §3). Patterns without a port match any port (host mode on :8081).
const DEMO_HOST_PATTERNS = [
  "*://northstar-demo.example/*",
  "*://*.northstar-demo.example/*",
  "*://*.northstar-admissions.example/*",
  "*://*.northstar-scholarships.example/*",
  "*://*.northstar-placement.example/*",
];
const contentMatches = [...DEMO_HOST_PATTERNS];
if (DEMO_SITES_ORIGIN) contentMatches.push(`${DEMO_SITES_ORIGIN}/*`);
const hostPermissions = [...new Set([`${API_BASE_URL}/*`, ...contentMatches])];

const manifest = {
  manifest_version: 3,
  name: "TrustLens",
  version: pkg.version,
  description: "Checks whether a page is authorised to ask for your login or payment. The TrustLens server decides.",
  minimum_chrome_version: "110",
  icons,
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: hostPermissions,
  background: { service_worker: "background.js", type: "module" },
  action: { default_popup: "popup.html", default_title: "TrustLens", default_icon: icons },
  options_page: "options.html",
  content_scripts: [{ matches: contentMatches, js: ["content.js"], run_at: "document_idle", all_frames: false }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const problems = checkDir(dist);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Built TrustLens ${pkg.version} → ${dist}`);
console.log(`  API ${API_BASE_URL} · web ${WEB_BASE_URL} · demo-sites ${DEMO_SITES_ORIGIN ?? "(not set)"}`);
console.log(`  host_permissions: ${hostPermissions.join(", ")}`);
