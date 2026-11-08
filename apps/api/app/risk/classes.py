"""Problem-statement risk classes, derived from ``Decision`` in exactly one place.

Owner: docs/03-backend/RISK_ENGINE.md §8.7. Never stored, never computed by a client. A change to
this mapping is an engine version bump.
"""

from __future__ import annotations

from app.schemas.enums import Decision

RISK_CLASS: dict[Decision, str] = {
    Decision.BLOCK: "confirmed_malicious",
    Decision.WARN: "high",
    Decision.REVIEW: "suspicious",
    Decision.ALLOW: "low",
    Decision.UNKNOWN: "inconclusive",
}
ABSENCE_CAVEAT = "Absence of evidence is not evidence of safety."


def risk_class(decision: Decision | str) -> str:
    return RISK_CLASS[Decision(decision)]


def caveat(decision: Decision | str) -> str | None:
    return ABSENCE_CAVEAT if risk_class(decision) in ("low", "inconclusive") else None
