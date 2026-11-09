# TrustLens v0.1.1

Extension **v0.5.1**: protection beyond payment pages, and a popup that shows what was enforced.

## What's new

- **Personal-data forms are protected.** A form with at least 3 personal fields (name, email, phone,
  address, date of birth…) or one sensitive field (card number, CVV, OTP, Aadhaar, PAN, SSN, passport)
  is checked as `data_submission`. The page is held on load while the server checks it, and the submit
  is held until the server decides. Recognised from field types and names, never from what you type.
- **Downloads are checked.** Clicking a link to an executable, installer or archive (`.exe .msi .apk
  .dmg .pkg .zip .rar .7z .iso …`) holds the download while the server checks the file's host as
  `download`. The API never fetches the file.
- **The popup shows what was enforced.** If the page guard or an action check decided something more
  severe than the page-view verdict (for example BLOCK on this page's payment), the popup shows that
  decision and where it came from.
- Unchanged from v0.5.0: login and payment pages are covered on load until the server decides;
  page-level BLOCK/WARN covers the page; links to hosts flagged in the last 10 minutes are stopped
  before navigating.

## Verified

Real Chromium against production, 16/16:
- lookalike `/pay` covered within 2 s with no click and kept blocked;
- link to it stopped;
- genuine pay page released;
- popup shows "Blocked · Enforced on this page's payment check";
- a KYC-style form is held while checked;
- an installer from the flagged host is held and not downloaded.

## Downloads

| Asset | Use |
| --- | --- |
| `trustlens-extension-production.zip` | Built for the live API and dashboard. Unzip → `chrome://extensions` → Developer mode → Load unpacked |
| `trustlens-extension-local.zip` | Built for `localhost:8000` / `localhost:5173` |
