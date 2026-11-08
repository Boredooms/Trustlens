# Threat Intelligence Sources

> **Status:** DECIDED. **Owner of:** external feed integration (`app/intelligence/feeds.py`), the
> `LISTED_BY_EXTERNAL_FEED` finding (R-REP-06), `INTEL_MODE` / `URLHAUS_AUTH_KEY`, and the
> `intel_observations` cache. **Problem statement:** Module 1 ("check domain reputation against
> available threat intelligence sources") and the mandatory MVP row "integrate at least one external
> intelligence source or documented dataset".

## 1. Sources

| Source | Kind | Used for | Status |
| --- | --- | --- | --- |
| **URLhaus** (abuse.ch) | External, live API `POST https://urlhaus-api.abuse.ch/v1/host/` | Is the scanned host (and the final redirect host) listed for malware or phishing distribution? | Implemented (`live` with `URLHAUS_AUTH_KEY`, `fixture` without) |
| **TrustLens confirmed reports** | Internal | Reputation from analyst-confirmed reports, related threats, campaigns | Implemented since MVP (`KNOWN_MALICIOUS_REPUTATION`, `RELATED_THREAT_FOUND`) |
| **Recorded certificate advisories** | Internal, `certificate_incidents` | Issuers under an incident (the eMudhra-style scenario) | Implemented; rows are **simulated** demonstrations (`CERTIFICATE_ANALYSIS.md` §3) |
| OpenPhish community feed | External | — | Not integrated (one external source is enough to defend; each extra source is another failure mode and licence) |

## 2. URLhaus: terms, limits, meaning

- **Terms.** abuse.ch publishes URLhaus for non-commercial and commercial use under its terms of
  service; API access requires a free Auth-Key from abuse.ch. Operators must obtain their own key and
  comply with abuse.ch's current terms. TrustLens does not redistribute the dataset.
- **What we send.** Only the hostname being scanned (and the final redirect host). Never a full URL,
  query string, user data or message text. This *is* a disclosure of the scanned host to a third
  party; it is documented here and can be disabled with `INTEL_MODE=off`.
- **What a hit means.** URLhaus has seen URLs on that host distributing malware or phishing. It is
  strong, attributed evidence and forces `BLOCK` (O-6). It does not say *who* runs the site.
- **What a miss means.** Nothing. "Not listed" is never shown as "clean"; the coverage and the
  `result.intel` block say exactly which source answered and when.
- **Rate limits.** Respect abuse.ch fair use. A `429` is recorded as `unavailable` with `retry_after`;
  it is never cached and never treated as "not listed".

## 3. Modes

| `INTEL_MODE` | Behaviour |
| --- | --- |
| `auto` (default) | `live` when `URLHAUS_AUTH_KEY` is set; else `fixture` when `DEMO_MODE=true`; else `off` |
| `live` | Live API. Without a key it resolves to `off` (the source is absent; nothing is faked) |
| `fixture` | Recorded, **simulated** URLhaus-shaped listings for the RFC 2606 demo hosts only (`app/intelligence/fixtures/urlhaus.json`). Every result says `mode: "fixture"`, `simulated: true`, listing ids `SIM-…` |
| `off` | No external lookup; `result.intel.status = "skipped"` |

## 4. Implementation rules

- Outbound call: the provider URL passes `guard.check_target` (public address, allowed port); 5 s
  timeout; no redirects; responses over 1 MB are discarded; only fixed headers (`Auth-Key`).
- Cache: Postgres table `intel_observations` keyed by `sha256("host:" + host)`, TTL 6 h, shared by
  all workers. **Failures are never cached.** Columns: `source`, `indicator_type`, `indicator_hash`,
  `status` (`listed|not_listed`), `listing_id`, `result JSONB` (the attributed answer),
  `queried_at`, `expires_at`. RLS on, no policy. Retention: rows older than their TTL are ignored
  and swept with the retention job.
- Normalisation: a listing becomes `LISTED_BY_EXTERNAL_FEED` (reputation, critical) with
  `observed = {source, source_name, mode, indicator, listing_id, threat, url_status, reference,
  queried_at}` and an `intel` evidence row. Fixture hits are `simulated`.
- Attribution in every surface: "URLhaus (abuse.ch) lists <host> (<threat>), queried <time>,
  listing <id>". Feed data is never presented as TrustLens' own finding.
- Lookups run only when DNS resolved; an unreachable target is `UNKNOWN` regardless of the feed.

## 5. Failure behaviour (tested)

| Situation | Result |
| --- | --- |
| Hit (live or fixture) | `LISTED_BY_EXTERNAL_FEED` → `BLOCK` via `O-6`; attribution shown |
| `no_results` | `status: not_listed`; no finding; verdict from other signals |
| Timeout, 5xx, bad JSON, `invalid_host` | `status: unavailable`; no finding; UI says "external reputation unavailable" |
| `429` | `unavailable` with `retry_after`; not cached |
| No key, `INTEL_MODE=auto`, not demo | source absent (`skipped`); the scan runs normally |
