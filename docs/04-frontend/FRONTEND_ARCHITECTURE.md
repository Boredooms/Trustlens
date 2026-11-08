# FRONTEND_ARCHITECTURE

> **Status:** DECIDED · **Group:** 04-frontend · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** React app structure, routing, data layer, state, forms, error boundaries, performance.
> **Related:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) · [`UI_UX_SPECIFICATIONS.md`](UI_UX_SPECIFICATIONS.md) · [`../02-architecture/API_CONTRACTS.md`](../02-architecture/API_CONTRACTS.md)

---

## 1. Shape of the app

One React SPA containing the public site and the authenticated dashboard, separated by layout
routes. Built with Vite, deployed as static assets.

```text
apps/web/src/
├── main.tsx                 createRoot, providers
├── app.tsx                  router tree
├── routes/
│   ├── public/              landing, how-it-works, developers, security, login, register
│   └── app/                 overview, scan, scan/:id, intelligence, campaigns,
│                            organisations, certificates, reports, settings, developers
├── components/
│   ├── ui/                  shadcn-derived primitives (owned in-repo)
│   ├── domain/              VerdictBadge, CoverageMeter, FindingRow, EvidenceDrawer,
│   │                        ScanInput, GraphCanvas, TrustProfileForm, …
│   └── layout/              PublicShell, AppShell, Sidebar, TopBar, PageHeader
├── lib/
│   ├── api/                 generated client + typed wrappers
│   ├── query/               query keys, hooks per resource
│   ├── auth/                session context, token refresh, route guards
│   ├── format/              dates, numbers, coverage, decision labels
│   └── utils/               cn(), tokens, guards
├── stores/                  zustand stores (max 3)
└── styles/                  globals.css, tokens.css
```

### 1.1 Rules

- Route components are thin: read params, call hooks, compose components. No `fetch` in a component.
- Business logic that touches the API lives in `lib/query/*`.
- Presentational components take props and never call hooks that hit the network.
- No component imports from another route folder. Shared things move to `components/domain`.
- No default exports except route-level `lazy()` wrappers.

---

## 2. Routing

```tsx
const router = createBrowserRouter([
  {
    path: "/",
    element: <PublicShell />,
    children: [
      { index: true, element: <Landing /> },
      { path: "how-it-works", element: <HowItWorks /> },
      { path: "developers", element: <Developers /> },
      { path: "security", element: <Security /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Register /> },
      { path: "appeal", element: <Appeal /> },
    ],
  },
  {
    path: "/app",
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Overview /> },
      { path: "scan", element: <ScanIndex /> },
      { path: "scan/:scanId", element: <ScanReport /> },
      { path: "intelligence", element: <Intelligence /> },
      { path: "campaigns", element: <Campaigns /> },
      { path: "campaigns/:campaignId", element: <CampaignDetail /> },
      { path: "organisations", element: <Organisations /> },
      { path: "organisations/:orgId", element: <OrganisationDetail /> },
      { path: "certificates", element: <Certificates /> },
      { path: "reports", element: <Reports /> },
      { path: "reports/:reportId", element: <ReportDetail /> },
      { path: "settings", element: <Settings /> },
      { path: "developers", element: <DeveloperPortal /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
```

- Every `/app/*` route is code-split (`React.lazy`), with a route-level `ErrorBoundary`.
- `/app/intelligence` additionally lazy-loads Cytoscape (dynamic `import()` in the canvas component).
- Route guards: `RequireAuth` redirects to `/login?next=<path>`; `RequireRole` renders a 403 page.
- Query params are the source of truth for filters (`?decision=BLOCK&status=completed`), so links are
  shareable and the back button works.
- `/app/scan?url=...` pre-fills and auto-runs a scan (used by the public checker hand-off).

---

## 3. Layouts

| Layout | Contains | Notes |
| --- | --- | --- |
| `PublicShell` | Marketing header, footer, Lenis smooth scroll, GSAP hero scope | No Lenis inside `/app` |
| `AppShell` | Fixed sidebar (240 px), top bar with search + account, content max-width 1200 px | Sidebar collapses to icons < 1024 px, drawer < 768 px |
| `PageHeader` | Title, subtitle, actions, breadcrumbs | Consistent across all app routes |

The app shell is intentionally dense and calm: 14 px base text, 1 px borders, no shadows, no
gradients. See `DESIGN_SYSTEM.md`.

---

## 4. API client

### 4.1 Generated core

```ts
// lib/api/client.ts
import createClient from "openapi-fetch";
import type { paths } from "@trustlens/shared-types";

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  credentials: "omit",              // auth is a Bearer token from the Clerk session
  headers: { "X-Client": `web/${APP_VERSION}` },
});
```

- Types come from `packages/shared-types`, generated from `openapi.json`.
- A middleware attaches `Authorization: Bearer <clerk session token>` from
  `await clerk.session.getToken()`; on `401 INVALID_TOKEN` it forces one refresh
  (`getToken({ skipCache: true })`) and retries the request once.
- Concurrent 401s share a single refresh promise (no stampede); a failed refresh signs the user out
  and routes to `/login` with a non-destructive message.
- A 401 from a **machine** key (should never happen in the browser) is surfaced as a configuration
  error rather than triggering a refresh loop.
- Error normalisation maps the envelope to `ApiError { code, status, message, requestId, details }`.

### 4.2 Rules

- Never hand-write a response interface; import the generated type.
- Never construct a URL by string concatenation; use the typed client.
- A component never sees `Response`; it sees data or `ApiError`.

---

## 5. Server state (TanStack Query)

```ts
export const qk = {
  overview: ["overview"] as const,
  scans: (f: ScanFilters) => ["scans", f] as const,
  scan: (id: string) => ["scan", id] as const,
  graph: (id: string, d: number) => ["graph", id, d] as const,
  campaigns: (f: CampaignFilters) => ["campaigns", f] as const,
  org: (id: string) => ["org", id] as const,
  publicProfile: (id: string) => ["public-profile", id] as const,
  reports: (f: ReportFilters) => ["reports", f] as const,
  certificates: (f: CertFilters) => ["certificates", f] as const,
  investigation: (id: string) => ["investigation", id] as const,
  usage: ["usage"] as const,
};
```

| Setting | Value |
| --- | --- |
| `staleTime` | 30 s default; 5 min for public profile; 0 for running scans |
| `gcTime` | 5 min |
| `retry` | 1 for GET, 0 for mutations |
| `refetchOnWindowFocus` | `false` (avoid surprising re-renders during demos) |

### 5.1 Polling

`useScan(id)` sets `refetchInterval: (data) => isTerminal(data?.status) ? false : 1000`, with a hard
stop after 90 s that surfaces a "still running" state with the last known data.

`useInvestigation(id)` behaves the same with a 120 s cap.

### 5.2 Mutations

Every mutation invalidates the narrowest prefix and nothing more:

| Mutation | Invalidates |
| --- | --- |
| create scan | `["scans"]`, `["overview"]` |
| create report | `["reports"]`, `["overview"]` |
| review report | `["reports"]`, `["report", id]`, `["overview"]` |
| verify domain | `["org", id]`, `["public-profile", id]` |
| verify recipient | `["org", id]`, `["public-profile", id]` |
| create investigation | `["investigation", id]` |
| create incident | `["certificates"]`, `["overview"]` |

Optimistic updates are used only for review actions (status flips immediately, rolled back on error).

---

## 6. Client state (Zustand)

Three stores, no more:

| Store | Holds | Why not Query |
| --- | --- | --- |
| `useGraphStore` | selected node/edge, filters, layout choice | Local view state, not server data |
| `useUiStore` | sidebar collapsed, density, reduced-motion override | Persisted preference |
| `useRecentStore` | last 10 checks performed in this browser | Local-only, not on the server |

Rule: if it comes from the API, it does not go in Zustand.

---

## 7. Auth on the client

- `AuthProvider` wraps the **Clerk session** (`useAuth()`) and exposes a token getter to the API
  client, not a global.
- On boot: `clerk.load()` resolves the session, then call `/auth/me` to obtain our role and
  memberships. A signed-in Clerk user with no local row is provisioned on that first call.
- `useUser()` re-renders on sign-in, token refresh and sign-out, and each change refetches `/auth/me`.
- Logout calls `clerk.signOut()` then `POST /auth/logout` (audit + cache clear), clears the
  query cache, and navigates to `/`.
- `RequireAuth` renders a full-page skeleton while the session resolves (not a flash of `/login`).

Why the token is not copied into Zustand: it changes on refresh and duplicating it invites stale-token
bugs. One owner (the Clerk client), one reader (the API client middleware).

---

## 8. Forms and validation

- React Hook Form + Zod resolver for every form.
- Zod schemas mirror the API constraints in `API_CONTRACTS.md` §13; shared schemas live in
  `packages/shared-types` when the SDK needs them too.
- Server `422` details are mapped to fields by `details[].field`; unmatched details render in a form
  banner with the `requestId`.
- Submit buttons disable during mutation and show a spinner; never allow double-submit.
- Destructive or irreversible actions (revoke domain, revoke key, delete account, suspend org)
  require typed confirmation or a modal with an explicit consequence sentence.

---

## 9. Error handling

| Layer | Behaviour |
| --- | --- |
| Route | `ErrorBoundary` with "Reload" and "Back to dashboard"; logs `requestId` |
| Query | `isError` renders an inline error panel with retry, never an empty list |
| Mutation | Toast with the human message; field errors inline |
| Offline/network | Persistent banner "You are offline — results may be stale" |
| Cold start | 503 from any call shows a "waking the engine" banner with a retry that preserves state |

Never render a blank screen on error. Never show a stack trace or a raw `code` alone; show the
message and keep the code in a details disclosure for support.

---

## 10. Performance

| Technique | Applied to |
| --- | --- |
| Route-level `lazy` | Every `/app/*` route |
| Dynamic import | Cytoscape, GSAP, Recharts (per route) |
| `React.memo` | `FindingRow`, graph node list, table rows |
| Virtualisation | Only if a list can exceed 100 rows (reports, entities) |
| Image sizing | Logo previews ≤ 64 px, `loading="lazy"` |
| Prefetch | On sidebar hover for top-level routes |
| Budget | 180 kB gzip initial, 420 kB for the graph route |

Measure with `vite build --report` before merging anything that adds a dependency.

---

## 11. Accessibility integration

The app must satisfy `ACCESSIBILITY_RESPONSIVENESS.md`. Frontend-specific obligations:

- Route changes move focus to the `<h1>` of the new page and announce via a live region.
- Modals/drawers trap focus and restore it on close (Radix handles this; do not hand-roll).
- The verdict is text + icon + colour, never colour alone.
- Tables use `<table>` semantics; graph exploration has a keyboard-accessible list fallback.

---

## 12. Environment and build

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin, baked at build |
| `VITE_APP_VERSION` | Displayed in settings and sent as `X-Client` |
| `VITE_DEMO_MODE` | Shows the demo banner and disables "real" claims in copy |

`vite.config.ts` sets a strict CSP meta for the static host, manual chunks for `cytoscape`,
`recharts` and `gsap`, and `build.sourcemap = false` (no source maps in production assets).

---

## 13. Testing

| Level | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | formatters, guards, decision label mapping |
| Component | Testing Library | `VerdictBadge`, `CoverageMeter`, `FindingRow`, empty/error states |
| Integration | MSW + Testing Library | scan flow with mocked API, report review |
| E2E | Playwright | login → scan → report → graph, run against a seeded local API |

Rule: every list component has a test for empty, loading and error. Those three states are where
dashboards usually break.

---

## 14. Open questions

| ID | Question | Default |
| --- | --- | --- |
| FQ-1 | Server-side rendering for marketing SEO? | No; static meta + sitemap |
| FQ-2 | Do we need a shared `packages/ui`? | Only if a second app appears; currently no |
| FQ-3 | Virtualise the entities table now? | No; add when a dataset exceeds 200 rows |
