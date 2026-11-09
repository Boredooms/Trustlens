# Frontend handover: rebuild the public landing page

Paste this whole file as the brief for the agent or editor that builds the landing page. It is
self-contained. Work happens in this repository (`apps/web`) on a new branch. **Do not push or merge**
without the owner's go-ahead.

---

## 1. Goal

Replace the current public landing page (`/`) with a premium marketing site for TrustLens in four
sections, in this order: **Hero → Features → About → Docs**, plus the existing footer. It should read
like a serious security-research product: confident, precise and calm. No hype.

Also make the TrustLens logo in the dashboard sidebar link to the landing page (see §6).

## 2. What TrustLens is (copy must stay true to this)

- TrustLens checks whether a page is **authorised** to ask for a password, a payment or personal data.
  It compares what the page does (where the form posts, which payee it shows) with what the real
  organisation has registered. It is not a URL reputation list.
- **The risk engine decides; the AI only explains.** Verdicts are deterministic rules. The LLM writes
  prose that must cite finding ids.
- **"ALLOW" never means "safe".** Never write "safe", "trusted" or "verified site" for an ALLOW result.
  Write "no known threat within the checks we ran", and mention coverage.
- **Reports can be anchored** as salted hash commitments, and anyone can verify them at `/verify/<id>`.
  The hosted demo uses a **simulated registry** (labelled simulated; not a public blockchain). Never
  imply mainnet or "on Ethereum".
- Surfaces: web dashboard, Chrome extension (one-click pairing; holds Pay/Sign-in until the server
  decides), SDK (`npm install @boredooms/trustlens-sdk`), public verify page.

Facts and wording sources (read them, do not invent):

- `README.md`: what's in the box, the live URLs, the block flow, limitations.
- `docs/evidence/TESTING_REPORT.md`: the observed results table. These are the only numbers you may quote.
- `docs/02-architecture/WEB3_REGISTRY.md` §1 and §7.1: what the registry proves and what it doesn't.
- `apps/web/src/routes/public/InfoPages.tsx`: the existing How it works, Developers and Security copy.

No invented metrics ("99.9% accuracy", "millions of sites", user counts, logos of customers). If a
number isn't in the testing report, leave it out.

## 3. Sections

1. **Hero**
   - Headline about authorisation, not reputation. The existing page title is "the padlock is not an
     identity", and the idea can stay.
   - One-line subhead, plus primary CTA "Open dashboard" (`/app`; shown as "Sign in" when signed out)
     and secondary CTA "See how it works" (scrolls to Features).
   - Visual: a calm, code-drawn depiction of the block moment. A page asks you to pay `fees@okaxis`;
     the organisation registered `fees@northstar-demo`; the result is "Payment stopped". Use CSS/SVG
     only, with no screenshots that could leak data. Animate it with GSAP once on load, then hold.
2. **Features**: four to six cards. Action-integrity checks (credential destination, payee), TLS
   certificate analysis (misconfiguration vs trust compromise), AI message analysis with cited
   evidence and the language-alone cap, threat correlation (campaigns, entity graph), browser
   extension, SDK. Use ScrollTrigger reveals, one per card group, not per word.
3. **About**: the method in three steps (collect → rules decide → explain and report), the "what we
   cannot see" honesty block, and who built it (repo link: `https://github.com/Boredooms/Trustlens`).
4. **Docs**
   - A grid of entry points:
     - How it works (`/how-it-works`)
     - Developers and SDK (`/developers`, including `npm install @boredooms/trustlens-sdk`)
     - Security (`/security`)
     - Verify a report (`/verify/<id>` explained)
     - API health (`https://trustlens-api-m65a.onrender.com/ready`)
     - GitHub docs (`docs/INDEX.md` on GitHub)
     - Extension download (GitHub release asset `trustlens-extension-production.zip`)
   - Each card has a title, one sentence and a link.
5. **Footer**: keep the existing footer navigation (see §8: a test depends on it).

## 4. Stack (all already decided; do not substitute)

| Use | Library | Rule |
| --- | --- | --- |
| Styling | Tailwind **v3** + `apps/web/src/styles/tokens.css` | **Do not** install Tailwind v4 or `@tailwindcss/postcss`; that breaks the Vercel build. No raw hex outside `tokens.css` (`node scripts/check-tokens.mjs` enforces it). New visual needs become tokens. |
| Primitives | Radix + shadcn-style parts in `src/components/ui` | Reuse what exists. New shadcn parts are copied into `src/components/ui` (owned source, typed, linted). Lowercase file names must not collide case-insensitively with existing ones (`Button.tsx` and `Card.tsx` already export the shadcn APIs). |
| UI motion | `motion` (already installed, `import { m } from "motion/react"`) | Hover, press, small reveals. |
| Scroll narrative | **GSAP 3 + ScrollTrigger** | Public landing only (TECH_STACK.md §3.7). Load it lazily on the landing route. Create animations inside `gsap.context()` and `revert()` them on unmount. |
| Smooth scroll | **Lenis** (`lenis` package) | Public landing only. Never in `/app/*`. Destroy it on unmount. Sync it with ScrollTrigger via `lenis.on('scroll', ScrollTrigger.update)` and drive it from `gsap.ticker`. |
| Fonts | Instrument Serif (display) + Geist Sans/Mono | Already installed; no third family. |
| Icons | lucide-react | Only this set. |

Pin exact versions for anything new (`gsap`, `lenis`), and say why in the PR. Three animation libraries
is the maximum; nothing else (no Three.js, no AOS, no Locomotive). Read
`docs/04-frontend/ANIMATION_GUIDELINES.md` and `docs/04-frontend/DESIGN_SYSTEM.md` first. Note that
DESIGN_SYSTEM §7.8 still says "Recharts", which is stale. Charts are Bklit (`src/components/charts`), but
the landing page needs no charts.

## 5. Quality bar

- **Reduced motion:** with `prefers-reduced-motion: reduce`, no Lenis, no scroll-linked motion, and
  content visible immediately.
- **Performance:**
  - GSAP and Lenis must not appear in any `/app` chunk; check `vite build` output.
  - Hero LCP is text, not an image.
  - No layout shift from fonts or animations (CLS ≈ 0).
- **Accessibility:**
  - One `h1`, ordered headings, visible focus, keyboard reachable CTAs.
  - Sections are landmarks with labels, contrast meets AA in both themes, and the hero visual has a
    text alternative.
- **Dark mode:** every surface switches with the existing theme controller; no white cards in dark mode.
- **Responsive:** 360 px to 1440 px+, with no horizontal scroll.
- **No secrets** and no live tokens in copy, screenshots or code. The only URLs used are the public
  ones listed here.

## 6. Exact file scope

You may change:

- `apps/web/src/routes/public/Landing.tsx` (rewrite)
- new files under `apps/web/src/components/marketing/` (hero, feature grid, about, docs grid, scroll hooks)
- `apps/web/src/components/layout/PublicShell.tsx` (header and nav styling only; keep the footer links)
- `apps/web/src/styles/tokens.css` (add marketing tokens only; do not change existing values)
- `apps/web/src/styles/globals.css` (Lenis base rules, e.g. `html.lenis` and `.lenis-smooth`)
- `apps/web/package.json` and `pnpm-lock.yaml` (add `gsap` and `lenis`, pinned)
- `apps/web/src/components/ui/app-1-utils/app-1-sidebar.tsx`, line with
  `<Logo to="/app" …>`: change it to `to="/"` so clicking the logo in the dashboard opens the landing
  page. Nothing else in that file.
- tests under `apps/web/src/routes/public/`

Do **not** touch:

- `apps/api/**`
- `apps/extension/**`
- `packages/**` (including the generated `packages/shared-types`)
- any `/app/*` route or its components (except the one logo line)
- auth (`src/lib/auth`), API client (`src/lib/api`), `vercel.json`, CI workflows and `infrastructure/`

## 7. Live context (for links only)

- Dashboard: https://trustlens-web-three.vercel.app (Clerk sign-in, then `/app`)
- API health: https://trustlens-api-m65a.onrender.com/ready
- Live demo fixtures (labelled simulated phishing test pages):
  - https://trustlens-demo-admissions.vercel.app/pay
  - https://trustlens-demo-placement.vercel.app
- Repo: https://github.com/Boredooms/Trustlens

## 8. Definition of done

```bash
pnpm --filter @trustlens/web typecheck
pnpm --filter @trustlens/web lint        # eslint --max-warnings=0 + token guard
pnpm --filter @trustlens/web test        # vitest; keep "footer links reach every public page" passing
pnpm --filter @trustlens/web build       # then confirm gsap/lenis appear only in the landing chunk
```

- Add tests:
  - the four sections render with their headings;
  - the CTAs point to `/app` and `/how-it-works`;
  - the sidebar logo links to `/`;
  - with reduced motion, the hero content is visible without animation.
- Hand back screenshots (light and dark, desktop and mobile) and the list of files changed.
- Commit on a branch named `feat/landing-rebuild`. Do not push; the owner decides.
