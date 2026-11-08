# DATA_FLOW

> **Status:** DECIDED · **Group:** 02-architecture · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** end-to-end flows and their sequence diagrams.
> **Related:** [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) · [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) · [`../03-backend/RISK_ENGINE.md`](../03-backend/RISK_ENGINE.md)

---

## 1. Reading guide

Each flow names: trigger, participants, ordered steps, data written, and failure behaviour. The
sequence diagrams are normative for ordering; the tables are normative for what is persisted.

Notation: `B` = backend service, `G` = guard, `P` = probe, `R` = risk engine, `I` = intelligence,
`DB` = Postgres, `X` = external dependency, `C` = client.

---

## 2. FLOW-01 — URL assessment (end to end)

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant G as Guard
    participant O as ScanOrchestrator
    participant P as Probes
    participant I as Intelligence
    participant R as RiskEngine
    participant DB as Postgres

    C->>A: POST /api/v1/scans {url,intent}
    A->>A: normalise, auth, rate limit, idempotency
    A->>G: assert_target_allowed(url)
    G-->>A: allowed
    A->>DB: INSERT scans(status=queued)
    A-->>C: 202 {id}
    A->>O: enqueue(id) under semaphore
    O->>P: gather(dns, rdap, tls, redirects, page)
    P->>G: guard each hop / each resolution
    P-->>O: results + coverage
    O->>I: upsert entities/edges
    O->>DB: INSERT scan_findings, evidence
    O->>R: score(findings, coverage, intent)
    R-->>O: decision, level, score, reasons, overrides
    O->>DB: UPDATE scans(status, decision, coverage)
    C->>A: GET /api/v1/scans/{id}
    A->>DB: SELECT scan + findings + evidence
    A-->>C: 200
```

**Written:** `scans`, `scan_findings`, `evidence`, `entities`, `relationships`, `certificates` (if
HTTPS), `usage_counters`.

**Failure.** Probe error → `scan_findings` unchanged, coverage entry `unavailable`; task crash →
`scans.status = failed` with `failure_code`. Never leaves `queued`.

---

## 3. FLOW-02 — DNS and registration

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant D as dns_analyzer
    participant R as rdap_analyzer
    participant X as Resolver/RDAP
    participant DB as Postgres

    O->>D: analyse(registrable_domain)
    D->>X: A, AAAA, CNAME, NS, MX, TXT
    X-->>D: records (+TTL)
    D-->>O: dns block + coverage
    O->>R: lookup(registrable_domain)
    R->>X: GET rdap/domain/{domain}
    X-->>R: registrar, events, status
    R-->>O: registration block
    O->>DB: INSERT evidence(source='dns'|'rdap')
    O->>DB: UPSERT entities(domain, ip, nameserver) + edges
```

**Transform.** IP list → `RESOLVES_TO` edges; NS set → `MANAGED_BY` edges; MX host → `MAIL_ROUTED_BY`.
Domain age computed from RDAP `registration` event only.

**Failure.** NXDOMAIN → finding `DOMAIN_NXDOMAIN`, coverage stays `collected` (we did resolve the
question). RDAP 404/5xx → `registration=null`, coverage `unavailable`.

---

## 4. FLOW-03 — TLS inspection

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant T as tls_analyzer
    participant X as Target:443
    participant DB as Postgres

    O->>T: inspect(host)
    T->>X: TLS handshake (SNI, 5s)
    X-->>T: chain
    T->>T: verify with system store (separate result)
    T->>T: parse certs, SANs, algos, fingerprints
    T->>DB: SELECT ca_issuer_status(issuer)
    T-->>O: tls block + issuer status
    O->>DB: INSERT certificates, entities(certificate_authority), edges(ISSUED_BY, PRESENTED_BY)
```

**Transform.** Leaf fingerprint → `certificates.fingerprint_sha256`; issuer DN → normalised CA name →
`ca_issuer_status` lookup. `days_to_expiry` from `not_after` minus now.

**Failure.** Handshake error → `tls.presented=false`, finding `TLS_HANDSHAKE_FAILED` for
login/payment intents; coverage `collected` (we learned the answer).

---

## 5. FLOW-04 — Redirect chain

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant F as fetcher
    participant G as Guard
    participant X as Target
    participant DB as Postgres

    O->>F: trace(url, max=10)
    loop each hop
        F->>G: assert_target_allowed(next_url) [re-resolve]
        alt blocked
            G-->>F: SSRFBlocked
            F-->>O: stop + finding REDIRECT_TO_BLOCKED_TARGET
        else allowed
            F->>X: GET (no follow, 5s, HEAD-first)
            X-->>F: status + Location
            F->>DB: INSERT evidence(source='redirect_hop')
        end
    end
    F-->>O: hops[], final_url, cross_domain
```

**Transform.** Hop list collapses into a `REDIRECTS_TO` chain of `url` entities. Cross-registrable-
domain hops flagged. Client-side redirects (meta refresh, JS) recorded separately.

**Failure.** Loop → stop with `loop_detected=true`; >10 hops → `REDIRECT_CHAIN_TOO_LONG`.

---

## 6. FLOW-05 — Page, form and action-destination analysis

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant P as page_analyzer
    participant F as fetcher
    participant DB as Postgres

    O->>P: analyse(final_url)
    P->>F: GET html (10s, 2MB cap)
    F-->>P: html + headers
    P->>P: parse forms, password fields, scripts, iframes, upi:// links
    P->>P: compute dom_fingerprint
    P-->>O: page block
    O->>DB: INSERT evidence(source='page', payload=redacted_structure)
    O->>DB: UPSERT entities(url, domain) + edges(SUBMITS_TO, EMBEDS, LINKS_TO)
```

**Transform.** A form with `action=""` → `submits_to = final_url`; a form posting cross-origin →
`SUBMITS_TO` edge to the action origin; `upi://pay?pa=...` → `payment_recipients` candidate.

**Redaction before storage.** Input *values* are never read. Hidden-field names are kept; values are
dropped. Any string matching a token/secret pattern is replaced with `[redacted]`.

**Failure.** 403/challenge → `PAGE_FETCH_BLOCKED`; oversize → truncated flag; renderer disabled →
`dom_source=static`.

---

## 7. FLOW-06 — Organisation and domain verification

```mermaid
sequenceDiagram
    participant U as Org admin
    participant A as API
    participant V as verification service
    participant X as DNS / target site
    participant DB as Postgres

    U->>A: POST /organisations/{id}/domains {domain}
    A->>DB: INSERT verified_domains(status=pending)
    A->>DB: INSERT domain_verifications(token_hash, expires_at, method)
    A-->>U: challenge instructions
    U->>A: POST .../domains/{did}/verify
    A->>V: check(domain, method, token)
    V->>X: TXT _trustlens-challenge / GET well-known
    X-->>V: observed
    V-->>A: match | mismatch(observed)
    A->>DB: UPDATE verification + domain status
    A->>DB: INSERT audit_logs(action='domain.verify')
    A-->>U: verified | VERIFICATION_TOKEN_MISMATCH(observed)
```

**Rule.** `verified_domains.status='verified'` is the only state consulted by identity rules.

---

## 8. FLOW-07 — Payment verification

```mermaid
sequenceDiagram
    participant C as Client/Extension
    participant A as API
    participant PV as payment_verifier
    participant DB as Postgres
    participant I as Intelligence

    C->>A: POST /verify-payment {organisation_id,type,value,observed_on_url}
    A->>PV: verify(...)
    PV->>PV: normalise + syntax/checksum
    PV->>DB: SELECT verified_recipients WHERE org AND normalised
    PV->>I: reported-recipient lookup
    I-->>PV: related reports
    PV-->>A: match, recipient_status, related_reports, confidence
    A->>DB: INSERT audit? (no) / evidence if observed_on_url
    A-->>C: 200
```

**Decision coupling.** `match=none` with at least one `verified` recipient on the org →
`PAYEE_NOT_IN_VERIFIED_PROFILE` (hard override for `payment`). `match=unverifiable` (org has none) →
`PAYEE_UNVERIFIABLE` (warn only).

---

## 9. FLOW-08 — Action integrity (login intent)

```mermaid
sequenceDiagram
    participant C as Extension
    participant A as API
    participant S as scan_orchestrator
    participant IV as identity_verifier
    participant DB as Postgres

    C->>A: POST /assess {url,intent=login,organisation_id?}
    A->>DB: load cached domain intel (TTL)
    A->>S: assess_action(url, login)
    S->>IV: resolve_claim(url, page)
    IV->>DB: SELECT verified_domains, login endpoints
    IV-->>S: claim(org) + authorised hosts
    S->>S: compare form action origin vs authorised hosts
    S-->>A: findings (CREDENTIAL_DESTINATION_MISMATCH | OK)
    A-->>C: decision + action{observed,expected[]}
```

---

## 10. FLOW-09 — Threat report and review

```mermaid
sequenceDiagram
    participant C as Reporter
    participant A as API
    participant DB as Postgres
    participant AN as Analyst
    participant I as Intelligence

    C->>A: POST /reports {url,justification}
    A->>A: dedupe(reporter,url,24h) + rate limit
    A->>DB: INSERT threat_reports(status=pending)
    A->>DB: link latest scan if fresh
    A-->>C: 201 {id,status}
    AN->>A: POST /reports/{id}/review {action=confirm,reason}
    A->>A: assert coverage>=50
    A->>DB: UPDATE status=confirmed, reviewed_by, reviewed_at
    A->>I: apply_reputation(entity, +delta, capped)
    I->>DB: UPSERT relationships(REPORTED_AS) + reputation_counters
    A->>DB: INSERT audit_logs(action='report.review')
```

---

## 11. FLOW-10 — Campaign correlation

```mermaid
sequenceDiagram
    participant T as Trigger (review/scan)
    participant I as correlation
    participant DB as Postgres

    T->>I: correlate(entity_id)
    I->>DB: neighbours(depth=2) with edge confidence
    I->>I: weight shared neighbours (ns .35, ca .2, payee .3, ip/24 .15, dom fp .25)
    I->>I: cluster by weighted Jaccard >= 0.45
    I->>DB: UPSERT campaigns(name, confidence, first_seen, last_seen)
    I->>DB: UPSERT relationships(MEMBER_OF_CAMPAIGN, confidence)
    I-->>T: campaign ids + confidence
```

Full weighting rationale: `../07-ai-intelligence/THREAT_GRAPH.md` §6.

---

## 12. FLOW-11 — AI investigation

```mermaid
sequenceDiagram
    participant C as Analyst
    participant A as API
    participant O as agent orchestrator
    participant TL as tools (allowlist)
    participant L as LLM
    participant DB as Postgres

    C->>A: POST /investigations {scan_id}
    A->>DB: INSERT investigations(status=queued)
    A-->>C: 202 {id}
    A->>O: run(id)
    O->>TL: collect_context(scan)
    O->>TL: correlate_graph(entity)
    O->>TL: reputation_history(entity)
    TL-->>O: evidence pack (finding ids, entity ids, counts)
    O->>O: redact + fence page text as DATA
    O->>L: prompt(schema) + evidence pack
    L-->>O: narrative JSON
    O->>O: validate + drop unsupported claims
    O->>DB: UPDATE investigations(status, narrative, steps, ai_meta)
    C->>A: GET /investigations/{id}
    A-->>C: 200 narrative with references
```

**Failure.** No key/timeout/schema failure → template narrative with `ai.generated=false`.

---

## 13. FLOW-12 — Extension check and interception

```mermaid
sequenceDiagram
    participant T as Tab
    participant CS as content script
    participant SW as service worker
    participant A as API

    T->>CS: page load complete
    CS->>SW: PAGE_READY {url}
    SW->>SW: cache lookup (10 min)
    alt miss
        SW->>A: POST /assess {intent=browse}
        A-->>SW: decision + coverage
        SW->>SW: store per-tab + URL cache
    end
    SW-->>CS: icon state + summary
    CS->>CS: watch for sensitive action
    CS->>SW: ACTION_INTENT {type,formAction,payee}
    SW->>A: POST /assess {intent=payment|login,...}
    A-->>SW: BLOCK + reasons
    SW-->>CS: render overlay
    CS->>CS: preventDefault, show observed vs expected
```

---

## 14. FLOW-13 — Certificate monitoring and simulated incident

```mermaid
sequenceDiagram
    participant S as Scan
    participant CM as cert monitor
    participant DB as Postgres
    participant OP as Operator

    S->>CM: record(certificate)
    CM->>DB: UPSERT certificates + monitors.last_seen
    CM->>CM: expiry bucket, fingerprint change
    OP->>CM: POST /certificates/incidents {issuer, simulated:true}
    CM->>DB: INSERT certificate_incidents(simulated=true)
    CM->>DB: SELECT monitored domains JOIN chain issuer
    CM-->>OP: affected[] with required_action
```

**Gate.** `DEMO_MODE=1` + `operator` role required; production returns `403 DEMO_MODE_REQUIRED`.

---

## 15. Data transformation summary

| Raw input | Normalised form | Stored as |
| --- | --- | --- |
| URL | lowercase host, punycode, no fragment, sorted query? **No** — query order preserved | `scans.normalised_url` |
| Domain | eTLD+1, lowercase, no trailing dot | `entities.key` (`domain:northstar-demo.example`) |
| IP | canonical text form (IPv6 compressed) | `entities.key` (`ip:203.0.113.10`) |
| Certificate | SHA-256 fingerprint hex lowercase | `certificates.fingerprint_sha256` |
| UPI VPA | lowercase localpart and handle | `verified_recipients.normalised_value` |
| IBAN | uppercase, no spaces | `verified_recipients.normalised_value` |
| Nameserver | lowercase, trailing dot stripped | `entities.key` |
| Finding | code + severity + group + evidence ids | `scan_findings` |

---

## 16. Flow-level performance budgets

| Flow | Budget |
| --- | --- |
| FLOW-01 total | 60 s hard, 20 s p50 |
| FLOW-02 | 4 s |
| FLOW-03 | 6 s |
| FLOW-04 | 8 s (10 hops × 5 s worst case, but aborted by global budget) |
| FLOW-05 | 12 s |
| FLOW-07 | 300 ms |
| FLOW-09 | 200 ms |
| FLOW-10 | 2 s |
| FLOW-11 | 50 s |
| FLOW-12 cold check | 1.2 s p95 (assess on cached domain) |
