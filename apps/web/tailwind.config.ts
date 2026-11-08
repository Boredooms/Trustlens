import type { Config } from "tailwindcss";

// Every colour maps to a CSS variable in src/styles/tokens.css (DESIGN_SYSTEM.md §2.2).
// No raw colour values belong in this file or in components.
const v = (name: string) => `var(--${name})`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      background: v("background"),
      foreground: v("foreground"),
      surface: {
        DEFAULT: v("surface"),
        secondary: v("surface-secondary"),
        inverse: v("surface-inverse"),
      },
      border: { DEFAULT: v("border"), strong: v("border-strong") },
      muted: { DEFAULT: v("muted"), strong: v("muted-strong") },
      primary: {
        DEFAULT: v("primary"),
        foreground: v("primary-foreground"),
        hover: v("primary-hover"),
      },
      danger: { DEFAULT: v("danger"), surface: v("danger-surface") },
      warning: { DEFAULT: v("warning"), surface: v("warning-surface") },
      success: { DEFAULT: v("success"), surface: v("success-surface") },
      unknown: { DEFAULT: v("unknown"), surface: v("unknown-surface") },
      focus: { ring: v("focus-ring"), offset: v("focus-offset") },
      node: {
        domain: v("node-domain"),
        ip: v("node-ip"),
        cert: v("node-cert"),
        payee: v("node-payee"),
        org: v("node-org"),
      },
      edge: { strong: v("edge-strong"), weak: v("edge-weak") },
      backdrop: v("backdrop"),
    },
    borderColor: ({ theme }) => ({ ...theme("colors"), DEFAULT: v("border") }),
    borderRadius: {
      none: "0",
      sm: v("radius-sm"),
      DEFAULT: v("radius-sm"),
      md: v("radius-md"),
      lg: v("radius-lg"),
      full: "9999px",
    },
    boxShadow: {
      none: "none",
      overlay: v("shadow-overlay"),
    },
    fontFamily: {
      sans: ["Geist Sans", "Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    extend: {
      fontSize: {
        "2xs": ["11px", "1.4"],
        code: ["13px", "1.5"],
        display: ["clamp(44px, 7vw, 72px)", "1.02"],
        xs: ["12px", "1.4"],
        sm: ["14px", "1.55"],
        base: ["16px", "1.6"],
        lg: ["18px", "1.35"],
        xl: ["20px", "1.3"],
        "2xl": ["24px", "1.25"],
        "3xl": ["32px", "1.15"],
        "4xl": ["40px", "1.1"],
      },
      maxWidth: { content: "1200px", reading: "720px", prose: "68ch", modal: "560px", drawer: "480px", nav: "280px", auth: "400px" },
      width: { sidebar: "240px", drawer: "480px", rail: "72px" },
      transitionTimingFunction: { standard: "cubic-bezier(0.2, 0, 0, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
