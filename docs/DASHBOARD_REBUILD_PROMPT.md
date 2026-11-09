# DASHBOARD_REBUILD_PROMPT — premium, agent-assisted, observability-grade dashboard

**Purpose.** This session rebuilds the TrustLens application dashboard into a premium, opinionated,
polished, observability-grade experience: block-editor-style panels for narratives and investigation
notes, live charts for risk, verdict, certificate and header data, scroll/transition polish, a
tooling-driven design token system, and an agentic coordination layer that *coordinates and explains*
without ever making security verdicts. Security verdicts stay in `apps/api/app/risk/`.

**Read first (before any UI code):**
- `docs/MASTER_PROMPT.md` — state, traps, machine state.
- `docs/BUILD_PROMPT.md` — the four gap modules and their acceptance bars; the risk vocabulary and
  the rule that AI never invents a finding.
- `docs/handover/HANDOVER.md`, `docs/handover/PROGRESS_LOG.md` — current state.
- `apps/web/src/lib/auth/AuthProvider.tsx` — the session/redirect decision, so the rebuilt dashboard
  keeps auth working.
- `apps/web/src/lib/` — current hooks and API helpers, so you reuse them instead of replacing them.
- `apps/web/src/app.tsx` — current route tree.
- `package.json` (root + `apps/web/package.json`) and `package-lock.yaml` — you must verify what is
  already installed before pulling anything new.
- `.env.example` / `.env.local` — names only, never values, never a secret on the client.

**Hard rules for this session**
1. Do not add a dependency unless it is already in the lockfile, or unless you document the exact
   need and the alternative considered. A staggering pile of one-trick packages is the opposite of
   premium. The brief names libraries as *desired*, not as a license to install whatever.
2. Nothing that makes a security verdict lives on the client and nothing that re-ranks the engine's
   decision lives in the agent layer. Agentic code coordinates, annotates, explains, summarises,
   narrates a human-readable entry point, and summarizes history. It never re-decide a scan.
3. No scan result, no PII, no chain commitment in any URL, log, console, screenshot-capable surface,
   or demo trace. Secrets stay on the server.
4. Premium means design coherence, not decoration. One token system, consistent spacing, consistent
   motion grammar, consistent empty/error/loading states, and zero "similar but different" widgets.
5. Accessibility and performance are not optional. Charts must be usable without motion, must give
   numeric context, and must render from real data. Text must be readable under the motion polish.
6. The dashboard must be usable with zero client-side secrets: all API calls go through the existing
   client/http layer over the user's authenticated session; nothing new fetches its own token.

---

## 1. The stack (declare what you actually use; verify first)

Default direction (choose exact packages only after confirming presence in lockfile; if a named item is
absent, either install it with a note, or substitute the closest equivalent already present):

- React 18/19 app, `apps/web`, keep the existing Vite + Tailwind + the existing `shadcn/ui` setup.
- **Design tokens:** one `tokens` source of truth (design tokens: color, spacing, radii, motion, type
  scale), consumed by Tailwind `theme` + any Shadcn overrides + chart themes, so the whole dashboard
  reads from one place. Document it.
- **Chakra UI** (`@chakra-ui/react`, `@emotion/react`, `@emotion/styled` if already present or needed):
  use for *rich interactive panels* where a declarative accessible API helps (slide-over panels,
  rich text toolbars, status centers, accessible form surfaces). Do not mix two design systems on the
  same widget. If the team has a firm preference for Shadcn everywhere, prefer Shadcn + Radix primitives
  and treat Chakra as optional.
- **Radix UI** primitives where accessibility matters (dialogs, popover, tabs, dropdown, tooltip,
  select, switch, checkbox) — either via Shadcn wrappers or directly. This is the accessibility spine
  of the premium feel.
- **Framer Motion** (`framer-motion`) for motion: layout transitions, panel entrances, data updates,
  scroll-linked reveals. A single motion grammar, no random per-widget animation.
- **GSAP** (`gsap`) only where a timeline/sequence/stagger is genuinely better than Framer Motion —
  page structure reveals, hero scroll sequences, entrance choreography. Not for every widget.
- **Charts:** a single chart library across the dashboard for consistency. Prefer one of:
  - Nivo (`@nivo/*`) for rich, flexible, composable charts, **or**
  - a chart library already in the lockfile, **or**
  - a lightweight custom SVG layer only for the few dashboard charts that need it.
  Pick one and document the choice. All charts share scales, legends, axes grammar, empty states, and a
  shared "data context" popover (show the underlying numbers on hover/focus).
- **UI primitives / "21st.dev style" component discipline:** high-grade surface tokens, refined
  knobs, generous spacing, subtle depth, restrained motion, clear hierarchy, polished micro-interactions,
  keyboard focus visibility, reduced-motion handling. If 21st-dev components are actually imported and
  available, use them where they fit; otherwise implement the same *standard* with your own or Shadcn/
  Radix-based components. Do not claim "21st.dev" components are used when they aren't.
- **Routing:** React Router (`react-router-dom` / `@remix-run/router`) — do **not** treat it as a chart
  or data library. It stays as the app router.
- **State/data:** keep existing API client + hooks. Add only the coordination/orchestration layer from
  §3.

If a package in the above list is not in `package.json`/`pnpm-lock.yaml`, stop and tell the user before
installing, listing each candidate with the rationale. Do not silently install 15 packages "to be safe."

---

## 2. The dashboard experience — what "premium" means here

The dashboard is the face of the whole product. It must feel like a premium security/observability tool,
not like a form with badges on it.

**Material destinations (implement these for real):**

1. **Home / overview panel** — the first screen after sign-in. Real summary of the user's recent
   activity: recent scans, recent verdicts, risk overview, any pending reviews, any certificates or
   headers worth attention. Charts where they earn their place (risk over time, verdict distribution,
   top indicator groups). Empty state for a new user that still feels complete, not blank.
2. **Scan report panel** — the main investigation view. Clean reading of verdict, risk class, score,
   finding groups, evidence with source + timestamp, certificate depth, header posture, intel hits,
   narrative, and (where applicable) the on-chain proof panel. No walls of text. Each piece owns its
   place.
3. **Campaigns / intelligence panel** — correlation, campaign view, intelligence matches. Charts where
   they clarify relationships.
4. **Certificates panel** — certificate history, trust events, advisories, simulated advisories clearly
   labelled. Make the "misconfigured vs trust-compromised" distinction visible in the UI, not just in
   prose.
5. **Messages / scam analysis panel** — paste a message, see extracted indicators inline, link scans
   attached, narrative, and the O-8 cap reason when applicable.
6. **Reports / verification panel** — filed reports, anchor status, public verification link.
7. **Settings / account / audit** — coherent, polished, not tacked on.

**Each panel must own:**
- A clear title, a one-line purpose, and a restore-path for where you came from.
- A loading state, an error state, an empty state, and a "no data yet" state. All four, styled to the
  same standard.
- Keyboard focus visibility.
- Reduced-motion compatibility.
- A predictable, consistent toolbar/actions placement.

**Motion grammar (one, documented):**
- Entrance stagger for lists of findings/evidence/history.
- Layout transitions for panel opens/slide-overs.
- Subtle data-update motion for live-ish changes (score, verdict), never distracting.
- Scroll-linked reveals sparingly, GSAP-driven where a timeline is genuinely better, Framer Motion
  elsewhere.
- Respect `prefers-reduced-motion`; never block content behind motion.

**Typography and color:**
- One type scale, one color token set, one semantic layer (text/foreground, muted, accent, destructive,
  success, warning, card/surface), one radii/spacing scale, one shadow/depth grammar.
- Charts share the dashboard palette, not their own per-chart palette.
- Dark/light handling consistent; if both are supported, both must meet the same standard.

**Editing surface (block-editor style):**
- Investigation notes, narratives, and campaign notes should support an editor experience that feels
  like a high-grade block editor (Notion-class): blocks, headings, lists, links, inline highlights,
  drag-free but ordered editing, focus states, keyboard navigation, accessibility. If a real block-editor
  library is available and fits, use it; otherwise build a disciplined block model. Do not paste HTML
  blobs for these surfaces.
- Never let the editor invent findings or verdicts — it edits notes/history, not security conclusions.

---

## 3. Agentic layer — coordination, explanation, and observability (not verdicts)

This is the "langchain-like / agentic framework" part. Do it as a **coordinator+orbits** pattern, not as
a mystery agent that may or may not decide things.

**What the agent layer does:**
- **Correlation orchestration:** when a user views a scan, the layer can assemble related context —
  related domains, campaigns, prior reports, certificate history, header story — and surface it in the
  dashboard as *linked context*, not as new findings. Any new observation still has to come from a real
  service and be displayed with its source.
- **Investigation assistant:** a workspace where the user can ask "what does this mean?" and get an
  explanation built from the existing evidence pack and narrative system — citing findings by code,
  citing sources, and explicitly noting what is unavailable. This reuses the existing `agents/` narrative
  discipline: explanation from evidence, no invented findings.
- **Action planner / workflow (optional but desirable):** present next-step actions the user might take
  (re-scan, add to campaign, file a report, annotate) as a concise, coherent menu/workflow, with audit
  that the user actually chose them. The agent proposes actions; the user executes them.
- **Summarisation/orbits:** historical summaries, trend summaries, and "what changed since last visit"
  views built from stored data, not from re-running the engine on old data in a way that pretends it's
  fresh.

**What the agent layer absolutely must NOT do:**
- Change a verdict.
- Emit a finding code that isn't in the engine's registry.
- Present correlation or summary as if it were an engine verdict.
- Touch secrets, PII, chain commitments, or raw personal content.
- Make browser-side API calls that bypass the existing authenticated client.

**Architecture for the agent layer:**
- Keep it in `apps/web/src/lib/agents/` (web-side coordination) and, where heavier lifting is needed,
  route through the existing backend rather than building a second server. If a heavier agent runtime is
  genuinely justified, choose one that is already in the stack or already planned; do not sell "agentic"
  by importing a vague "agent framework" that does nothing visible.
- Instrument the agent-assisted views with observability: request id, what was fetched, what was
  correlated, what was shown, timing. Premium observability dashboards are transparent about where each
  piece of information came from.

---

## 4. Dashboard UI component inventory (build these, not "a dashboard")

Build real, named, polished components, each with its own state set. Treat each as a product component.

- `RiskScoreRing` / `VerdictBadge` / `RiskClassPill` — score/verdict/risk-class visualization with
  accessible numeric context and ARIA labels, not just color.
- `FindingGroup` / `EvidenceRow` — consistent rendering of findings and evidence with source, timestamp,
  and severity, shareable across scan, campaign, certificate and message views.
- `ChartPanel` / shared chart components — line/area/bar/donut as needed, with shared scales, legends,
  axes, tooltips, empty/error states, reduced-motion, keyboard readable.
- `BlockEditor` / `NoteEditor` — the editing surface for notes/narratives.
- `SlideOverPanel` / `Drawer` — inspection/detail panels, accessible, motion-coherent.
- `StatusCenter` / `AlertRail` — a premium status/summary rail (pending reviews, recent changes,
  reminders).
- `DataTable` / `HistoryList` — scrollable, sortable where it matters, accessible, empty/error states,
  loading skeleton.
- `OnChainProofPanel` — existing Web3 proof surface, polished into the dashboard style.
- `MessageInput` / `IndicatorHighlights` — paste + inline indicator extraction display.
- `TemplateEditor` or `SectionBuilder` if the dashboard surfaces multiple templated sections.
- `EmptyState`, `ErrorState`, `LoadingSkeleton`, `SkeletonList` — reusable, premium, not afterthoughts.
- `ChartContextPopover` — "show me the numbers" popover on any chart.

Each component: doc comment or a short note on what it owns, what states it handles, and what it assumes
about data. No component that silently swallows errors.

---

## 5. The design brief the agent must follow (so it doesn't drift)

Premium dashboard standard, in plain language the agent must meet:

- One design token system, applied everywhere.
- Surfaces look deliberate: cards, rails, panels, toolbars, and data areas each have a clear role.
- Depth and hierarchy via tokens, not random shadows or borders.
- Motion is coherent and restrained; entrance/stagger/layout only where it helps readability.
- Data visualization is honest: no fake chrome, no misleading scales, no decorative chart junk.
- Typography is readable on real content, including long evidence text and notes.
- Accessibility: keyboard nav, focus, labels, screen-reader sensible structure, reduced motion.
- Empty/error/loading/no-data states are first-class, not blanks.
- Performance: lazy-load panels/routes where it helps; don't pay for everything up front.
- The dashboard is a single coherent product, not a collection of loosely related widgets.

---

## 6. Integration end to end

- The rebuilt dashboard must still route through the existing app auth and API layer. If something forces
  you to change how auth or API calls work, stop and propose the change instead of silently rebuilding
  auth.
- The dashboard must display the existing scan/report/message/certificate/intel/on-chain data models
  without changing their meaning. Do not rename or reinterpret findings; render them from the models.
- Keep the README and route map consistent after the rebuild; the dashboard must be navigable from the
  app's actual entry points, not from a hidden dev URL.

---

## 7. Definition of done

- Sign-in still lands on the dashboard, and `/app` and the main panels are reachable and real.
- The dashboard uses one token system and one chart library, and the choice is documented.
- At least the home/overview, scan report, campaign/intelligence, certificate, message analysis, reports
  and settings panels exist as polished panels with loading/error/empty states.
- Charts are real, honest, and reusable, with numeric context.
- The agentic layer provides coordination/explanation/summarisation/orbits without ever re-deciding a
  security verdict, and is observable.
- No secrets or PII on the client or in logs/screenshots/URLs/demo traces.
- README, route map, and env documentation reflect the rebuilt dashboard.
- Nothing was added that isn't justified by a real need in the lockfile decision step.

Report at the end: (1) what was built, by panel and by component; (2) the exact stack choices and why,
including any package not installed and why; (3) anything that couldn't be done because a dependency
wasn't available; (4) any risk to the existing auth/API model and how it was handled; (5) what is still
left to polish if time runs out. Do not claim "premium" from a screenshot alone — show the structure,
the tokens, the component inventory, and the states.
