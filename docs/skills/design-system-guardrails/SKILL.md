---
name: design-system-guardrails
description: Use when adding or changing TrustLens components, tokens, charts, or the extension UI. Enforces token usage, component contracts, and the review gates that keep the monochrome editorial system coherent across web, dashboard and extension.
---

# Design System Guardrails

`DESIGN_SYSTEM.md` defines the system. This skill enforces it. If you are about to hardcode a colour,
invent a component variant, or restyle a badge "just for this page", stop here.

---

## 1. Token law

1. **No hex, rgb or hsl in components.** Only `var(--token)` or a Tailwind class mapped to a token.
2. **No arbitrary spacing.** Use the scale (`p-4`, `gap-6`). `p-[13px]` needs a comment explaining a
   real constraint.
3. **No new token without a reason.** A new token must be used in ≥ 2 places, or it is a local value.
4. **Renaming a token is a breaking change** for the design system: update every usage and note it.
5. Tokens live in exactly one file (`styles/tokens.css`), mapped once in `tailwind.config.ts`.

```css
/* correct */
.badge-danger { background: var(--danger-surface); color: var(--danger); }

/* rejected by review and by CI grep */
.badge-danger { background: #f7e9e9; color: #c03939; }
```

---

## 2. Component contracts

Every component in `components/ui` and `components/domain` documents:

| Field | Required |
| --- | --- |
| Props interface | Yes, named `<Component>Props` |
| States | default, hover, focus, active, disabled, loading, error where applicable |
| Accessibility | role, label, keyboard behaviour |
| Token usage | only tokens |
| Density | behaves at default and compact |
| Theme | verified light and dark |

A component that cannot describe its states is not finished.

---

## 3. Domain component rules

| Component | Must | Must not |
| --- | --- | --- |
| `VerdictBadge` | Render text + icon + colour; expose one screen-reader string | Use a filled green for `ALLOW`; render "Safe" |
| `CoverageMeter` | `role="meter"`, `aria-valuetext`, show percent | Imply certainty beyond coverage |
| `FindingRow` | Severity, title, detail, observed/expected, evidence count, expand | Hide the code entirely (it belongs in details) |
| `ScoreDial` | Mono tabular number + `/100` | Animate a counting-up number |
| `SimulatedBadge` | Appear on every simulated surface, with tooltip | Be dismissible |
| `GraphCanvas` | Legend, list-view toggle, text summary | Be the only way to reach data |
| `EvidenceDrawer` | Source, timestamp, payload (redacted), copy | Show raw headers/cookies |

---

## 4. Review gates (copy into PRs)

- [ ] `grep -rn "#[0-9a-fA-F]\{3,8\}" apps/web/src apps/extension/src` → no hits outside tokens.
- [ ] No `shadow-` class outside modal/drawer.
- [ ] No gradient utilities.
- [ ] Both themes checked on the changed screen.
- [ ] All five states present (loading/empty/error/populated/degraded).
- [ ] Contrast pairs still AA (automated token test green).
- [ ] `ALLOW` copy contains no "safe/secure/trusted".
- [ ] Simulated data carries `SimulatedBadge`.
- [ ] Icons from Lucide only; no emoji.
- [ ] Focus ring visible on every interactive element.

---

## 5. Charts and graph

- Recharts only; no pie charts, no 3D, no gradients.
- Series colours: `--foreground` primary, `--muted` comparison, semantic only for alerts.
- Axis labels 11 px muted; gridlines 1 px at 30% opacity.
- Every chart has a one-line text summary above it (screen readers + narration).
- Graph: node colour by type, edge style by confidence band, legend always visible, list view always
  available. Confidence is encoded in at least two channels (opacity **and** dash pattern).

---

## 6. Extension parity

The popup and overlay use the same tokens, copied into `apps/extension/src/shared/tokens.ts`. They must
match the dashboard's verdict language exactly; the strings live in `copy.ts` and mirror
`apps/web/src/lib/copy.ts`.

Constraints:

- Overlay renders in a shadow root with `all: initial` isolation.
- No external fonts in the overlay (use system stack) to avoid FOUT on hostile pages.
- Overlay must be legible at 320 px and must not exceed 90vh.
- The overlay never steals focus until it blocks an action.

---

## 7. Failure patterns this skill exists to prevent

| Pattern | Consequence | Prevention |
| --- | --- | --- |
| One-off colour for a new severity | Palette drift, inaccessible pairs | Add a token or reuse; never inline |
| Custom badge in a page folder | Two badges that disagree | Import the domain component |
| Green check for `ALLOW` | Product claim we cannot make | VerdictBadge only |
| New shadow for emphasis | Dashboard looks like a template | Border/space instead |
| Chart without labels | Unreadable in a demo screenshot | Checklist item |
| Simulated data unstyled | Judge believes it is real | `SimulatedBadge` required |

---

## 8. Definition of done for UI changes

1. Tokens only; grep clean.
2. Five states implemented.
3. Both themes verified.
4. Keyboard path works end to end.
5. Copy reviewed against the forbidden-words list.
6. Screenshot at 1280×800 **and** 390×844 reviewed by the author (and stated as viewed, or explicitly
   stated as not verified).
