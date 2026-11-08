"""Narration for message analysis (MESSAGE_ANALYSIS.md §6).

Same contract as scan narration: the model sees only a deterministic evidence pack (masked spans,
finding codes, link verdicts — never the raw message), every claim must cite a pack reference, and
``validate`` drops anything uncited, any safety wording and any contradiction of the decision. The
template narrator always runs first and is what ships when no model is configured.
"""

from __future__ import annotations

from typing import Any

from app.agents.narrative import llm_narrative, validate
from app.config import Settings
from app.logging import get_logger

log = get_logger("message_narrator")

MESSAGE_HEADINGS = (
    "What the message asks for",
    "Who it claims to be",
    "Where the links go",
    "What to do",
    "Limits of this analysis",
)
_ASK = ("MESSAGE_CREDENTIAL_REQUEST", "MESSAGE_PAYMENT_DEMAND", "MESSAGE_URGENCY_PRESSURE")
_WHO = (
    "MESSAGE_IMPERSONATES_ORGANISATION",
    "MESSAGE_LINK_TO_UNVERIFIED_CLAIM",
    "MESSAGE_CONTACT_CHANNEL_MISMATCH",
    "PAYEE_NOT_IN_VERIFIED_PROFILE",
    "PAYEE_MATCH_CONFIRMED",
    "PAYEE_UNVERIFIABLE",
    "PAYEE_LINKED_TO_REPORTED_SCAM",
    "IDENTITY_MATCH_CONFIRMED",
)
ADVICE = {
    "BLOCK": (
        "Do not reply, pay, share codes or open the links. Contact the organisation only through "
        "an address or website you already know, and report the message."
    ),
    "WARN": (
        "Treat this message as a likely scam. Verify it through the organisation's official "
        "website or phone number before acting."
    ),
    "REVIEW": (
        "Do not act on the pressure in this message. Check its claims independently; nothing we "
        "found proves it is a scam, and nothing proves it is genuine."
    ),
    "ALLOW": (
        "We found no known threat in the checks we ran. Still never share one-time codes or "
        "passwords, whoever asks."
    ),
    "UNKNOWN": "We could not check enough to assess this message. Verify it independently.",
}


def build_message_pack(analysis: dict[str, Any]) -> dict[str, Any]:
    """Deterministic pack. F-n = message findings, E-n = assessed links."""
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    refs: list[dict[str, Any]] = []
    findings = []
    for i, f in enumerate(
        sorted(analysis["findings"], key=lambda f: (order[f["severity"]], f["code"])), start=1
    ):
        ref = f"F-{i}"
        refs.append({"id": ref, "kind": "finding", "label": f["title"]})
        observed = dict(f.get("observed") or {})
        findings.append(
            {
                "ref": ref,
                "code": f["code"],
                "severity": f["severity"],
                "title": f["title"],
                "detail": f["detail"],
                "observed": observed,
            }
        )
    links = []
    for i, link in enumerate(analysis["links"], start=1):
        ref = f"E-{i}"
        refs.append({"id": ref, "kind": "evidence", "label": link["registrable_domain"]})
        links.append(
            {
                "ref": ref,
                "domain": link["registrable_domain"],
                "decision": link["decision"],
                "finding_codes": link["finding_codes"],
                "error": link.get("error"),
            }
        )
    claimed = analysis.get("claimed_organisation") or {}
    return {
        "scan": {
            "decision": analysis["decision"],
            "risk_level": analysis["risk_level"],
            "risk_score": analysis["risk_score"],
            "coverage_percent": analysis["coverage"]["percent"],
            "unavailable": analysis["coverage"]["unavailable"],
            "skipped": analysis["coverage"]["skipped"],
            "overrides": analysis["overrides"],
            "kind": "message",
        },
        "claimed_identity": claimed or None,
        "findings": findings,
        "evidence": links,
        "references": refs,
    }


def _ref(pack: dict[str, Any], code: str) -> list[str]:
    return [f["ref"] for f in pack["findings"] if f["code"] == code]


def template_message_narrative(pack: dict[str, Any]) -> dict[str, Any]:
    s = pack["scan"]
    org = (pack.get("claimed_identity") or {}).get("name")
    by_code = {f["code"]: f for f in pack["findings"]}
    sections: list[dict[str, Any]] = []

    ask = [{"text": by_code[c]["detail"], "refs": _ref(pack, c)} for c in _ASK if c in by_code]
    if not ask:
        ask = [{"text": "The message does not ask for codes, passwords or a payment.", "refs": []}]
    if "MESSAGE_URGENCY_PRESSURE" in by_code:
        ask.append(
            {
                "text": "Pressure language is noted but never treated as proof on its own.",
                "refs": _ref(pack, "MESSAGE_URGENCY_PRESSURE"),
            }
        )
    sections.append({"heading": MESSAGE_HEADINGS[0], "claims": ask})

    who = [{"text": by_code[c]["detail"], "refs": _ref(pack, c)} for c in _WHO if c in by_code]
    if not who:
        who = [
            {
                "text": f"The message names {org}."
                if org
                else "The message names no organisation "
                "with a verified profile, so its identity could not be checked.",
                "refs": [],
            }
        ]
    sections.append({"heading": MESSAGE_HEADINGS[1], "claims": who})

    links = [
        {
            "text": (
                f"{e['domain']} could not be assessed ({e['error'] or 'unavailable'})."
                if e["decision"] is None
                else f"{e['domain']} was assessed {e['decision']} by the URL pipeline."
            ),
            "refs": [e["ref"]],
        }
        for e in pack["evidence"]
    ] or [{"text": "The message contains no links.", "refs": []}]
    sections.append({"heading": MESSAGE_HEADINGS[2], "claims": links})

    sections.append(
        {"heading": MESSAGE_HEADINGS[3], "claims": [{"text": ADVICE[s["decision"]], "refs": []}]}
    )
    limits = [
        {
            "text": f"Coverage {s['coverage_percent']}%. Senders can be spoofed; we read only the "
            "From line and the visible text.",
            "refs": [],
        }
    ]
    if s["overrides"]:
        limits.append(
            {"text": "Decision policy applied: " + ", ".join(s["overrides"]) + ".", "refs": []}
        )
    sections.append({"heading": MESSAGE_HEADINGS[4], "claims": limits})
    return {"sections": sections}


async def narrate(analysis: dict[str, Any], settings: Settings) -> dict[str, Any]:
    pack = build_message_pack(analysis)
    template = template_message_narrative(pack)
    if not settings.llm_configured:
        return {"source": "template", **template}
    try:
        draft, _meta = await llm_narrative(pack, settings, headings=MESSAGE_HEADINGS)
        narrative, dropped, error = validate(draft, pack, headings=MESSAGE_HEADINGS)
    except Exception as exc:  # noqa: BLE001 — any model failure falls back to the template
        log.warning("message.narrative_failed", extra={"error": type(exc).__name__})
        return {"source": "template", "fallback_reason": "model_unavailable", **template}
    if narrative is None:
        return {"source": "template", "fallback_reason": error or "invalid", **template}
    return {"source": "llm", "dropped_claims": len(dropped), **narrative}
