# DESIGN_SYSTEM

> **Status:** DECIDED · **Group:** 04-frontend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** colour tokens, typography, spacing, radius, borders, elevation, component rules, chart and graph styling.
> **Related:** [`UI_UX_SPECIFICATIONS.md`](UI_UX_SPECIFICATIONS.md) · [`ANIMATION_GUIDELINES.md`](ANIMATION_GUIDELINES.md) · [`ACCESSIBILITY_RESPONSIVENESS.md`](ACCESSIBILITY_RESPONSIVENESS.md)

---

## 1. Design intent

**Quietly powerful. Extremely precise.**

TrustLens is an investigation instrument, not a security theatre dashboard. The visual language is
monochrome, editorial and technical: large type, fine rules, generous whitespace, restrained motion.
Semantic colour appears only where a security state genuinely requires it.

What we are deliberately avoiding: neon green terminals, purple gradients, glassmorphism, glowing
cards, drop shadows everywhere, emoji statuses, "cyber" fonts.

Reference quality bar (not templates to copy): Linear's restraint, Vercel's typography and
whitespace, Stripe's documentation clarity, Raycast's dark UI discipline, Sentry's data density.

---

## 2. Colour

### 2.1 Palette

| Token | Hex | Use |
| --- | --- | --- |
| `--obsidian` | `#080808` | Darkest ink; dark-mode surfaces |
| `--charcoal` | `#202020` | Dark surface secondary |
| `--graphite` | `#626262` | Secondary text on light; icons |
| `--silver` | `#A3A3A3` | Muted text |
| `--stone` | `#D6D4CF` | Borders on warm surfaces |
| `--offwhite` | `#EBE9E3` | Secondary surface (light) |
| `--ivory` | `#F6F5F1` | Page background (light) |
| `--white` | `#FFFFFF` | Cards, inputs |

### 2.2 Semantic tokens

```css
:root {
  /* surfaces */
  --background: #f6f5f1;
  --foreground: #111111;
  --surface: #ffffff;
  --surface-secondary: #ebe9e3;
  --surface-inverse: #111111;

  /* lines & text */
  --border: #dad9d3;
  --border-strong: #c4c2ba;
  --muted: #777777;
  --muted-strong: #5c5c5c;

  /* actions */
  --primary: #171717;
  --primary-foreground: #ffffff;
  --primary-hover: #2b2b2b;

  /* security states (semantic only) */
  --danger: #c03939;
  --danger-surface: #f7e9e9;
  --warning: #a87526;
  --warning-surface: #f6efdf;
  --success: #397653;
  --success-surface: #e8f0ea;
  --unknown: #626262;
  --unknown-surface: #ececea;

  /* focus */
  --focus-ring: #171717;
  --focus-offset: #f6f5f1;

  /* graph */
  --node-domain: #171717;
  --node-ip: #626262;
  --node-cert: #8a6a3a;
  --node-payee: #7a3b3b;
  --node-org: #397653;
  --edge-strong: #444444;
  --edge-weak: #c4c2ba;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
}

.dark {
  --background: #090909;
  --foreground: #f2f1ed;
  --surface: #151515;
  --surface-secondary: #202020;
  --surface-inverse: #f2f1ed;

  --border: #303030;
  --border-strong: #3d3d3d;
  --muted: #999999;
  --muted-strong: #b4b4b4;

  --primary: #f2f1ed;
  --primary-foreground: #111111;
  --primary-hover: #e2e1db;

  --danger: #e07a7a;
  --danger-surface: #2a1a1a;
  --warning: #d3a45e;
  --warning-surface: #2a2318;
  --success: #7fb894;
  --success-surface: #17241c;
  --unknown: #9a9a9a;
  --unknown-surface: #1d1d1d;

  --focus-ring: #f2f1ed;
  --focus-offset: #090909;

  --node-domain: #f2f1ed;
  --node-ip: #9a9a9a;
  --node-cert: #d3a45e;
  --node-payee: #e07a7a;
  --node-org: #7fb894;
  --edge-strong: #b4b4b4;
  --edge-weak: #3d3d3d;
}
```

### 2.3 Colour rules

1. No hardcoded hex in components. Only `var(--token)` or Tailwind token classes
   (`bg-surface`, `text-muted`, `border-border`).
2. Semantic colours are reserved for security meaning. Never use `--danger` for a delete button in a
   neutral context unless it is destructive; never use `--success` for a "new" badge.
3. Decision → colour mapping is fixed:

| Decision | Text token | Surface token | Icon |
| --- | --- | --- | --- |
| `BLOCK` | `--danger` | `--danger-surface` | `shield-x` |
| `WARN` | `--warning` | `--warning-surface` | `shield-alert` |
| `ALLOW` | `--success` | `--success-surface` | `shield-check` |
| `REVIEW` | `--unknown` | `--unknown-surface` | `search` |
| `UNKNOWN` | `--unknown` | `--unknown-surface` | `shield-question` |

`ALLOW` is rendered as **"No known threat"**, never "Safe" or "Verified" (BR-002). The icon is a
check inside a shield outline, not a filled green badge.

4. Contrast: text on `--surface` meets 4.5:1; `--muted` is only used at ≥ 14 px and is verified per
   theme. Decorative borders may be 3:1.

---

## 3. Typography

| Role | Family | Size / line-height | Weight |
| --- | --- | --- | --- |
| Display (landing hero) | Geist | 56–72 / 1.02, `clamp()` | 500 |
| H1 | Geist | 32 / 1.15 | 500 |
| H2 | Geist | 24 / 1.25 | 500 |
| H3 | Geist | 18 / 1.35 | 500 |
| Body | Geist | 14 / 1.55 | 400 |
| Body large | Geist | 16 / 1.6 | 400 |
| Label | Geist | 12 / 1.3, `0.02em` tracking | 500 |
| Caption | Geist | 12 / 1.4 | 400 |
| Code / data | Geist Mono | 13 / 1.5 | 400 |
| Numeric display | Geist Mono | 28–40 / 1.1, `tabular-nums` | 500 |

- Loading: `@fontsource` self-hosted, `font-display: swap`, Latin subset only.
- Instrument Sans is reserved for one editorial use (landing section headings) and must not appear
  in the app.
- Numerals in tables, scores and timers always use `tabular-nums` so columns align.
- Maximum body line length 72 characters; the app content column is 1200 px with 720 px text blocks.

---

## 4. Spacing, radius, borders, elevation

### 4.1 Spacing scale (4 px base)

`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128` → Tailwind `0, 0.5, 1, 2, 3, 4, 5, 6, 8,
10, 12, 16, 20, 24, 32`.

Rules:

- Section padding: 64 px (mobile 40) vertical.
- Card padding: 20 px (mobile 16).
- Table cell: 12 px vertical, 16 px horizontal.
- Gap between form fields: 16 px; between field groups: 32 px.
- Never use arbitrary values (`p-[13px]`) without a comment explaining why.

### 4.2 Radius

`--radius-sm` 4 px (badges, inputs), `--radius-md` 6 px (buttons, cards), `--radius-lg` 10 px
(modals, drawers). Pills only for status chips (`999px`).

### 4.3 Borders and elevation

- Default border: `1px solid var(--border)`.
- Emphasis: `1px solid var(--border-strong)`.
- Elevation: **no shadows** except modals/drawers, which use
  `0 24px 48px -24px rgb(0 0 0 / 0.25)`.
- Focus: `2px solid var(--focus-ring)` with `2px` offset; never remove the outline.

---

## 5. Layout grid

- 12-column grid, 24 px gutter, max width 1200 px, page margin 24 px (16 on mobile).
- App: sidebar 240 px + content; content max 1200 px; reading column 720 px.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`.
- Density: default row height 44 px; "compact" 36 px via `useUiStore.density`.

---

## 6. Iconography

Lucide only, 1.5 px stroke, sizes 14/16/20/24. Icons never carry meaning alone: always paired with
text or an `aria-label`. Status icons are fixed per decision (§2.3).

---

## 7. Components

### 7.1 Buttons

| Variant | Background | Text | Use |
| --- | --- | --- | --- |
| `primary` | `--primary` | `--primary-foreground` | One per view: "Run scan", "Confirm report" |
| `secondary` | transparent, `--border` | `--foreground` | Secondary actions |
| `ghost` | transparent | `--muted-strong` | Toolbars, row actions |
| `danger` | `--danger` | white | Destructive: revoke, delete |
| `link` | none | `--foreground`, underline on hover | Inline navigation |

Sizes: `sm` 28 px, `md` 36 px, `lg` 44 px. Icon-only buttons require `aria-label` and a tooltip.
Loading state replaces the label with a spinner + "Working…" and keeps the width stable.

### 7.2 Inputs

- Height 36 px, radius 4 px, 1 px border, 12 px horizontal padding.
- Focus: 2 px ring, border becomes `--border-strong`.
- Error: border `--danger`, message below in 12 px `--danger` with an icon.
- Helper text: 12 px `--muted`.
- Character counters appear only when a limit exists (justification 500).
- Password fields have a reveal toggle that is keyboard reachable.

### 7.3 Tables

- Header: 12 px label, `--muted`, `--surface-secondary` background, sticky on scroll.
- Row hover: `--surface-secondary`; selected row: 2 px left border `--primary`.
- Numbers right-aligned with tabular numerals; decisions rendered with `VerdictBadge`.
- Empty state occupies the table body with an explanation and a primary action.
- On < 768 px, tables become stacked cards with labelled fields (no horizontal scroll for primary data).

### 7.4 Cards and panels

Cards are used for grouping, not decoration: 1 px border, `--surface`, 6 px radius, 20 px padding,
no shadow. A card must have a heading or be a single uniform list. Never nest a card in a card.

### 7.5 Badges and status chips

`VerdictBadge` (decision), `SeverityBadge` (critical/high/medium/low), `StatusPill`
(verified/pending/revoked), `SimulatedBadge` (mandatory on simulated data).

`SimulatedBadge` is `--warning` on `--warning-surface` with the text "Simulated" and a
`title="This data is generated for demonstration and is not a real incident"`. It must appear on:
incident rows, incident detail header, affected-domain table, and CSV export filenames.

### 7.6 Modals, drawers, popovers

- Radix Dialog / Sheet / Popover; focus trapped and restored.
- Modal max width 560 px; drawer 480 px from the right (evidence, node detail).
- Backdrop `rgb(0 0 0 / 0.4)`, no blur.
- Escape closes; clicking the backdrop closes unless the action is destructive in progress.

### 7.7 Navigation

Sidebar items: Overview, Scan, Intelligence, Campaigns, Organisations, Certificates, Reports,
Developers, Settings. Active state: `--surface-secondary` background with a 2 px left rule.
Badge counts (report queue) appear as a small numeral, not a red dot.

### 7.8 Charts (Recharts)

- Palette: `--foreground` for primary series, `--muted` for comparison, semantic colour only for
  alerts.
- No gradients, no 3D, no pie charts. Use horizontal bars for rankings, lines for trends.
- Axis labels 11 px `--muted`; gridlines 1 px `--border` at 30% opacity.
- Every chart has a text summary above it (for screen readers and for judges).

### 7.9 Graph (Cytoscape)

| Element | Style |
| --- | --- |
| Node | 28 px circle, 1.5 px border, label below in 11 px |
| Domain node | `--node-domain` border, `--surface` fill |
| IP node | `--node-ip` |
| Certificate / CA | `--node-cert` |
| Payee | `--node-payee` |
| Organisation | `--node-org`, 34 px |
| Edge | 1 px, opacity = confidence (0.3–1.0), dashed < 0.5 |
| Selected | 2.5 px border + halo ring |
| Layout | `cose` default; `concentric` for campaign view |

Legend is always visible and names every edge type. A "list view" toggle provides an accessible,
keyboard-navigable alternative to the canvas.

---

## 8. Content and copy rules

1. Never say "safe", "trusted", "secure" as a verdict. Use "No known threat in the checks that ran."
2. Always name the mismatch: "asked for `fees@okaxis`; registered is `fees@northstar-demo`".
3. Sentence case for headings and buttons. No exclamation marks.
4. Numbers: risk score as an integer with `/100`; coverage as a percentage; never mix.
5. Dates: relative for recency ("12 min ago"), absolute with timezone on hover and in detail views.
6. Error copy: what happened, what it means, what to do next, and the request ID in a disclosure.
7. Simulated data always says so, in the same breath as the data.

---

## 9. Token enforcement

- `tailwind.config.ts` maps every token to a utility; arbitrary values are lint-flagged.
- A CI check greps `src/**` for `#[0-9a-fA-F]{3,8}` and fails outside `styles/tokens.css`.
- Component review checklist item: "no raw colour, no shadow, no gradient".

---

## 10. Dark mode

- Default follows `prefers-color-scheme`; users can force light/dark in settings.
- Both themes are first-class: every component is checked in both.
- Charts and graph use token colours, so they adapt automatically.
- No pure `#000` or `#fff` in dark mode surfaces (harsh edges); use the palette values above.

---

## 11. Component inventory (minimum set)

`Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `Field`
(label + help + error), `Form`, `Card`, `Panel`, `Table`, `Pagination`, `Tabs`, `Badge`,
`VerdictBadge`, `SeverityBadge`, `StatusPill`, `SimulatedBadge`, `CoverageMeter`, `ScoreDial`,
`FindingRow`, `EvidenceDrawer`, `ScanInput`, `Timeline`, `Toast`, `Modal`, `Drawer`, `Tooltip`,
`EmptyState`, `ErrorState`, `Skeleton`, `Breadcrumbs`, `PageHeader`, `Sidebar`, `GraphCanvas`,
`GraphLegend`, `FilterBar`, `ConfirmDialog`.

Each has: props interface, states (default/hover/focus/active/disabled/loading/error), and a
Storybook-style example in `apps/web/src/components/ui/*.stories.tsx` (OPTIONAL for the demo,
required for components with more than three states).

---

## 12. Acceptance criteria

1. A grep for hex colours outside `tokens.css` returns nothing.
2. Every decision badge renders text + icon + colour and passes a grayscale screenshot check.
3. All text meets 4.5:1 in both themes (verified by an automated contrast test on the token pairs).
4. `ALLOW` never appears as "Safe" anywhere in the UI copy (grep in CI).
5. Simulated data carries `SimulatedBadge` on every surface that displays it.
6. Every interactive element has a visible focus style.
