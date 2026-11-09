import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage", "*.cjs"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use `as const` unions instead of TS enums." },
      ],
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true, namespaceFrom: true } }],
    },
  },
  {
    // Route-level lazy components and tool configs may default-export.
    files: ["src/routes/**/*.tsx", "*.config.ts", "eslint.config.js"],
    rules: { "no-restricted-exports": "off" },
  },
  {
    // Vendored Bklit UI chart sources (shadcn registry @bklit, see components.json). Kept close to
    // upstream so `shadcn add` updates diff cleanly: upstream uses default exports and a few
    // intentionally partial effect dependency lists. Colour/token rules still apply (check-tokens).
    files: ["src/components/charts/**/*.{ts,tsx}", "src/components/shimmering-text.tsx"],
    rules: { "no-restricted-exports": "off", "react-hooks/exhaustive-deps": "off" },
  },
);
