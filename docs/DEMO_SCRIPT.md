# TrustLens — demo script (≈ 5 minutes)

Everything runs on the live deployment. Nothing here needs a local server.

| What | URL |
| --- | --- |
| Dashboard | https://trustlens-web-three.vercel.app |
| API readiness | https://trustlens-api-m65a.onrender.com/ready |
| Lookalike (phishing test fixture) | https://trustlens-demo-admissions.vercel.app/pay |
| Genuine site | https://trustlens-demo-northstar.vercel.app/pay |
| Public proof | https://trustlens-web-three.vercel.app/verify/01M6ZJDX5XRETB1QH1E1RHMW3J |
| Extension | `trustlens-extension-production.zip` from the [latest release](https://github.com/Boredooms/Trustlens/releases/latest) |

## Before you press record (2 min)

1. Open `/ready` once. Render's free plan sleeps, and the first request can take about a minute. Wait for `"status":"ready"`.
2. Unzip the extension → `chrome://extensions` → Developer mode → **Load unpacked**. Remove any older TrustLens first.
3. Sign in to the dashboard → **Developers** → **Connect extension** (one click). The popup should say **Connected**.
4. Open each demo URL once so first-visit scans are warm, then close those tabs. Use a clean window with one tab.

## 1. The problem — landing page (20 s)

Open the dashboard root.

> "A padlock proves the connection is private, not who is on the other end. Phishing pages have valid
> certificates. TrustLens asks a different question: is this page *allowed* to ask for my password or money?"

Click **What it checks** and scroll briefly. End on the halftone footer.

## 2. Investigate a URL — dashboard (60 s)

**Sign in** → lands on `/app`. Show the Overview (real scans, verdict mix, risk trend).

**New scan** → paste `https://trustlens-demo-admissions.vercel.app/pay` → submit.

> "The scanner reads DNS, the TLS certificate, registration age and the page itself. Every network call goes
> through an SSRF guard."

On the report, point at:
- the verdict ring and **coverage** ("we say what we checked, never 'safe'");
- the findings, each tied to evidence;
- the certificate panel (misconfiguration vs. trust compromise).

Optional: **Investigate** → the AI narrative cites finding IDs; uncited claims are dropped.

> "Rules decide. The model only explains."

## 3. Live protection — the extension (90 s) — the key moment

Open `https://trustlens-demo-admissions.vercel.app/pay` in a new tab. **Don't click anything.**

- Within about 2 s the page is covered: "Checking this payment page before you use it…"
- Then: **TrustLens blocked this payment page**
  - "This page asks you to pay **fees@okaxis**. Northstar University has registered **fees@northstar-demo**."

> "This lookalike is brand new, so no blocklist knows it. We caught it because it asks for money, and the payee isn't
> the one the real university registered."

Show that **Proceed anyway** needs two clicks. Click **Go back** instead.

Open the toolbar **popup**:

> "Blocked · Enforced on this page's payment check", with score, coverage and findings.

Then open `https://trustlens-demo-northstar.vercel.app/pay`. It's checked and **released**.

> "The real site isn't blocked."

Optional extras:
- A link to the flagged site from another page is stopped before it navigates.
- Downloads (`.exe`, `.apk`, `.zip`) and personal-data forms (card, OTP, Aadhaar…) are checked the same way.

## 4. AI scam analysis — Messages (40 s)

Dashboard → **Messages** → paste a scam SMS, e.g.:

> "URGENT: your Northstar admission will be cancelled today. Pay ₹1,200 to fees@okaxis now: https://trustlens-demo-admissions.vercel.app/pay"

Point at the cited evidence and the **language-alone cap**:

> "Urgent wording on its own can reach 'review', never 'block'. A block needs evidence, such as the linked page
> and the unregistered payee."

## 5. Report it and anchor it — Web3 (50 s)

Open the scan report → **Report this site** (or **Reports** in the sidebar) → open a report → **Anchor**.

Open the **public verify** link in a private window. No sign-in is needed:

- **Integrity verified: valid.** All three checks are green.
- Edit one character in **Check a copy of the payload** → **Verify** → **invalid**.

> "Only a salted hash commitment is anchored, never personal data. Anyone can check a report wasn't altered."

Say this plainly:

> "The hosted demo uses a simulated registry, clearly labelled. It uses the same contract rules and the same keccak256
> commitment. The real Solidity contract runs on a reproducible local chain: `pnpm --filter @trustlens/contracts replay`."

## 6. Close (15 s)

> "Rules decide, AI explains, the extension enforces before you can type, and reports are tamper-evident.
> Open source: github.com/Boredooms/Trustlens."

## If something goes wrong on camera

| Symptom | Fix |
| --- | --- |
| A scan or the guard spins for 30 s+ | Render woke up cold. Wait, or re-run step 1 of the preparation |
| The popup says "Connect" | Dashboard → Developers → Connect extension |
| The lookalike page isn't covered | Make sure the old extension is removed and the 0.5.1 zip is loaded; reload the tab |
| Verify shows "registry unavailable" | Hard-refresh; the API was mid-deploy |
