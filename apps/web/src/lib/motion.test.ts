import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DURATION, EASE_EMPHASIS, EASE_STANDARD, STAGGER_CAP, staggerDelay } from "./motion";

// The motion grammar has one source of truth: tokens.css. lib/motion mirrors it for Motion (which
// needs numbers, not CSS variables); this test fails if the two drift. Vitest runs from apps/web.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} missing`);
  return m[1].trim();
}

describe("motion grammar mirrors tokens.css", () => {
  it("durations", () => {
    expect(token("dur-fast")).toBe(`${DURATION.fast * 1000}ms`);
    expect(token("dur-base")).toBe(`${DURATION.base * 1000}ms`);
    expect(token("dur-slow")).toBe(`${DURATION.slow * 1000}ms`);
  });

  it("easing", () => {
    expect(token("ease-standard")).toBe(`cubic-bezier(${EASE_STANDARD.join(", ")})`);
    expect(token("ease-emphasis")).toBe(`cubic-bezier(${EASE_EMPHASIS.join(", ")})`);
  });

  it("no app animation exceeds the slow ceiling (ANIMATION_GUIDELINES §8.2)", () => {
    expect(DURATION.slow).toBeLessThanOrEqual(0.32);
    expect(staggerDelay(STAGGER_CAP + 50)).toBe(staggerDelay(STAGGER_CAP));
    expect(staggerDelay(STAGGER_CAP)).toBeLessThan(0.5);
  });
});
