// Build static, deployable copies of the demo sites for Vercel (one Vercel project per site, so each
// gets its own real hostname that TrustLens can scan like any other site).
//
//   node scripts/build-vercel.mjs      → dist/<project>/ (public files + vercel.json)
//
// Every page is stamped with a visible SIMULATED banner and `noindex`. Forms stay inert: the CSP in
// vercel.json has `form-action 'none'`, static/demo.js cancels every submit, and the form targets are
// `.example` hosts that cannot resolve. Nothing here ever receives a request body.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES = path.join(ROOT, "sites");
const OUT = path.join(ROOT, "dist");

/** Vercel project → the demo hosts it serves and where each host's pages live. */
export const PROJECTS = [
  {
    project: "trustlens-demo-northstar",
    kind: "genuine",
    hosts: { "northstar-demo.example": "/", "login.northstar-demo.example": "/login", "pay.northstar-demo.example": "/pay" },
  },
  { project: "trustlens-demo-admissions", kind: "lookalike", hosts: { "apply.northstar-admissions.example": "/" } },
  { project: "trustlens-demo-scholarships", kind: "lookalike", hosts: { "apply.northstar-scholarships.example": "/" } },
  { project: "trustlens-demo-placement", kind: "lookalike", hosts: { "portal.northstar-placement.example": "/" } },
];

const BANNER = (kind) =>
  `<div class="sim-banner" role="note">SIMULATED ${kind === "lookalike" ? "PHISHING " : ""}TEST FIXTURE — built for the TrustLens demo. ` +
  `Fictional institution, inert forms, nothing is collected. Do not enter real information.</div>`;

const HEADERS = [
  ["Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "no-referrer"],
  ["X-Frame-Options", "DENY"],
  ["X-Robots-Tag", "noindex, nofollow, noarchive"],
];

function transform(html, { project, host, base, kind }) {
  const cross = new Map(
    Object.entries(project.hosts).map(([h, p]) => [h, p === "/" ? "" : p]),
  );
  let out = html.replace(/\{\{link:([a-z0-9.-]+):(\/[^}]*)\}\}/g, (_w, h, p) => {
    if (h === host) return `${base === "/" ? "" : base}${p}` || "/";
    return cross.has(h) ? `${cross.get(h)}${p === "/" ? "" : p}` || "/" : "/";
  });
  out = out.replace("</head>", '<meta name="robots" content="noindex,nofollow,noarchive">\n</head>');
  out = out.replace(/<body([^>]*)>/, `<body$1>\n${BANNER(kind)}`);
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  for (const project of PROJECTS) {
    const dir = path.join(OUT, project.project);
    await mkdir(path.join(dir, "static"), { recursive: true });
    await cp(path.join(ROOT, "static"), path.join(dir, "static"), { recursive: true });
    for (const [host, base] of Object.entries(project.hosts)) {
      for (const f of await readdir(path.join(SITES, host))) {
        if (!f.endsWith(".html")) continue;
        const page = f.replace(/\.html$/, "");
        const html = transform(await readFile(path.join(SITES, host, f), "utf8"), {
          project,
          host,
          base,
          kind: project.kind,
        });
        const rel = base === "/" ? "" : base.slice(1);
        const target = page === "index" ? path.join(dir, rel, "index.html") : path.join(dir, rel, `${page}.html`);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, html);
      }
    }
    await writeFile(
      path.join(dir, "vercel.json"),
      JSON.stringify(
        { cleanUrls: true, trailingSlash: false, headers: [{ source: "/(.*)", headers: HEADERS.map(([key, value]) => ({ key, value })) }] },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(`built ${PROJECTS.length} demo projects into ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
