# ANIMATION_GUIDELINES

> **Status:** DECIDED · **Group:** 04-frontend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** motion library responsibilities, durations, easing, scroll behaviour, reduced motion.
> **Related:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) · [`ACCESSIBILITY_RESPONSIVENESS.md`](ACCESSIBILITY_RESPONSIVENESS.md)

---

## 1. Principle

Motion explains change. It never decorates, never delays a task, and never carries meaning that is
missing without it. If removing an animation makes the interface confusing, the interface is wrong.

Three libraries, three jobs, no overlap:

| Tool | Job | Where |
| --- | --- | --- |
| **GSAP + ScrollTrigger** | Narrative, scroll-driven sequences | Public landing only |
| **Motion (Framer Motion)** | Component and layout transitions | App UI |
| **CSS transitions** | Micro-feedback | Everywhere |
| **Lenis** | Smooth scroll | Public marketing pages only |

Adding a fourth animation dependency requires an ADR.

---

## 2. Durations and easing

| Token | Value | Use |
| --- | --- | --- |
| `--dur-instant` | 80 ms | Hover, focus, press |
| `--dur-fast` | 140 ms | Tooltip, badge change, checkbox |
| `--dur-base` | 200 ms | Dropdown, tab underline, toast |
| `--dur-slow` | 320 ms | Drawer, modal, accordion |
| `--dur-narrative` | 600–900 ms | GSAP scroll sequences |

| Easing | Value | Use |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Most transitions |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entering elements |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exiting elements |
| `--ease-linear` | `linear` | Progress bars only |

Rules: exits are ~20% faster than entrances. No bounce, no elastic, no spring with visible overshoot
in data views. `Motion` springs are allowed only for the graph drawer, with `stiffness ≤ 260`,
`damping ≥ 30`.

---

## 3. CSS transitions (default choice)

Use for: hover, focus rings, button press, checkbox/switch, skeleton shimmer, verdict colour change,
row highlight, tooltip fade, accordion height (when content is small).

```css
.finding-row {
  transition: background-color var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard);
}
```

Never animate `width`/`height` on table rows or charts; use `transform`/`opacity`, or
`grid-template-rows` for accordions.

---

## 4. Motion (Framer Motion) in the app

| Element | Animation |
| --- | --- |
| Route transition | Opacity 0→1, 120 ms; **no** slide (keeps tables stable) |
| Drawer (evidence, node) | Slide from right 320 ms `--ease-out`, backdrop fade 200 ms |
| Modal | Scale 0.98→1 + opacity, 200 ms |
| Toast | Slide up 12 px + fade, 200 ms; auto-dismiss 6 s |
| Tabs | Underline `layoutId`, 200 ms |
| List reorder (review queue) | `layout` with 200 ms |
| Graph node selection | Halo scale 1→1.15→1, 240 ms |
| Skeleton | Opacity pulse 1.2 s, or shimmer 1.6 s |

Implementation rules:

- `AnimatePresence` only where exit animation matters (drawers, toasts, modals).
- Never animate a list of more than 40 items individually; animate the container.
- `layout` animations are banned inside virtualised lists.
- All Motion transitions read duration tokens from a shared `motion.ts` (no inline numbers).

---

## 5. GSAP on the landing page

Scope: hero headline reveal, the four-step "how detection works" sequence, and the graph section
reveal. Nothing else.

```ts
gsap.registerPlugin(ScrollTrigger);

const ctx = gsap.context(() => {
  gsap.from(".hero-line", {
    y: 24, opacity: 0, duration: 0.7, stagger: 0.08, ease: "power3.out",
  });
  gsap.to(".process-step", {
    opacity: 1, y: 0, stagger: 0.12,
    scrollTrigger: { trigger: ".process", start: "top 70%" },
  });
}, heroRef);

return () => ctx.revert();
```

Rules:

- Each GSAP scope is created in a `useEffect` and reverted on unmount (`gsap.context`).
- `ScrollTrigger.refresh()` after fonts load and after any layout-affecting image load.
- No scroll-jacking; the page scrolls natively, Lenis only smooths it.
- Total narrative scroll length ≤ 3 viewports; judges should reach the CTA fast.
- GSAP is dynamically imported so it never enters the app bundle.

---

## 6. Lenis

- Public routes only, mounted in `PublicShell`, destroyed on unmount.
- Config: `lerp: 0.1`, `wheelMultiplier: 1`, `smoothWheel: true`, `syncTouch: false`.
- Disabled when `prefers-reduced-motion: reduce`.
- **Never** in `/app/*`: it fights nested scroll containers (graph drawer, tables) and breaks
  keyboard scrolling expectations.

---

## 7. Reduced motion

`prefers-reduced-motion: reduce` must:

1. Disable Lenis entirely (native scroll).
2. Replace GSAP reveals with immediate final state (`gsap.set`, no tween).
3. Reduce Motion transitions to opacity-only at 80 ms (or none).
4. Stop skeleton shimmer (static placeholder).
5. Keep progress indicators as determinate text ("Step 3 of 7") without pulsing.

Implementation: a `useReducedMotion()` hook backed by the media query **and** the user's
`useUiStore.reduceMotion` override; animation helpers check it centrally rather than per component.

---

## 8. Performance guardrails

- Animate only `transform` and `opacity` (compositor-friendly).
- No animation on elements that trigger layout in a table body.
- Graph canvas animations are limited to selection halos; layout transitions run on
  `cytoscape`'s own layout engine, not on the DOM.
- Budget: no long task > 50 ms during a route transition; verify with the Performance panel before
  merging a new animated component.
- `will-change` is applied sparingly and removed after the animation.

---

## 9. Anti-patterns

| Don't | Why |
| --- | --- |
| Parallax on data screens | Nauseating, hurts precision |
| Animated counters on load | Delays information, annoys on repeat visits |
| Rotating/glowing "scanning" orb | Decorative; we show named steps instead |
| Staggered fade-in for table rows | Makes the page feel slow at 50 rows |
| Scroll reveal for critical findings | Content must be present without scrolling triggers |
| Hover-only affordances | Inaccessible on touch and keyboard |
| Autoplaying video | Bandwidth and distraction |

---

## 10. Acceptance criteria

1. With reduced motion enabled, nothing moves except opacity changes ≤ 80 ms.
2. No animation exceeds 320 ms in the app; narrative sequences stay under 900 ms per step.
3. The landing page's largest contentful paint is unaffected by GSAP (text is not hidden until JS
   runs — animate from `opacity: 0` only after mount, and provide a no-JS fallback that shows text).
4. Lenis is absent from `/app` bundles (verified by a build grep).
5. Every animated component has a static final state that is correct on its own.
