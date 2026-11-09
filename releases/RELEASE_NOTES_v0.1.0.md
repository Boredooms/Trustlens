# TrustLens v0.1.0

First public release: verifies whether a page is **authorised** to ask for a password, a payment or
personal data, investigates connected infrastructure, and anchors confirmed reports for independent
verification. The risk engine decides; the AI only explains.

## Downloads

| Asset | Use |
| --- | --- |
| `trustlens-extension-production.zip` | Chrome MV3 extension built for the live API (`trustlens-api-m65a.onrender.com`) and dashboard (`trustlens-web-three.vercel.app`). Unzip, open `chrome://extensions`, enable Developer mode, then **Load unpacked** |
| `trustlens-extension-local.zip` | Same extension built for `localhost:8000` / `localhost:5173` (local development) |

After loading the extension, sign in to the dashboard, open **Developers** and press **Connect extension**:
pairing takes one click, and the device token never reaches the page.

## What's in it

- Dashboard: scan reports, message analysis, certificate posture, campaigns and entity graph, reports
  with integrity anchors, analyst notes (block editor), scan assistant, developer keys.
- API (FastAPI) with `/health`, `/ready`, `/api/v1/health`; Render Docker service; Supabase Postgres.
- Extension: checks every page; holds Pay and Sign-in until the server decides; explains a block.
- SDK: `@boredooms/trustlens-sdk` (TypeScript, ESM + CJS).
- Web3: `ThreatReportRegistry` (Solidity 0.8.24) with a reproducible local chain, plus
  `CHAIN_MODE=simulated` for hosted demos. That mode applies the contract's rules with real keccak256
  commitments, persisted in Postgres and labelled simulated (chain id 0, not a public blockchain).

## Verified

- API 431 tests; web 20 test files; extension, SDK, contracts, demo-sites suites; CI green on `main`.
- Production E2E in real Chromium: Clerk sign-in → `/app`, live scan, notes autosave (7/7). Extension
  paired on the live dashboard; Pay and Sign-in blocked on the live lookalikes (10/10).
- Simulated registry against the hosted database: three reports anchored, publicly verified valid, a
  tampered copy rejected.

## Known limitations

- The hosted registry is simulated. A public-testnet anchor needs a funded wallet and a signing path.
- Free Render plan: the first request after idle can take about a minute.
- Demo sites are labelled, inert test fixtures; nothing is collected.
