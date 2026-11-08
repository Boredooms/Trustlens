# @trustlens/demo-sites

Inert copies of the seeded demo sites from `docs/10-hackathon-demo/DEMO_RUNBOOK.md` §3: the genuine
Northstar University sites and three lookalikes. Zero dependencies — plain `node:http`.

```bash
cd apps/demo-sites
node server.mjs            # or: pnpm --filter @trustlens/demo-sites start
# PORT (default 8081) and HOST (default 127.0.0.1) can be overridden
```

Open `http://localhost:8081/` for an index of every site in both modes.

## Sites

| Host | Kind | Pages | What it shows |
| --- | --- | --- | --- |
| `northstar-demo.example` | genuine | `/` | University home; "Student login" → login host, "Pay fees" → pay host |
| `login.northstar-demo.example` | genuine | `/` | Login form, action `https://login.northstar-demo.example/session` |
| `pay.northstar-demo.example` | genuine | `/` | Payee `fees@northstar-demo`, Pay form action `https://pay.northstar-demo.example/checkout` |
| `apply.northstar-admissions.example` | lookalike 1 | `/`, `/register`, `/pay` | "Application fee ₹1,200", login form → `https://collect.badhost.example/login`, payee `fees@okaxis`, "Pay ₹1,200" → `https://collect.badhost.example/pay` |
| `apply.northstar-scholarships.example` | lookalike 2 | `/`, `/pay` | Scholarship lure, payee `fees@okaxis`, Pay form → `https://collect.badhost.example/pay` |
| `portal.northstar-placement.example` | lookalike 3 | `/` | Placement lure, login form → `https://collect.badhost.example/login` |

The demo's money shot uses `apply.northstar-admissions.example/pay`.

## Two ways to reach a site

### 1. Path mode — no setup

```text
http://localhost:8081/site/apply.northstar-admissions.example/pay
http://localhost:8081/site/northstar-demo.example/
```

Links between demo sites are rewritten to stay in path mode.

The TrustLens extension, when built with `VITE_DEMO_SITES_ORIGIN=http://localhost:8081`, reports a
path-mode URL to the API as the real demo URL — `http://localhost:8081/site/<host>/<path>` becomes
`https://<host>/<path>` (form actions under that origin are mapped the same way). That is URL
normalisation for the demo only; the API still makes the decision.

### 2. Host mode — needs a hosts-file entry (admin rights)

The server also routes by the `Host` header, so you can use the real demo hostnames once they
resolve to `127.0.0.1`. Editing the hosts file needs administrator rights. **This project never
modifies your hosts file** — add the lines yourself if you want this mode:

- Windows: `C:\Windows\System32\drivers\etc\hosts` (edit as Administrator)
- macOS / Linux: `/etc/hosts` (`sudo`)

```text
127.0.0.1 northstar-demo.example
127.0.0.1 login.northstar-demo.example
127.0.0.1 pay.northstar-demo.example
127.0.0.1 apply.northstar-admissions.example
127.0.0.1 apply.northstar-scholarships.example
127.0.0.1 portal.northstar-placement.example
```

Then, on the default port:

```text
http://apply.northstar-admissions.example:8081/pay
```

For portless URLs run on port 80 (also needs admin rights): `PORT=80 node server.mjs`
(PowerShell: `$env:PORT=80; node server.mjs`). Remove the lines when you are done.

Note: host mode is plain `http://`; there is no TLS here, so you will not see the padlock the
runbook mentions. The extension (and the API) always see the canonical `https://` URL in path mode.

## Everything is inert

- Every form is cancelled in the page by `static/demo.js` (`addEventListener("submit", …)` +
  `preventDefault()`), which shows "Demonstration only — nothing was sent" and clears the form. It
  never reads a field value, never logs and never stores anything.
- Independently, every response carries `Content-Security-Policy: … form-action 'none'`, so the
  browser refuses to submit any form even if the script were removed.
- `upi://` hand-off links are cancelled the same way.
- The server only answers `GET`/`HEAD`. Anything else gets `405` and the request body is discarded
  unread. Nothing is logged per request.
- No external resources (fonts, CDNs, images); no inline scripts, styles or handlers.
- Every page footer reads: "Demonstration site — do not enter real information."

## Markup contract (what the extension reads)

Metadata only — the extension never reads input values.

- Login forms: `<form method="post" action="…">` with
  `<input type="text|email" name="username" autocomplete="username">`,
  `<input type="password" name="password" autocomplete="current-password">` and a
  `<button type="submit">` labelled "Log in" or "Sign in".
- Payment forms: `<form method="post" action="…/pay">` (genuine: `…/checkout`) with
  `<button type="submit" class="pay">Pay ₹1,200</button>`, inside a `<section id="payment">` that
  shows the payee as page text: `<span data-payee="upi_vpa">fees@okaxis</span>` plus visible copy
  "UPI ID: fees@okaxis". The payee is never an input field.

## Checks

```bash
node --test "test/**/*.test.mjs"   # pnpm --filter @trustlens/demo-sites test
pnpm --filter @trustlens/demo-sites lint   # node --check on the scripts
```
