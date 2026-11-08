# ACCESSIBILITY_RESPONSIVENESS

> **Status:** DECIDED · **Group:** 04-frontend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** WCAG targets, semantic structure, keyboard model, responsive rules.
> **Related:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) · [`UI_UX_SPECIFICATIONS.md`](UI_UX_SPECIFICATIONS.md)

---

## 1. Target

**WCAG 2.1 Level AA** for the public site and the dashboard. Accessibility is a release criterion for
the MVP, not a follow-up. Security products are used under stress; a warning nobody can read is a
failed warning.

---

## 2. Semantic structure

- One `<h1>` per page; heading levels never skip.
- Landmarks: `<header>`, `<nav aria-label="Main">`, `<main>`, `<aside>` for rails, `<footer>`.
- Buttons that navigate are links (`<a>`), actions are `<button>`. No clickable `<div>`.
- Lists are `<ul>/<ol>`; tables are `<table>` with `<th scope>`.
- The verdict panel is a `<section aria-labelledby>` with an `aria-live="polite"` summary when it
  changes asynchronously.

---

## 3. Keyboard model

| Key | Behaviour |
| --- | --- |
| `Tab` / `Shift+Tab` | Move focus in visual order; all interactive elements reachable |
| `Enter` / `Space` | Activate button/link |
| `Esc` | Close topmost overlay; return focus to the trigger |
| `Arrow` keys | Move within tabs, radio groups, listboxes, menus |
| `/` | Focus the page search (when present) |
| `?` | Open the shortcut help dialog |

Requirements:

- Focus is always visible: 2 px ring, 2 px offset, contrast ≥ 3:1 against adjacent colours.
- Route change: focus moves to the new `<h1>` (with `tabIndex={-1}`), and the page title updates.
- Modals/drawers trap focus and restore it on close.
- No keyboard traps; no positive `tabindex`.
- Skip link "Skip to content" is the first focusable element.

---

## 4. Screen readers

- Icons are `aria-hidden` unless they carry the only meaning.
- `VerdictBadge` exposes one string: "Decision: blocked. Risk: critical." — not "shield icon, BLOCK".
- Coverage meter: `role="meter"` with `aria-valuenow`, `aria-valuetext="85 percent of checks ran"`.
- Graph: the canvas has `role="img"` with an `aria-label` summarising counts, plus a **List view**
  table that is fully keyboard navigable. The graph is never the only way to reach data.
- Toasts use `role="status"` (polite) except errors, which use `role="alert"`.
- Live regions are not spammed: scan progress updates announce at most every 5 s, and only stage
  changes ("Running certificate checks"), never percentages.

---

## 5. Forms

- Every input has a `<label for>`; placeholders are not labels.
- Errors: `aria-describedby` linking the message, `aria-invalid="true"`, and focus moves to the first
  invalid field on submit.
- Required fields marked with `required` and a visible "(required)" text, not only an asterisk.
- Helper text is associated with the field, not floating free.
- Autocomplete attributes are set (`email`, `current-password`, `new-password`, `organization`).
- The payment/justification textarea has a character counter exposed via `aria-describedby`.

---

## 6. Contrast and colour

- Body text ≥ 4.5:1; large text (≥ 24 px or 19 px bold) ≥ 3:1.
- UI borders and focus rings ≥ 3:1 against adjacent colours.
- Status is never colour-only: decision badges carry text + icon; graph edge confidence is encoded in
  dash pattern and label, not only opacity.
- Both themes are verified with an automated token-contrast test in CI.

---

## 7. Motion and timing

- Respect `prefers-reduced-motion` (see `ANIMATION_GUIDELINES.md` §7).
- No auto-advancing carousels; no content that disappears on a timer.
- Toasts persist ≥ 6 s and are dismissible; critical errors do not auto-dismiss.
- Session timeout warns 2 minutes before, with an extend action.

---

## 8. Responsive rules

| Breakpoint | Layout | Notes |
| --- | --- | --- |
| ≥ 1280 px | 12-col, sidebar 240 px, report two-column | Primary demo resolution |
| 1024–1279 | Sidebar 72 px icons, report single-column | Rail moves below main |
| 768–1023 | Sidebar drawer, filter bar wraps | Tables keep 4–5 columns |
| 480–767 | Single column, cards for rows | Graph list view default |
| < 480 | Single column, 16 px margins, full-width buttons | Overlay full-bleed |

Requirements:

- No horizontal scrolling of primary content at 360 px.
- Touch targets ≥ 44×44 px with ≥ 8 px spacing.
- Text remains readable at 200% zoom (no clipping, no overlap).
- Tables: below 768 px, each row becomes a definition-list card with labelled values; the card keeps
  the verdict and the primary action visible.
- The extension overlay is responsive from 320 px up and never exceeds 90vh.

---

## 9. Content accessibility

- Plain language in warnings; define jargon inline ("VPA" → "payment address").
- Abbreviations expanded on first use.
- Error messages state the cause and the next action.
- Language attribute set (`lang="en"`); no lorem ipsum in shipped screens.
- Numbers and dates are readable: "7 November 2026" in prose, ISO in technical detail.

---

## 10. Testing

| Test | Tool | Gate |
| --- | --- | --- |
| Automated audit (axe) | `@axe-core/playwright` on every route | 0 serious/critical violations |
| Keyboard walkthrough | Manual checklist per screen | All actions reachable |
| Contrast pairs | Unit test over token table | AA pass both themes |
| Screen reader smoke | NVDA or VoiceOver on scan report | Verdict and top finding announced |
| Zoom 200% | Manual | No clipping at 1280×800 |
| Reduced motion | Emulation | No motion beyond opacity |

Manual checklist (per screen): skip link, focus visible, headings ordered, labels present, no
colour-only meaning, overlay traps focus, no keyboard trap.

---

## 11. Known limitations (MVP)

- Cytoscape canvas is not exposed as a semantic graph; mitigated by list view and text summary.
- Extended screen-reader testing is limited to the scan report and overview screens in the MVP.
- The extension overlay cannot fix accessibility defects in the host page; it is rendered in a shadow
  root with its own semantics and does not steal focus from the page form until it blocks.
