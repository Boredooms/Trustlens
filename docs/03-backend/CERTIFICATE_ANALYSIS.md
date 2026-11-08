# Certificate Analysis and Security Posture

> **Status:** DECIDED. **Owner of:** certificate depth rules `R-INF-16`…`R-INF-20`, the
> `result.certificate` report, the unscored header posture `R-HDR-01`…`R-HDR-09` and
> `result.security_posture`. **Problem statement:** Module 2 (TLS certificate and web trust
> analysis), Module 5 (website security assessment), deliverable 4.

## 1. Principles

1. **A valid certificate is not proof the site is legitimate.** Every certificate report carries
   that sentence. Phishing pages routinely hold valid certificates.
2. **Misconfiguration and trust compromise are different things.** Expired or weak certificates are
   operational mistakes; an untrusted chain, a revoked certificate or an issuer under an advisory
   means the trust anchor itself is in doubt. The report separates them in wording and severity.
3. **Unknown is not good.** Revocation and CT checks are best-effort; a timeout is `unavailable`.
4. **Non-intrusive only.** One TLS handshake (two when the first fails verification, to inspect the
   presented certificate without trusting it), one ordinary GET, and for revocation at most two
   small fetches to the **issuer's** published AIA/OCSP endpoints, each through the SSRF guard.
5. **We never claim to detect a CA's internal key-generation weakness from a URL.** The capability is
   "this certificate chains to an issuer named in a recorded advisory".

## 2. Checks (infrastructure group, scored)

Existing: `TLS_HANDSHAKE_FAILED`, `CERT_EXPIRED`, `CERT_HOSTNAME_MISMATCH`, `CERT_CHAIN_UNVERIFIED`,
`CERT_WEAK_KEY` (RSA < 2048, EC < 224), `CERT_WEAK_SIGNATURE` (MD5/SHA-1),
`CERT_ISSUER_AFFECTED_BY_INCIDENT` (`RISK_ENGINE.md` §7.5, §10).

| Rule | Code | Sev | Fires when | Evidence |
| --- | --- | --- | --- | --- |
| `R-INF-16` | `CERT_EXPIRING_SOON` | low | 0 ≤ days to expiry ≤ 14 | `days_to_expiry`, `not_after` |
| `R-INF-17` | `CERT_NOT_YET_VALID` | medium | `not_before` in the future | `not_before` |
| `R-INF-18` | `CERT_SELF_SIGNED` | high | issuer = subject; **subsumes** `CERT_CHAIN_UNVERIFIED` | issuer, subject |
| `R-INF-19` | `CERT_REVOKED` | critical | OCSP answers `revoked` | responder, this_update, revoked_at, reason |
| `R-INF-20` | `CERT_NO_EMBEDDED_SCT` | low (confidence 0.5) | verified chain, leaf has no embedded SCTs | `embedded_scts: 0` |

`CERT_NO_EMBEDDED_SCT` is deliberately weak: SCTs may also be delivered in the TLS handshake or a
stapled OCSP response, which this collector does not read. A crt.sh lookup is not performed (slow
and rate-limited); a CT log query is future work.

**Revocation (OCSP).** For a chain that otherwise verifies: read the leaf's Authority Information
Access, fetch the issuer certificate from the CA Issuers URL, build an RFC 6960 request (SHA-1
CertID, as the RFC requires) and send it as a GET to the responder. Both URLs come from an
attacker-controlled certificate, so both go through `guarded_get` (guard + re-resolution on every
hop). 4 s budget. Outcomes: `good`, `revoked`, `unknown`, `unavailable` (with a reason), `skipped`
(chain not verified, or no TLS).

## 3. Distrusted issuers (the eMudhra-style scenario)

`certificate_incidents` records issuers under an advisory. Its check constraint permits only
`simulated` rows today, and the seeded incident is a **demonstration** of the capability, labelled
simulated everywhere; a simulated incident produces an `info` finding (0 points). The demo shows how
a real advisory would surface ("this certificate chains to an issuer named in incident X"), not a
claim about a real CA. Real advisory ingestion is future work.

## 4. The certificate report (`result.certificate`)

`assessment`: `no_tls` · `unavailable` · `valid` · `misconfigured` · `trust_compromised`.
Trust codes: `CERT_REVOKED`, `CERT_SELF_SIGNED`, `CERT_CHAIN_UNVERIFIED`, `CERT_HOSTNAME_MISMATCH`,
`CERT_ISSUER_AFFECTED_BY_INCIDENT` (non-simulated), `TLS_HANDSHAKE_FAILED`. Configuration codes:
`CERT_EXPIRED`, `CERT_EXPIRING_SOON`, `CERT_NOT_YET_VALID`, `CERT_WEAK_KEY`, `CERT_WEAK_SIGNATURE`,
`CERT_NO_EMBEDDED_SCT`. The report also carries subject, issuer, root, SANs, validity window, key,
signature algorithm, chain verification, self-signed flag, embedded SCT count, the revocation block,
the "not proof of legitimacy" note and the limitations text.

## 5. Header posture (`result.security_posture`, unscored, `RISK_ENGINE.md` §7.8)

From the headers of the single page response the scanner already fetched. No extra request, no
paths, no payloads, no authentication. **Unscored**: missing hardening headers are common on
legitimate sites and say nothing about phishing, so they never move a verdict (false-positive
handling). Each item: check id, issue, technical evidence, impact, severity, remediation, limitation
("based on one unauthenticated response…"). Cookie **names** only are recorded, never values.

| Check | Code | Sev |
| --- | --- | --- |
| `R-HDR-01` | `HSTS_MISSING` (HTTPS only) | low |
| `R-HDR-02` | `CSP_MISSING_OR_WEAK` (absent, `'unsafe-inline'`, wildcard script source) | low |
| `R-HDR-03` | `NOSNIFF_MISSING` | info |
| `R-HDR-04` | `REFERRER_POLICY_MISSING` | info |
| `R-HDR-05` | `PERMISSIONS_POLICY_MISSING` | info |
| `R-HDR-06` | `COOKIE_WITHOUT_SECURE_OR_HTTPONLY` (HTTPS) | medium |
| `R-HDR-07` | `SERVER_VERSION_DISCLOSED` (`Server`/`X-Powered-By` with a version) | low |
| `R-HDR-08` | `MIXED_CONTENT` (http subresources in the static markup of an HTTPS page) | medium |
| `R-HDR-09` | `PLAIN_HTTP_SITE` | medium |

Status: `collected`, `unavailable` (no response observed — never "clean"), `skipped`.

## 6. Demo hosts (simulated, DEMO_MODE)

| Host | Shows |
| --- | --- |
| `northstar-demo.example` | valid certificate, strong headers, still "not proof" |
| `old.northstar-demo.example` | `misconfigured`: certificate expires in 5 days |
| `selfsigned.badhost.example` | `trust_compromised`: self-signed |
| `revoked.badhost.example` | `trust_compromised`: OCSP revoked (`keyCompromise`) |
| `secure-pay.badhost.example` | URLhaus (fixture) listing → `BLOCK` via O-6 |
| lookalike hosts | missing headers, version disclosure, insecure cookie (posture only) |
