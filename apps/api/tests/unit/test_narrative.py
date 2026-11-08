"""Narration contract (AI_INVESTIGATION_ENGINE.md): every claim cited, bad claims dropped."""

from __future__ import annotations

from typing import Any

from app.agents.narrative import build_pack, template_narrative, validate

FINDINGS: list[dict[str, Any]] = [
    {
        "id": f"01F{i:023d}",
        "code": code,
        "severity": sev,
        "title": code.replace("_", " ").title(),
        "detail": "detail",
        "observed": observed,
        "expected": expected,
        "simulated": True,
    }
    for i, (code, sev, observed, expected) in enumerate(
        [
            ("DOMAIN_NOT_REGISTERED_BY_BRAND", "high", {"domain": "apply.x.example"}, None),
            ("LOGO_NEAR_DUPLICATE", "medium", {"distance": 2}, None),
            (
                "CREDENTIAL_DESTINATION_MISMATCH",
                "critical",
                {"destination": "collect.badhost.example"},
                {"destinations": ["login.northstar-demo.example"]},
            ),
            (
                "PAYEE_NOT_IN_VERIFIED_PROFILE",
                "critical",
                {"payee": "fees@okaxis", "match": "none"},
                {"payees": ["fees@northstar-demo"]},
            ),
            (
                "SHARES_INFRA_WITH_REPORTED_THREAT",
                "medium",
                {"shared": "nameservers ns1.badhost.example"},
                None,
            ),
            ("DOMAIN_RECENTLY_REGISTERED", "low", {"age_days": 12}, None),
        ]
    )
]
EVIDENCE = [
    {"id": "01E0000000000000000000000" + s[0].upper(), "source": s, "summary": f"{s} evidence"}
    for s in ("dns", "rdap", "tls", "page")
]
SCAN = {
    "id": "01S00000000000000000000000",
    "url": "https://apply.northstar-admissions.example/register",
    "intent": "payment",
    "decision": "BLOCK",
    "risk_level": "HIGH",
    "risk_score": 62,
    "engine_version": "1.0.0",
    "simulated": True,
    "coverage": {"percent": 100, "unavailable": [], "skipped": []},
    "overrides": ["O-2"],
    "reasons": [],
    "result": {
        "action": {
            "claimed_organisation": {"id": "x", "name": "Northstar University"},
            "payee": "fees@okaxis",
        }
    },
}


def pack() -> dict[str, Any]:
    related = [
        {
            "id": "01G00000000000000000000000",
            "type": "nameserver",
            "label": "ns1.badhost.example",
            "edge": "MANAGED_BY",
            "confidence": 1.0,
        }
    ]
    return build_pack(SCAN, FINDINGS, EVIDENCE, related, {"reports": 1, "confirmed": 0})


def test_template_has_five_cited_claims() -> None:
    p = pack()
    narrative = template_narrative(p)
    known = {r["id"] for r in p["references"]}
    claims = [c for s in narrative["sections"] for c in s["claims"]]
    assert len(claims) >= 5
    assert all(c["refs"] and set(c["refs"]) <= known for c in claims)
    text = " ".join(c["text"] for c in claims)
    assert "fees@okaxis" in text and "fees@northstar-demo" in text


def test_template_survives_its_own_validation() -> None:
    p = pack()
    narrative, dropped, error = validate(template_narrative(p), p)
    assert error is None and dropped == []
    assert narrative is not None


def test_validate_drops_and_records_bad_claims() -> None:
    p = pack()
    good = {
        "text": "The domain is not one of Northstar University's verified domains.",
        "refs": ["F-3"],
    }
    draft = {
        "sections": [
            {
                "heading": "What this page asks for",
                "claims": [
                    good,
                    {
                        "text": "The site is hosted on a bulletproof provider in X.",
                        "refs": ["F-99"],
                    },
                ],
            },
            {
                "heading": "Why it is not the organisation",
                "claims": [
                    good,
                    {"text": "On balance this site looks safe to use.", "refs": ["F-1"]},
                ],
            },
            {
                "heading": "What to do",
                "claims": [
                    good,
                    {"text": "The engine would ALLOW this payment in most cases.", "refs": ["F-1"]},
                ],
            },
        ]
    }
    narrative, dropped, error = validate(draft, p)
    reasons = sorted(d["reason"] for d in dropped)
    assert reasons == ["contradicts_decision", "safety_language", "unknown_refs"]
    assert error is None and narrative is not None
    assert all(c == good for s in narrative["sections"] for c in s["claims"])


def test_validate_rejects_non_schema_output() -> None:
    narrative, _, error = validate({"text": "free prose"}, pack())
    assert narrative is None and error


def test_validate_rejects_unknown_heading_and_too_few_sections() -> None:
    draft = {
        "sections": [
            {"heading": "Attacker biography", "claims": [{"text": "x" * 30, "refs": ["F-1"]}]},
            {
                "heading": "What to do",
                "claims": [{"text": "Do not pay this page; report it.", "refs": ["F-1"]}],
            },
        ]
    }
    narrative, _, error = validate(draft, pack())
    assert narrative is None and error
