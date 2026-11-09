import { useEffect, useState } from "react";

/**
 * Clerk components (UserProfile, SignIn) themed from tokens.css. Clerk v5 derives shades from its
 * colour variables, so it needs concrete values — CSS `var()` strings are not accepted. This hook
 * resolves the tokens with getComputedStyle and re-resolves whenever the theme class on <html>
 * changes, which fixes the white Clerk card in dark mode (reported 2026-11-09).
 *
 * No colour literals live here (check-tokens): a token that does not resolve is simply omitted and
 * Clerk keeps its own default for that variable.
 */
export interface ClerkAppearance {
  variables: Record<string, string>;
  elements: Record<string, Record<string, string>>;
}

function read(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v || undefined;
}

function defined(entries: Array<[string, string | undefined]>): Record<string, string> {
  return Object.fromEntries(entries.filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function resolveClerkAppearance(): ClerkAppearance {
  const surface = read("surface");
  const border = read("border");
  const fg = read("foreground");
  return {
    variables: defined([
      ["colorBackground", surface],
      ["colorText", fg],
      ["colorTextSecondary", read("muted-strong")],
      ["colorPrimary", read("primary")],
      ["colorTextOnPrimaryBackground", read("primary-foreground")],
      ["colorInputBackground", read("surface-secondary")],
      ["colorInputText", fg],
      ["colorNeutral", fg],
      ["colorDanger", read("danger")],
      ["colorSuccess", read("success")],
      ["colorWarning", read("warning")],
      ["borderRadius", "6px"],
      ["fontFamily", '"Geist Sans", Geist, ui-sans-serif, system-ui, sans-serif'],
      ["fontSize", "14px"],
    ]),
    elements: {
      rootBox: { width: "100%" },
      cardBox: defined([
        ["width", "100%"],
        ["maxWidth", "100%"],
        ["boxShadow", "none"],
        ["border", border ? `1px solid ${border}` : undefined],
        ["borderRadius", "10px"],
      ]),
      navbar: defined([
        ["background", read("surface-secondary")],
        ["borderRight", border ? `1px solid ${border}` : undefined],
      ]),
      scrollBox: defined([["background", surface]]),
      pageScrollBox: defined([["background", surface]]),
    },
  };
}

export function useClerkAppearance(): ClerkAppearance {
  const [appearance, setAppearance] = useState(resolveClerkAppearance);
  useEffect(() => {
    const html = document.documentElement;
    const obs = new MutationObserver(() => setAppearance(resolveClerkAppearance()));
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return appearance;
}
