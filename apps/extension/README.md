# TrustLens browser extension (Chrome MV3)

Checks the page you are about to give credentials, money or personal data to, and shows the API's
decision in an overlay **before** you act. The service worker is the only network caller; the page
never sees the API. It reads metadata only (form action host, payee strings, page intent), never form
values, passwords, cookies or card numbers. Behaviour spec:
[`docs/05-browser-extension/`](../../docs/05-browser-extension/).

## Build

```bash
# repo root; values are public build-time settings (never secrets)
VITE_API_BASE_URL=http://localhost:8000 \
VITE_WEB_BASE_URL=http://localhost:5173 \
VITE_DEMO_SITES_ORIGIN=http://localhost:8081 \
pnpm --filter @trustlens/extension build          # → apps/extension/dist
```

PowerShell: `$env:VITE_DEMO_SITES_ORIGIN='http://localhost:8081'; pnpm --filter @trustlens/extension build`.
`VITE_DEMO_SITES_ORIGIN` maps `http://localhost:8081/site/<host>/…` to `https://<host>/…`, so the demo
pages are assessed as the hosts they imitate. Rebuild after changing any value.

## Load and pair

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → `apps/extension/dist`.
2. Dashboard → **Developers → Browser extension → Generate pairing code**, enter it in the extension
   popup. The device token (`tl_ext_…`) is stored in extension storage only.
3. Open <http://localhost:8081>, pick a lookalike site, go to its payment or login page: the overlay
   shows `BLOCK` with reasons; **Full report** opens the scan in the dashboard.

## Behaviour that is deliberate

- A cache entry older than 10 minutes renders `UNKNOWN`, never a stale `ALLOW`.
- A failed or timed-out check is shown as `UNKNOWN` (fail visible), never as clean.
- `ALLOW` copy says "No known threat", never "safe".

## Test

```bash
pnpm --filter @trustlens/extension test      # vitest, fixture-driven
pnpm --filter @trustlens/extension typecheck
```
