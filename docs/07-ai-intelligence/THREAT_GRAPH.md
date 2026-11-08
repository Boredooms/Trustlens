# THREAT_GRAPH

> **Status:** DECIDED · **Group:** 07-ai-intelligence · **Version:** 1.0 · **Last updated:** 2026-11-07
> **Source of truth for:** node types, edge types, confidence, traversal, clustering, visualisation.
> **Related:** [`../02-architecture/DATABASE_DESIGN.md`](../02-architecture/DATABASE_DESIGN.md) · [`THREAT_INTELLIGENCE_ENGINE.md`](THREAT_INTELLIGENCE_ENGINE.md)

---

## 1. Purpose

The graph answers: *what else is connected to this thing, and how sure are we?* It is the difference
between "this URL is suspicious" and "this URL, a scholarship portal and a payment page are one
operation".

It is stored relationally (`entities`, `relationships`) and traversed with recursive CTEs. No graph
database (ADR-004).

---

## 2. Design principles

1. **Every edge is evidenced.** An edge without `evidence_refs` is invalid.
2. **Every edge has a confidence.** Sharing a hosting provider is not the same as sharing a payee.
3. **Weak signals never aggregate into a strong claim.** Confidence is capped per type before
   clustering.
4. **Traversal is bounded.** Depth ≤ 3, nodes ≤ 500, 3 s budget.
5. **The visualisation is not the data.** A list view exposes the same information.

---

## 3. Node types

| Type | Key format | Attributes (examples) |
| --- | --- | --- |
| `domain` | `domain:<host>` | `age_days`, `registrar`, `is_verified`, `tld` |
| `url` | `url:<normalised>` | `path_depth`, `has_query`, `intent_seen` |
| `ip` | `ip:<canonical>` | `asn`, `country`, `is_hosting` |
| `asn` | `asn:<number>` | `name`, `country` |
| `nameserver` | `nameserver:<host>` | `provider_family` |
| `certificate` | `certificate:<sha256>` | `issuer`, `not_after`, `key_bits` |
| `certificate_authority` | `ca:<issuer_cn>` | `root`, `incident_ids` |
| `organisation` | `organisation:<id>` | `name`, `sector`, `verified_domains` |
| `payment_recipient` | `payee:<type>:<value>` | `type`, `display_handle`, `report_count` |
| `threat_report` | `report:<id>` | `status`, `channel`, `created_at` |
| `campaign` | `campaign:<id>` | `name`, `confidence` |

That is eleven types; `THREAT_GRAPH` §3 in `API_CONTRACTS.md` lists them and this table is canonical.

---

## 4. Edge types

| Type | From → To | Meaning | Base confidence |
| --- | --- | --- | --- |
| `RESOLVES_TO` | domain → ip | DNS A/AAAA | 1.0 |
| `MANAGED_BY` | domain → nameserver | NS record | 1.0 |
| `MAIL_ROUTED_BY` | domain → nameserver/host | MX | 0.9 |
| `PRESENTS` | domain → certificate | Observed leaf | 1.0 |
| `ISSUED_BY` | certificate → ca | Issuer chain | 1.0 |
| `CHAINS_TO_ROOT` | ca → ca | Intermediate → root | 1.0 |
| `HOSTS` | ip → url | URL served from IP | 0.9 |
| `REDIRECTS_TO` | url → url | HTTP redirect hop | 1.0 |
| `SUBMITS_TO` | url → url | Form action target | 0.85 |
| `REQUESTS_PAYMENT_TO` | url → payment_recipient | Payee extracted | 0.9 |
| `IMPERSONATES` | domain → organisation | Claim + similarity | 0.3–0.95 |
| `REPORTED_AS` | url/domain → threat_report | Report subject | 1.0 |
| `SHARES_NAMESERVER_WITH` | domain → domain | Same NS set | 0.35 |
| `SHARES_CA_WITH` | domain → domain | Same issuer + window | 0.20 |
| `SHARES_HOSTING_WITH` | domain → domain | Same /24 | 0.15 |
| `SHARES_PAYEE_WITH` | url → url | Same payee | 0.30 |
| `SHARES_DOM_FINGERPRINT` | url → url | Kit reuse | 0.25 |
| `MEMBER_OF_CAMPAIGN` | entity → campaign | Clustering | cluster confidence |

Nineteen types. `SHARES_*` edges are **symmetric**; the others are directed. Symmetric edges are
stored once (canonical ordering by ID) and queried in both directions.

---

## 5. Confidence rules

- Direct observations (DNS, TLS, redirect, form action) → 1.0 or near; they are facts.
- Inferred relationships (`IMPERSONATES`, `SHARES_*`) → weighted, capped.
- `IMPERSONATES` = `0.4 × token_similarity + 0.35 × logo_similarity + 0.25 × domain_similarity`,
  capped at 0.95 (never 1.0: similarity is not proof).
- `SHARES_NAMESERVER_WITH` = 0.35 base, +0.05 per additional shared NS, capped 0.5.
- Confidence decays if not re-observed: ×0.9 per 90 days, floor 0.05. A stale edge is not evidence.

---

## 6. Clustering

### 6.1 Weighted overlap

For a candidate pair, compute the weighted Jaccard over shared neighbours:

```
score = Σ weight(feature) × shared(feature) / Σ weight(feature) × union(feature)
```

Weights are the base weights in §4. Cluster when `score ≥ 0.45` and at least **two distinct feature
types** are shared. One shared nameserver is never enough, no matter how many domains share it.

### 6.2 Deny-list (never a relationship)

These produce noise, not intelligence:

- Shared CDN providers (Cloudflare, Fastly, Akamai, CloudFront, Google, Azure Front Door).
- Shared public DNS resolvers.
- Shared e-mail providers (Google Workspace, Microsoft 365, Zoho) unless combined with a payee or
  certificate match.
- Shared TLS issuers when the issuer is a high-volume public CA (Let's Encrypt R3, DigiCert G2):
  `SHARES_CA_WITH` requires **issuer + a ±7-day validity window + another shared feature**.
- Shared cloud IP ranges (AWS/GCP/Azure /16 blocks) for `SHARES_HOSTING_WITH`; only /24 counts.

The deny-list lives in `app/intelligence/denylist.py` and is unit-tested. Without it the graph becomes
a hairball and every domain on Cloudflare becomes "related".

### 6.3 Cluster confidence

**Indicator strength** (implementation definition): for each shared feature type,
`reliability × (members sharing it / cluster size)`, with reliability payee 0.95, data-collection
(form-action) host 0.90, nameserver set 0.80, /24 hosting 0.60. Edge base confidences in §4 describe
single pairwise edges and are not used as indicator strengths (they would cap any cluster at 0.40).
Pair-clustering features: nameserver set, /24, payee, form-action host; public CAs are never a feature
(§6.2). The seeded cluster scores 0.80. Naming uses the lure word of the highest-risk member
("Northstar admissions cluster").

`campaign.confidence = min(strength of the strongest two indicators)` — not an average, which would
let many weak signals masquerade as strong. A cluster also needs ≥ 2 members with ≥ 2 shared features.

### 6.4 Naming

Generated, deterministic: `"<brand or tld> <lure> cluster"`, e.g. "Northstar admissions cluster".
Analysts may edit the summary, not the membership.

---

## 7. Traversal

```mermaid
graph LR
    D1[apply.northstar-admissions.example] -->|RESOLVES_TO| IP1[203.0.113.10]
    D1 -->|MANAGED_BY| NS1[ns1.badhost.example]
    D1 -->|PRESENTS| C1[cert:9f2a...]
    C1 -->|ISSUED_BY| CA1[ca:R3]
    D1 -->|IMPERSONATES 0.91| O1[organisation:Northstar]
    U1[url:/register] -->|SUBMITS_TO| U2[collect.badhost.example/login]
    U3[url:/pay] -->|REQUESTS_PAYMENT_TO| P1[payee:upi:fees@okaxis]
    D1 -.->|SHARES_NAMESERVER_WITH 0.35| D2[apply.northstar-scholarships.example]
    D2 -->|SHARES_PAYEE_WITH 0.30| D1
    D1 -->|MEMBER_OF_CAMPAIGN 0.72| CAMP[campaign:Northstar admissions cluster]
```

Query (depth ≤ 3, both directions for symmetric edges):

```sql
WITH RECURSIVE walk(entity_id, depth) AS (
  SELECT :root::char(26), 0
  UNION
  SELECT CASE WHEN r.source_entity_id = w.entity_id
              THEN r.target_entity_id ELSE r.source_entity_id END,
         w.depth + 1
  FROM walk w
  JOIN relationships r
    ON r.source_entity_id = w.entity_id OR r.target_entity_id = w.entity_id
  WHERE w.depth < :depth AND r.confidence >= :min_confidence
)
SELECT e.*, min(w.depth) AS depth
FROM walk w JOIN entities e ON e.id = w.entity_id
GROUP BY e.id
LIMIT :cap;
```

Performance: at 10k entities / 40k edges this runs in ~40 ms locally. The service adds a statement
timeout (3 s) and a node cap (500). If the cap is hit, the response sets `truncated: true` and reports
the counts — never silently returns a partial graph as if complete.

---

## 8. Visualisation (Cytoscape.js)

| Concern | Decision |
| --- | --- |
| Layout | `cose` (default), `concentric` (campaign), `dagre`-like for redirect chains (FUTURE) |
| Node size | 28 px, organisation 34 px, campaign 40 px |
| Edge width | 1 px; 2 px when selected |
| Edge opacity | `0.25 + 0.75 × confidence` |
| Edge style | solid ≥ 0.6, dashed < 0.6, dotted < 0.3 |
| Labels | Node label always; edge label on hover/select only (avoids clutter) |
| Filtering | Node type toggles, edge type toggles, min-confidence slider (default 0.5) |
| Selection | Node → drawer with attributes, edges, actions; edge → evidence drawer |
| Performance | Cap 500 nodes rendered; warn above 300 |
| Accessibility | List view toggle + text summary above canvas |

Colour is defined in `DESIGN_SYSTEM.md` §7.9; it never encodes the only information (shape + label +
dash pattern also differ).

---

## 9. Storage

No separate graph store. `entities` + `relationships` (§DATABASE_DESIGN 6.1–6.2) with:

- `UNIQUE(source, target, type)` for idempotent upserts.
- Composite indexes on both directions.
- `observed_count` incremented on re-observation; `last_seen_at` updated.
- `evidence_ids` array pointing at `evidence` rows.

Upsert rule: a new observation of an existing edge raises confidence toward the base value
(`new = max(old, base)`), increments `observed_count`, and refreshes `last_seen_at`. It never lowers
confidence; decay is the only downward force.

---

## 10. Campaign persistence

`campaigns` rows with `MEMBER_OF_CAMPAIGN` edges. Recomputed on:

- report confirmation,
- a scan that adds a new payee/nameserver/certificate link,
- a manual analyst trigger.

Recomputation is idempotent: existing campaigns are matched by member overlap (> 50% Jaccard) and
updated rather than duplicated; otherwise a new campaign is created.

---

## 11. Query API

`GET /intelligence/graph/{entityId}` → nodes, edges, counts, `truncated`.
`GET /campaigns` → list with confidence and member counts.
`GET /campaigns/{id}` → members + shared indicators.

Both are documented in `API_ENDPOINTS.md` §12. Clients never compute confidence; they filter on it.

---

## 12. Failure and degradation

| Failure | Behaviour |
| --- | --- |
| Statement timeout | `422 GRAPH_QUERY_TIMEOUT`; UI suggests lowering depth |
| Node cap hit | `truncated: true`, counts returned |
| Correlation job error | Existing campaigns retained, `INTELLIGENCE_DEGRADED` logged |
| Missing evidence row | Edge rendered with a warning badge; such edges are excluded from clustering |

---

## 13. Acceptance criteria

1. Every edge has ≥ 1 evidence reference and a confidence in (0, 1].
2. Shared Cloudflare nameservers produce **no** `SHARES_NAMESERVER_WITH` edge (deny-list test).
3. A payee shared between two lookalikes produces a `SHARES_PAYEE_WITH` edge at 0.30 and contributes
   to clustering.
4. Depth 4 → `422 GRAPH_DEPTH_EXCEEDED`.
5. A 600-node neighbourhood returns `truncated: true` with correct counts.
6. Campaign confidence equals the minimum of its two strongest indicators.
7. The list view exposes every node and edge the canvas shows.
