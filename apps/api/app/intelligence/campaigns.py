"""Campaign clustering (THREAT_GRAPH.md §6, §10).

Candidates are domains that impersonate an organisation. Features come from each domain's latest
scan: nameserver set, /24 hosting range, payees and credential/payment sink hosts.

- Pair score: weighted Jaccard over shared features; cluster when ≥ 0.45 **and** ≥ 2 distinct
  feature types are shared (one shared nameserver is never enough).
- Indicator strength = feature reliability × share of members that have it.
- Campaign confidence = min(strength of the two strongest indicators) — not an average.
- Deny-list: high-volume public CAs never count (``SHARES_CA_WITH`` is not used as a feature).
"""

from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.graph import upsert_edge, upsert_entity
from app.models.tables import Campaign, Entity, Relationship, Scan
from app.utils import new_ulid, utcnow

FEATURE_WEIGHTS = {"nameserver": 0.35, "hosting": 0.15, "payee": 0.30, "sink": 0.30}
FEATURE_RELIABILITY = {"payee": 0.95, "sink": 0.90, "nameserver": 0.80, "hosting": 0.60}
FEATURE_LABELS = {
    "nameserver": "Shared nameservers",
    "hosting": "Shared hosting /24",
    "payee": "Shared payee",
    "sink": "Shared data-collection host",
}
PUBLIC_NS_DENYLIST = ("cloudflare.com", "awsdns", "googledomains.com", "azure-dns")
LURE_WORDS = ("admissions", "scholarships", "scholarship", "placement", "fees", "results", "exam")
MIN_PAIR_SCORE = 0.45


def _features(scan: Scan) -> dict[str, set[str]]:
    result: dict[str, Any] = scan.result or {}
    dns = result.get("dns", {})
    action = result.get("action", {})
    page = result.get("page", {})
    features: dict[str, set[str]] = {
        "nameserver": {n for n in dns.get("ns", []) if not any(d in n for d in PUBLIC_NS_DENYLIST)},
        "hosting": {".".join(a.split(".")[:3]) + ".0/24" for a in dns.get("a", [])},
        "payee": {action["payee"]} if action.get("payee") else set(),
        "sink": {
            h
            for h in (urlsplit(u).hostname for u in page.get("form_actions", []) if u)
            if h and h.split(".", 1)[-1] != scan.registrable_domain
        },
    }
    return features


def pair_score(a: dict[str, set[str]], b: dict[str, set[str]]) -> tuple[float, int]:
    shared_w = union_w = 0.0
    shared_types = 0
    for feature, weight in FEATURE_WEIGHTS.items():
        inter, union = a[feature] & b[feature], a[feature] | b[feature]
        shared_w += weight * len(inter)
        union_w += weight * len(union)
        shared_types += bool(inter)
    return (shared_w / union_w if union_w else 0.0), shared_types


def indicators(members: list[dict[str, set[str]]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for feature in FEATURE_WEIGHTS:
        counts = Counter(v for m in members for v in m[feature])
        for value, n in counts.items():
            if n >= 2:
                strength = FEATURE_RELIABILITY[feature] * n / len(members)
                out.append(
                    {
                        "type": feature,
                        "label": FEATURE_LABELS[feature],
                        "value": value,
                        "members": n,
                        "confidence": round(strength, 2),
                    }
                )
    # Collapse values of the same feature type to that type's strongest value.
    best: dict[str, dict[str, Any]] = {}
    for ind in out:
        if ind["type"] not in best or ind["confidence"] > best[ind["type"]]["confidence"]:
            best[ind["type"]] = {
                **ind,
                "values": sorted(i["value"] for i in out if i["type"] == ind["type"]),
            }
    return sorted(best.values(), key=lambda i: -i["confidence"])


def cluster_confidence(inds: list[dict[str, Any]]) -> float:
    top = sorted((i["confidence"] for i in inds), reverse=True)[:2]
    return min(top) if len(top) == 2 else 0.0


async def recompute(db: AsyncSession) -> list[str]:
    """Idempotent: existing campaigns are matched by member overlap (> 50% Jaccard)."""
    impersonating = (
        await db.execute(
            select(Entity.id, Entity.label, Entity.simulated)
            .join(Relationship, Relationship.source_entity_id == Entity.id)
            .where(Relationship.type == "IMPERSONATES", Entity.type == "domain")
        )
    ).all()
    if len(impersonating) < 2:
        return []
    hosts = {label: (eid, simulated) for eid, label, simulated in impersonating}
    scans = (
        await db.execute(
            select(Scan)
            .where(Scan.status.in_(("completed", "partial")))
            .order_by(Scan.created_at.desc())
            .limit(500)
        )
    ).scalars()
    latest: dict[str, Scan] = {}
    for scan in scans:
        host = urlsplit(scan.normalised_url).hostname or ""
        if host in hosts and host not in latest:
            latest[host] = scan
    names = sorted(latest)
    feats = {h: _features(latest[h]) for h in names}

    parent = {h: h for h in names}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            score, types = pair_score(feats[a], feats[b])
            if score >= MIN_PAIR_SCORE and types >= 2:
                parent[find(a)] = find(b)

    groups: dict[str, list[str]] = {}
    for h in names:
        groups.setdefault(find(h), []).append(h)

    campaign_ids = []
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda h: latest[h].created_at)
        inds = indicators([feats[h] for h in members])
        confidence = cluster_confidence(inds)
        if confidence <= 0:
            continue
        campaign_ids.append(await _persist(db, members, hosts, inds, confidence, latest))
    return campaign_ids


def _name(members: list[str], latest: dict[str, Scan]) -> str:
    """Deterministic: brand + the lure of the highest-risk member (ties: earliest seen)."""
    lead = sorted(members, key=lambda h: (-(latest[h].risk_score or 0), latest[h].created_at))[0]
    org = (latest[lead].result or {}).get("action", {}).get("claimed_organisation") or {}
    brand = (org.get("name") or lead.split(".")[1]).split()[0]
    for word in LURE_WORDS:
        if word in lead:
            return f"{brand} {word.rstrip('s') + 's' if word != 'placement' else word} cluster"
    return f"{brand} lookalike cluster"


async def _persist(
    db: AsyncSession,
    members: list[str],
    hosts: dict[str, tuple[str, bool]],
    inds: list[dict[str, Any]],
    confidence: float,
    latest: dict[str, Scan],
) -> str:
    member_ids = {hosts[h][0] for h in members}
    simulated = all(hosts[h][1] for h in members)
    existing = None
    for campaign in (await db.execute(select(Campaign))).scalars():
        entity = (
            await db.execute(select(Entity.id).where(Entity.key == f"campaign:{campaign.id}"))
        ).scalar_one_or_none()
        if entity is None:
            continue
        current = set(
            (
                await db.execute(
                    select(Relationship.source_entity_id).where(
                        Relationship.target_entity_id == entity,
                        Relationship.type == "MEMBER_OF_CAMPAIGN",
                    )
                )
            ).scalars()
        )
        if current and len(current & member_ids) / len(current | member_ids) > 0.5:
            existing = campaign
            break
    now = utcnow()
    conf = Decimal(str(confidence)).quantize(Decimal("0.01"))
    if existing is None:
        existing = Campaign(
            id=new_ulid(),
            name=_name(members, latest),
            confidence=conf,
            member_count=len(members),
            summary=None,
            simulated=simulated,
            first_seen_at=min(latest[h].created_at for h in members),
            last_seen_at=now,
        )
        db.add(existing)
        await db.flush()
    else:
        existing.confidence = conf
        existing.member_count = len(members)
        existing.last_seen_at = now
    campaign_entity = await upsert_entity(
        db,
        "campaign",
        f"campaign:{existing.id}",
        existing.name,
        {"name": existing.name, "confidence": float(conf), "indicators": inds},
        simulated=simulated,
    )
    for member_id in member_ids:
        await upsert_edge(db, member_id, campaign_entity, "MEMBER_OF_CAMPAIGN", confidence=conf)
    return existing.id
