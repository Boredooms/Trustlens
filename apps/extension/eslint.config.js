import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly" } },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports (CLAUDE.md §4)." },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: "Never assign innerHTML; use textContent (EXTENSION_API_INTEGRATION.md §9).",
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: "Never assign outerHTML.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Never use insertAdjacentHTML.",
        },
      ],
    },
  },
  {
    // Code that runs on web pages must never touch form values (metadata only). Our own popup and
    // options pages read their own inputs (pairing code), so the rule is scoped to page-facing code.
    files: ["src/content/**/*.ts", "src/shared/detect.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "value", message: "Never read form values on web pages (metadata only)." },
        { property: "valueAsNumber", message: "Never read form values on web pages." },
        { property: "innerText", message: "Use textContent." },
      ],
    },
  },
);
