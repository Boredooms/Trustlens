# LANDING_PROMPT — single-page hero landing rebuild

**Paste this whole file into the next session.** It supersedes the older four-section landing handover
(Hero → Features → About → Docs + footer). Where the two disagree, this file wins.

**Scope in one line:** rebuild the public landing page as **one screen** — nav + hero, nothing else, no
footer — using OriginKit `hero-19` and ReactBits as material, restyled through the existing design
tokens. No dashboard changes. No colour-token value changes. No backend changes. Nothing pushed.

---

## 1. Non-negotiables

1. **Do not touch the dashboard.** No `/app/*` route, no dashboard component, no sidebar, no much else.
   The only exception is explicitly listed in §6 (and it is optional — see the note there).
2. **Do not change existing token values.** `apps/web/src/styles/tokens.css` may gain *new* marketing
   tokens if genuinely needed, but every existing colour/radius/shadow value stays byte-identical. The
   page must look like TrustLens, not like a new brand.
3. **No raw hex outside `tokens.css`.** `node scripts/check-tokens.mjs` enforces this and must pass.
4. **Tailwind stays v3.** Do not install Tailwind v4 or `@tailwindcss/postcss`. That breaks the Vercel
   build. This is the single most common way this repo breaks.
5. **One page, no footer.** The deliverable is a single landing screen. If you find yourself building a
   Features section, an About section or a Docs grid, stop — that is the old brief.
6. **No secrets in files.** The OriginKit API key is supplied at run time through the environment. It
   must never be written into the repo, `.env.example`, a component, a screenshot, a commit, or a log.
   It was pasted in chat once already, so the owner should rotate it — say so in your report.
7. **Nothing pushed, nothing deployed.** Work locally. A local branch and local commit are fine; `git
   push` is not, and no deploy command runs.
8. **No backend work.** No API, extension, SDK, `packages/**`, migrations, env wiring, or deployment
   config changes. If the page needs data, it uses copy and links, not new endpoints.

---

## 2. Read before writing (fast, but do not skip)

- `docs/04-frontend/DESIGN_SYSTEM.md` — layout, type scale, the five-state rule, token law.
- `docs/04-frontend/ANIMATION_GUIDELINES.md` — motion grammar and what belongs on the public page.
- `docs/DASHBOARD_REBUILD_PROMPT.md` §1–§2 — the stack decisions already made (motion lib, token
  discipline, no second design system).
- `README.md` — the product statement and the live URLs you may link.
- `docs/evidence/TESTING_REPORT.md` — **the only** numbers you are allowed to quote.
- `apps/web/src/routes/public/Landing.tsx` — the page you are replacing (124 lines).
- `apps/web/src/components/layout/PublicShell.tsx` — header/nav and the footer you are removing.
- `apps/web/src/styles/tokens.css`, `apps/web/src/styles/globals.css`, `apps/web/tailwind.config.ts`.
- `apps/web/components.json` — where the ReactBits registry entry goes.
- `apps/web/src/routes/public/info.test.tsx` — it asserts the footer reaches every public page, but it
  renders `/how-it-works`, `/developers` and `/security`, not `/`. So if you remove the footer only on
  the landing route, this test keeps passing and must **not** be modified.

State your reading of the docs in two lines before you start coding, so drift is visible early.

---

## 3. What the page is (copy rules)

TrustLens checks whether a page is *authorised* to ask for a password, a payment or personal data — it
compares what the page does with what the real organisation registered. It is not a URL blocklist.

- **The risk engine decides; the AI explains.** Verdicts are deterministic rules; the model writes prose
  that must cite finding ids.
- **`ALLOW` never means "safe".** Never write "safe", "trusted" or "verified site". Write "no known
  threat within the checks we ran" and mention coverage.
- **Reports can be anchored** as salted hash commitments and verified at `/verify/<id>`. The hosted demo
  uses a **simulated registry**, labelled as such. Never imply a public mainnet or "on Ethereum".
- **No invented metrics.** No accuracy percentages, user counts, customer logos, "millions of sites".
  If a number is not in `docs/evidence/TESTING_REPORT.md`, it does not appear on this page.
- Tone: calm, precise, security-research. Not hype, not growth-marketing, no exclamation marks.

---

## 4. The page, section by section

### 4.1 Header (the only navigation)

One slim top row. Left: the TrustLens logo/wordmark linking to `/`. Centre or right: the public links
that used to live in the footer — **How it works** (`/how-it-works`), **Developers** (`/developers`),
**Security** (`/security`), **Verify a report** (explains `/verify/<id>`). Right: **Sign in** (`/login`)
and one primary action **Open dashboard** (`/app`).

- Collapses cleanly to a single row at 360 px, with a menu if the links cannot fit. No horizontal scroll
  at any width.
- Keyboard reachable, visible focus, `aria-current` on the active link.
- Because there is no footer on this page, **these links are the only path to the public pages from the
  landing screen** — nothing may become unreachable. Other public pages keep the shared footer, so the
  existing footer test still guards them.

### 4.2 Hero (the whole page body)

Recreate the *structure* of the reference image — do **not** copy its brand, imagery, wellness content or
its orange palette:

- Dark field (existing dark surface tokens), one large radial glow behind the central object, serif
  display headline on the left, generous negative space, a small meta row of facts, nav at the top.
- The glow must be built from **existing accent tokens at low alpha**, not a new orange. If the result
  reads as a different brand, reduce the saturation rather than adding a colour.

Content:

- **Headline** (serif display, the visual anchor — the largest type on the page). The idea to convey:
  *the padlock is not an identity*. Two to three short lines, not a paragraph.
- **Subhead**: one or two sentences. Authorisation vs reputation, in plain words.
- **Primary CTA** `Open dashboard` → `/app` (label reads `Sign in` → `/login` when signed out).
  **Secondary CTA** `See how it works` → `/how-it-works`. Both keyboard reachable, 44 px+ targets.
- **The visual**: a code-drawn depiction of the block moment — a page asks for `fees@okaxis`, the
  organisation registered `fees@northstar-demo`, result: *Payment stopped*. CSS/SVG only, no screenshots
  of real sites, no live data. This must be legible as a diagram, not decorative filler, and must carry
  a text alternative for screen readers.
- **Meta row**: three or four short facts only — e.g. "deterministic rules", "certificate analysis",
  "verifiable reports". No numbers unless they are in the testing report.
- A scroll cue is allowed **only if** the page is taller than the viewport; if the hero fits one screen,
  omit it (there is nothing to scroll to).

The hero must **fit one screen** at 1440×900 and remain readable at 360 px wide without clipping the
headline or the CTA row.

---

## 5. Stack and material

| Use | Rule |
| --- | --- |
| Styling | Tailwind **v3** + existing `tokens.css`. No raw hex outside tokens. |
| Primitives | Reuse `src/components/ui/*` (Button, Card, Badge, etc.). Do not add a competing design system. |
| UI motion | `motion` (installed, `motion@14.10.1`) — hover, press, small entrances. |
| Scroll/motion narrative | **`gsap` is not installed.** Install pinned only if you actually use a timeline; load it lazily on the landing route only. Never in the `/app` chunk. |
| Smooth scroll | **`lenis` is not installed.** Optional. If installed, landing route only, `prefers-reduced-motion` disables it, and it is destroyed on unmount. |
| Fonts | Existing pairing only (Instrument Serif display / Geist Sans+Mono). No new family. |
| Icons | `lucide-react` only. |
| Charts | None on this page. Do not add Recharts or a second chart library. |

If GSAP or Lenis is not worth the dependency for a single hero, **skip it** and use `motion` alone —
saving 100 KB matters more than a scroll effect on a one-screen page. Say which you chose and why.

---

## 6. OriginKit `hero-19` and ReactBits

### 6.1 OriginKit

The owner wants `hero-19` from OriginKit as the starting point.

```bash
# Run from the repo root. Supply the key from the environment for this one command only.
export ORIGINKIT_API_KEY="<owner supplies at run time>"
npx originkit@latest add hero-19
```

Rules for what the command writes:

- The key is **never** written into the repo, a config file, a component, a shell history file that is
  committed, or a log. If the CLI writes it anywhere, remove it before staging, and say where it went.
- The generated component is **vendored source you now own**. It must be moved to
  `apps/web/src/components/marketing/` (or `src/components/ui/` if it is a primitive), typed, linted,
  and adapted to TrustLens tokens. A generated component with raw hex, its own colour system, its own
  font or its own animation library is not acceptable as-is — adapt it or replace it.
- If `hero-19` arrives with a heavy dependency (three.js, a slider library, another motion system), stop,
  report what it pulls in, and rebuild the same layout by hand with `motion` + Tailwind instead.
- Keep the imported layout/approach, not the demo copy. All copy is rewritten per §3.

### 6.2 ReactBits

Add the registry to `apps/web/components.json`:

```json
{
  "registries": {
    "@react-bits": "https://reactbits.dev/r/{name}.json"
  }
}
```

- Use **two or three** pieces at most (e.g. a text reveal for the headline, one background/glow effect,
  one button or card treatment). Each is copied-in source: type it, lint it, adapt it to tokens.
- Skip anything that requires `three`/`ogl`/WebGL, anything that duplicates the motion library, and
  anything that ships its own colour palette. A hero does not need a 3D scene.
- If a ReactBits piece conflicts with the token guard or the Tailwind v3 setup, adapt or drop it — do not
  weaken the guard.

---

## 7. Files you may change

- `apps/web/src/routes/public/Landing.tsx` — rewrite.
- New files under `apps/web/src/components/marketing/` (hero, nav pieces, the block-moment visual).
- `apps/web/src/components/layout/PublicShell.tsx` — **nav and shell only**. The footer is shared by
  `/how-it-works`, `/developers`, `/security`, `Verify`, `Appeal` and `Login`, so it must **stay**. Remove
  it **only** for the landing route: add a single prop (e.g. `footer={false}`) or a pathname check, and
  wire it at the one landing route in `apps/web/src/app.tsx` (a one-line change to that route element is
  allowed; no other route may change).
- `apps/web/src/styles/globals.css` — lenis base rules only if you add Lenis.
- `apps/web/src/styles/tokens.css` — **new** marketing tokens only; no existing value changes.
- `apps/web/package.json` + `pnpm-lock.yaml` — only if you install `gsap`/`lenis`, pinned, with a reason.
- `apps/web/components.json` — the ReactBits registry entry.
- `apps/web/src/app.tsx` — **one line only**: pass the landing-only shell prop for the `/` route.
- New test file under `apps/web/src/routes/public/` for the landing page. Do **not** edit
  `info.test.tsx`: its footer assertion must keep passing on the info pages.

**Do not change:** `apps/api/**`, `apps/extension/**`, `packages/**`, any `/app/*` route or dashboard
component, `src/lib/auth`, `src/lib/api`, `vercel.json`, CI workflows, `infrastructure/`, or any existing
colour token value.

The dashboard-sidebar logo change from the old brief is **out of scope for this run** — this run is the
landing page only. If you believe the logo should link to `/`, list it as a one-line follow-up instead of
editing the dashboard.

---

## 8. Quality bar

- **Reduced motion:** with `prefers-reduced-motion: reduce` the hero is fully visible immediately, no
  scroll effects, no Lenis.
- **Performance:** hero LCP is text; no layout shift from fonts or animation (CLS ≈ 0); GSAP/Lenis (if
  installed) must not appear in any `/app` chunk — verify against `vite build` output.
- **Accessibility:** exactly one `h1`; ordered headings; visible focus; labelled landmarks; AA contrast
  in both themes; the block-moment visual has a text alternative; CTAs reachable by keyboard.
- **Dark and light both work** (the page is dark-first, but must not break in light).
- **Responsive:** 360 px → 1440 px+, no horizontal scroll, headline not clipped, CTA row not wrapped
  awkwardly.
- **No dead ends:** every link resolves to a real route or a documented public URL.

---

## 9. How to work (time is short)

1. Read §2's docs (skim fast, note the rules).
2. Install OriginKit `hero-19`, inspect what it wrote, adapt to tokens, move it into
   `src/components/marketing/`.
3. Add two or three ReactBits pieces to `components.json`, pull only what the hero needs.
4. Build the header + hero. Resist adding sections.
5. Run the checks in §10, fix what fails, capture screenshots.
6. Report. Do not push, do not deploy.

Work in small steps and keep typecheck green between them; this repo has strict TS and a lint gate at
`--max-warnings=0`.

---

## 10. Definition of done

```bash
pnpm --filter @trustlens/web typecheck
pnpm --filter @trustlens/web lint     # eslint --max-warnings=0 + token guard
pnpm --filter @trustlens/web test     # rewritten nav-reachability test must pass
pnpm --filter @trustlens/web build    # then confirm no gsap/lenis in the /app chunk
```

Tests to add or update:

- the hero renders headline, subhead, and both CTAs with the right `href`s (`/app` or `/login`,
  `/how-it-works`);
- the landing page's nav links reach `/how-it-works`, `/developers`, `/security` and the verify
  explanation, and the existing `footer links reach every public page` test still passes unchanged;
- with reduced motion, hero content is visible without animation;
- one `h1`, and the hero visual exposes a text alternative.

Hand back:

- screenshots: light + dark, desktop + 360 px;
- the list of files changed and any dependency added, with the reason;
- what OriginKit wrote and what you had to adapt or remove;
- anything you could not do (missing key, CLI failure, component that needed a heavy dep);
- a one-line follow-up list (e.g. dashboard logo link) that you deliberately left out of this run.

Local branch `feat/landing-hero`, local commit only. **No push, no deploy.**

---

*Reminder to the owner: the OriginKit key was pasted in plain text in chat. Rotate it after this run.*
