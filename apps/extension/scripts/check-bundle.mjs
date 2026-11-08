// Static guards for the extension (BROWSER_PROTECTION_LOGIC.md §7, EXTENSION_API_INTEGRATION.md §9,
// design-system-guardrails §4):
//  - the forbidden verdict word (s-a-f-e, any case, even inside other words) never appears;
//  - no eval / new Function / innerHTML assignment / remote script URLs;
//  - (source only) no colour literals outside shared/tokens.ts.
// Usage: node scripts/check-bundle.mjs [--src]   (default: checks dist/)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_WORD = new RegExp(["s", "a", "f", "e"].join(""), "i");
const CODE_RULES = [
  [/\beval\s*\(/, "eval("],
  [/new\s+Function\s*\(/, "new Function("],
  [/\.innerHTML\s*=/, "innerHTML assignment"],
  [/<script[^>]+src=["']https?:/i, "remote script"],
  [/import\(\s*["']https?:/, "remote dynamic import"],
];
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function checkDir(dir, { source = false } = {}) {
  const problems = [];
  for (const file of walk(dir)) {
    if (!/\.(js|mjs|ts|html|css|json)$/.test(file)) continue;
    const rel = relative(root, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      if (FORBIDDEN_WORD.test(line)) problems.push(`${where}: forbidden verdict word`);
      for (const [re, label] of CODE_RULES) if (re.test(line)) problems.push(`${where}: ${label}`);
      if (source && !rel.endsWith("shared/tokens.ts") && /\.(ts|css|html)$/.test(file) && HEX.test(line)) {
        problems.push(`${where}: colour literal outside shared/tokens.ts`);
      }
    });
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const source = process.argv.includes("--src");
  const problems = checkDir(join(root, source ? "src" : "dist"), { source });
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`check-bundle: ${source ? "src" : "dist"} clean`);
}
