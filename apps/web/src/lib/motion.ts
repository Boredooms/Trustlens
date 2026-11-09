/**
 * TrustLens motion grammar (ANIMATION_GUIDELINES.md §2–4). One vocabulary for the whole app:
 *
 *   enter    — a panel or row appears: fade + 6 px rise, `base` duration, standard easing.
 *   stagger  — lists of findings / evidence / history: children enter 40 ms apart, capped at 12 rows.
 *   layout   — slide-overs, the active nav indicator, expanding rows: a damped spring, no bounce.
 *   update   — a live number (score, counts): NumberFlow digit roll, never a count-up from zero.
 *
 * Durations mirror tokens.css (`--dur-*`, `--ease-*`); motion.test.ts asserts they stay equal.
 * Reduced motion: <MotionConfig reducedMotion="user"> turns transforms off; only opacity remains.
 * Content is never hidden behind motion: every `initial` state is visible within `slow` (320 ms).
 */
import type { Transition, Variants } from "motion/react";

export const DURATION = { fast: 0.12, base: 0.2, slow: 0.32 } as const;
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
export const EASE_EMPHASIS = [0.3, 0, 0, 1] as const;

/** Upper bound on staggered children, so long lists never delay the last row past ~0.5 s. */
export const STAGGER_CAP = 12;
export const STAGGER_STEP = 0.04;

export const transitions = {
  enter: { duration: DURATION.base, ease: EASE_STANDARD } satisfies Transition,
  exit: { duration: DURATION.fast, ease: EASE_STANDARD } satisfies Transition,
  layout: { type: "spring", stiffness: 520, damping: 44, mass: 0.9 } satisfies Transition,
  panel: { duration: DURATION.slow, ease: EASE_EMPHASIS } satisfies Transition,
} as const;

export const variants = {
  enter: {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0, transition: transitions.enter },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transitions.enter },
  },
  list: {
    hidden: {},
    visible: { transition: { staggerChildren: STAGGER_STEP } },
  },
} satisfies Record<string, Variants>;

/** Delay for the i-th item when a parent stagger cannot be used (e.g. virtualised rows). */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_STEP;
}
