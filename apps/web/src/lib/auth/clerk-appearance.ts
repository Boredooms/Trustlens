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

/**
 * Read tokens as the dark theme defines them, whatever the page theme is: a detached probe element
 * with the `.dark` class picks up the `.dark { --… }` values from tokens.css.
 */
function readDark(): (name: string) => string | undefined {
  if (typeof document === "undefined") return () => undefined;
  const probe = document.createElement("div");
  probe.className = "dark";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const values = new Map<string, string>();
  for (const n of ["surface", "surface-secondary", "border", "foreground", "muted-strong", "primary", "primary-foreground", "danger", "success", "warning"]) {
    const v = cs.getPropertyValue(`--${n}`).trim();
    if (v) values.set(n, v);
  }
  probe.remove();
  return (name) => values.get(name);
}

/** Sign-in / sign-up / every Clerk modal: always the dark palette (product decision 2026-11-10). */
export function resolveClerkDarkAppearance(): ClerkAppearance {
  const base = resolveClerkAppearance(readDark());
  // Monochrome provider marks are black glyphs: invert them on the dark card (as Clerk's own dark
  // theme does). Colour marks (Google, Microsoft) are left alone.
  const invert = { filter: "invert(1)" };
  return {
    ...base,
    elements: {
      ...base.elements,
      socialButtonsProviderIcon__github: invert,
      socialButtonsProviderIcon__x: invert,
      socialButtonsProviderIcon__apple: invert,
    },
  };
}

export function resolveClerkAppearance(get: (name: string) => string | undefined = read): ClerkAppearance {
  const read2 = get;
  const surface = read2("surface");
  const border = read2("border");
  const fg = read2("foreground");
  return {
    variables: defined([
      ["colorBackground", surface],
      ["colorText", fg],
      ["colorTextSecondary", read2("muted-strong")],
      ["colorPrimary", read2("primary")],
      ["colorTextOnPrimaryBackground", read2("primary-foreground")],
      ["colorInputBackground", read2("surface-secondary")],
      ["colorInputText", fg],
      ["colorNeutral", fg],
      ["colorDanger", read2("danger")],
      ["colorSuccess", read2("success")],
      ["colorWarning", read2("warning")],
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
        ["background", read2("surface-secondary")],
        ["borderRight", border ? `1px solid ${border}` : undefined],
      ]),
      scrollBox: defined([["background", surface]]),
      pageScrollBox: defined([["background", surface]]),
    },
  };
}

export function useClerkAppearance(): ClerkAppearance {
  const [appearance, setAppearance] = useState(() => resolveClerkAppearance());
  useEffect(() => {
    const html = document.documentElement;
    const obs = new MutationObserver(() => setAppearance(resolveClerkAppearance()));
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return appearance;
}
