---
name: impeccable-frontend
description: Use when building or reviewing any TrustLens UI — pages, components, the extension popup/overlay, or marketing sections. Encodes the monochrome editorial standard, the five-state rule, and the anti-slop checklist so output looks like a premium security product rather than a template.
---

# Impeccable Frontend

A craft skill, not a component library. It tells you **how to make decisions** so every screen belongs
to the same product. Tokens and component specs live in `docs/04-frontend/DESIGN_SYSTEM.md`; this file
is the judgement layer on top.

---

## 1. The standard in one paragraph

Quiet, precise, expensive-looking. Big type, fine rules, generous space, almost no colour. The product
should feel like an instrument (Linear, Vercel, Stripe docs) — not a "cyber dashboard". If a screenshot
could be mistaken for a template, it is wrong. If removing a decoration loses no information, remove it.

**Test:** cover the logo. Could a judge still tell this is a security investigation tool built by
someone with taste? If not, the layout is doing too little and the decoration too much.

---

## 2. Layout discipline

- **One idea per screen.** The scan report's job is the verdict; the graph's job is the neighbourhood.
  Everything else is secondary and visually quieter.
- **Grid first.** 12 columns, 1200 px max, 24 px gutter. Align to it. Misalignment is the fastest way
  to look amateur.
- **Whitespace is the design.** 64 px between sections, 20 px card padding, 12 px table cells. Do not
  fill space because it is empty.
- **Hierarchy by size and weight, not colour.** A 32 px medium heading beats a coloured banner every
  time.
- **Density where data lives, air where prose lives.** Tables can be tight; an empty state needs room.
- **No nested cards.** A card inside a card reads as a wireframe.
- **One primary action per view.** Two primaries means neither is primary.

---

## 3. Typography craft

- Display 56–72 px only on the landing hero; app H1 is 32 px.
- Line length 60–72 characters for prose; never full-width paragraphs at 1200 px.
- `tabular-nums` on every number in a table or score. Misaligned digits look careless.
- Label size 12 px, uppercase only for tiny eyebrow labels — never for buttons.
- One editorial typeface accent (Instrument Sans) on the landing page; none inside the app.
- Sentence case everywhere. No Title Case Headings, no ALL CAPS SENTENCES.

---

## 4. Colour craft

- Default to ink on ivory. Colour is an event, not a background.
- Semantic colour only for security meaning: `BLOCK` red, `WARN` amber, `ALLOW` green **outline**,
  `REVIEW`/`UNKNOWN` grey.
- Never a green filled badge for `ALLOW`. It reads as "safe", which we forbid.
- Status needs text + icon + colour. Greyscale the screenshot: can you still tell the states apart?
- Borders do the work shadows would do elsewhere. 1 px, `--border`, everywhere.
- Dark mode is designed, not inverted: no pure black, no pure white text.

---

## 5. The five-state rule

Every data surface implements **all five**:

| State | Requirement |
| --- | --- |
| Loading | Skeleton matching the final layout (no spinner-only screens) |
| Empty | One sentence explaining why it is empty + the action that fills it |
| Error | What failed, what it means, a retry, and the request ID in a disclosure |
| Populated | The real thing, with sensible truncation |
| Degraded | A dependency is down: partial data with an explicit banner |

A screen with only "populated" is unfinished. This is the single most common failure in generated UI.

---

## 6. Data display craft

- Numbers right-aligned; text left-aligned; never centre a column of data.
- Truncate URLs in the middle (`apply.northstar-…example/register`), full value on hover/copy.
- Always show units and denominators: `62/100`, `85% coverage`, `4 days old`.
- Show the *observed* and the *expected* side by side when a mismatch drives the verdict. That pairing
  is the product's most persuasive UI moment — give it space.
- Confidence is a number with a bar, not a vibe. Never hide it.
- Timestamps: relative for recency, absolute in detail; never ambiguous time zones.

---

## 7. Motion craft

- Motion explains change; it never performs. 140–320 ms, standard easing, no bounce.
- Nothing animates that the user needs to read. No counters ticking up, no staggered table rows.
- Reduced motion is a first-class state, not an afterthought.
- One animated moment per screen at most. On the landing page, the hero; in the app, the drawer.

---

## 8. Copy craft

- Say what happened, what it means, what to do. Three clauses, no jargon.
- Name the specific values: "asks for `fees@okaxis`; registered is `fees@northstar-demo`".
- Never "safe", "secure", "trusted" as a verdict. Use "No known threat — 85% of checks ran."
- No exclamation marks, no emoji, no "Oops".
- Buttons are verbs: "Run scan", "Confirm report", "Revoke key". Not "Submit", not "OK".
- Errors own the problem: "We could not reach the site" — not "Invalid input".

---

## 9. Anti-slop checklist (reject your own work)

| Smell | Fix |
| --- | --- |
| Purple/blue gradient hero | Ink on ivory, one accent at most |
| Glassmorphism cards | 1 px border, flat surface |
| Neon green terminal block | Mono text in `--surface-secondary` with a fine border |
| Emoji status icons | Lucide, 1.5 px stroke, paired with text |
| Every card has a shadow | Remove all shadows except modals/drawers |
| 3 competing accent colours | One semantic colour per state |
| Generic "Dashboard" heading | Name the job: "Overview", "Scan report", "Campaign" |
| Fake data in empty states | Real empty copy + the action to populate |
| Chart with no axis labels | Label axes, add a one-line text summary |
| Centered everything | Left-aligned editorial layout with a deliberate grid |
| Placeholder lorem ipsum | Real product copy, always |

---

## 10. Component patterns to reuse

```tsx
// Verdict — the canonical composition
<section aria-labelledby="verdict-title" className="border border-border bg-surface rounded-md p-5">
  <div className="flex items-start justify-between gap-6">
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Decision</p>
      <h2 id="verdict-title" className="mt-1 text-2xl font-medium">Blocked</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-strong">
        This page asks for fees@okaxis. Northstar University has registered fees@northstar-demo.
      </p>
    </div>
    <div className="text-right">
      <p className="font-mono text-3xl tabular-nums">62<span className="text-muted text-base">/100</span></p>
      <CoverageMeter percent={85} />
    </div>
  </div>
</section>
```

Rules embodied: heading carries the meaning, prose names the values, score is mono and tabular,
coverage is adjacent to the score, no colour needed to understand it.

---

## 11. Before you call it done

- [ ] Aligned to the 12-column grid; nothing off by 4 px.
- [ ] All five states implemented.
- [ ] Greyscale screenshot still communicates every status.
- [ ] Every number tabular and labelled with its denominator.
- [ ] No hex colour, no shadow, no gradient outside tokens.
- [ ] Keyboard: every action reachable, focus visible, `Esc` closes overlays.
- [ ] 360 px width does not scroll horizontally.
- [ ] Copy passes the "no safe/secure/trusted" check.
- [ ] One primary action.
- [ ] Would survive being screenshotted next to Linear without embarrassment.
