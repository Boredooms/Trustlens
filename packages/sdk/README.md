# @boredooms/trustlens-sdk

TypeScript client for the TrustLens API. Spec: `docs/06-sdk/SDK_SPECIFICATION.md`.

- **The server decides.** The SDK returns `decision` unchanged. `ALLOW` means *no known threat within
  executed checks* — never render it as "safe". Unknown enum values arrive as `UNKNOWN`.
- **Live keys (`tl_live_…`) belong on a server.** Constructing with one in a browser throws unless
  `allowBrowserKey: true`; that is a guard rail, not a security boundary.
- Fields are `snake_case` exactly as the API returns them.

```ts
import { TrustLens, shouldBlock } from "@boredooms/trustlens-sdk";
const tl = new TrustLens({ apiKey: process.env.TRUSTLENS_API_KEY!, baseUrl: "http://localhost:8000" });
const r = await tl.assess({ url: "https://apply.northstar-admissions.example/pay", intent: "payment", payee: "fees@okaxis" });
if (shouldBlock(r)) { /* refuse */ }
```

Demo: `pnpm --filter @boredooms/trustlens-sdk build && TRUSTLENS_API_KEY=tl_live_… node packages/sdk/examples/demo-call.mjs`
(`TRUSTLENS_API_URL` defaults to `http://localhost:8000`).
