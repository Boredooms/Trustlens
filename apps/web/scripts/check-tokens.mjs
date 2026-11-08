#!/usr/bin/env node
// Fails when a hex colour appears in src/** outside src/styles/tokens.css.
// DESIGN_SYSTEM.md §9 / design-system-guardrails §1.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const allowed = new Set([join("src", "styles", "tokens.css")]);
const exts = new Set([".ts", ".tsx", ".css", ".js", ".jsx", ".html", ".svg"]);
// #abc, #abcd, #aabbcc, #aabbccdd not followed by more word chars
const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (exts.has(p.slice(p.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(srcDir)) {
  const rel = relative(root, file);
  if (allowed.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(hex)) {
      // ignore URL fragments / anchors such as href="#main" (letters beyond a-f never match)
      hits.push(`${rel.split(sep).join("/")}:${i + 1}: ${m[0]}`);
    }
  });
}

if (hits.length > 0) {
  console.error("check-tokens: raw hex colours found outside src/styles/tokens.css:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("check-tokens: no raw hex colours outside src/styles/tokens.css");
