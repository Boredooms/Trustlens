// Design tokens for the overlay, popup and options page — copied from DESIGN_SYSTEM.md §2.2.
// This is the ONLY file in the extension allowed to contain colour literals
// (design-system-guardrails §1, §6). Everything else uses var(--token).
import type { Decision } from "./types";

export const LIGHT = {
  background: "#f6f5f1",
  foreground: "#111111",
  surface: "#ffffff",
  "surface-secondary": "#ebe9e3",
  border: "#dad9d3",
  "border-strong": "#c4c2ba",
  muted: "#777777",
  "muted-strong": "#5c5c5c",
  primary: "#171717",
  "primary-foreground": "#ffffff",
  "primary-hover": "#2b2b2b",
  danger: "#c03939",
  "danger-surface": "#f7e9e9",
  warning: "#a87526",
  "warning-surface": "#f6efdf",
  success: "#397653",
  "success-surface": "#e8f0ea",
  unknown: "#626262",
  "unknown-surface": "#ececea",
  "focus-ring": "#171717",
  "focus-offset": "#f6f5f1",
} as const;

export const DARK: Record<keyof typeof LIGHT, string> = {
  background: "#090909",
  foreground: "#f2f1ed",
  surface: "#151515",
  "surface-secondary": "#202020",
  border: "#303030",
  "border-strong": "#3d3d3d",
  muted: "#999999",
  "muted-strong": "#b4b4b4",
  primary: "#f2f1ed",
  "primary-foreground": "#111111",
  "primary-hover": "#e2e1db",
  danger: "#e07a7a",
  "danger-surface": "#2a1a1a",
  warning: "#d3a45e",
  "warning-surface": "#2a2318",
  success: "#7fb894",
  "success-surface": "#17241c",
  unknown: "#9a9a9a",
  "unknown-surface": "#1d1d1d",
  "focus-ring": "#f2f1ed",
  "focus-offset": "#090909",
};

export const RADIUS = { sm: "4px", md: "6px", lg: "10px" } as const;
export const FONT_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", monospace';
/** Modal/drawer elevation — the only shadow the system allows (DESIGN_SYSTEM.md §4.3). */
export const SHADOW_MODAL = "0 24px 48px -24px rgb(0 0 0 / 0.25)";
export const Z_TOP = 2147483647;

/** Decision → token names (DESIGN_SYSTEM.md §2.3). */
export const DECISION_TOKENS: Record<Decision, { text: keyof typeof LIGHT; surface: keyof typeof LIGHT }> = {
  BLOCK: { text: "danger", surface: "danger-surface" },
  WARN: { text: "warning", surface: "warning-surface" },
  ALLOW: { text: "success", surface: "success-surface" },
  REVIEW: { text: "unknown", surface: "unknown-surface" },
  UNKNOWN: { text: "unknown", surface: "unknown-surface" },
};

/** Badge background per decision (BROWSER_PROTECTION_LOGIC.md §2). ALLOW has no badge. */
export function badgeColour(decision: Decision): string {
  return LIGHT[DECISION_TOKENS[decision].text];
}

function vars(t: Record<string, string>): string {
  return Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
}

/** CSS custom properties for a selector (`:host` in the overlay, `:root` on extension pages). */
export function tokensCss(selector: string): string {
  return (
    `${selector}{${vars(LIGHT)}--radius-sm:${RADIUS.sm};--radius-md:${RADIUS.md};--radius-lg:${RADIUS.lg};` +
    `--font-sans:${FONT_SANS};--font-mono:${FONT_MONO};--shadow-modal:${SHADOW_MODAL};}` +
    `@media (prefers-color-scheme: dark){${selector}{${vars(DARK)}}}`
  );
}
