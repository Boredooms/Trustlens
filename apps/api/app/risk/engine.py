"""Deterministic scoring and decision policy (RISK_ENGINE.md §3–§9).

Pure functions. Same inputs ⇒ same output. No model, no I/O, no randomness. The LLM never calls into
this module to change anything; investigations only read its output.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.risk.codes import TARGET_UNREACHABLE, rule
from app.schemas.enums import CoverageState, Decision, Intent, RiskLevel, Severity, SignalGroup

GROUP_WEIGHTS: dict[SignalGroup, int] = {
    SignalGroup.REPUTATION: 30,
    SignalGroup.IDENTITY: 25,
    SignalGroup.CREDENTIAL_DESTINATION: 20,
    SignalGroup.PAYMENT_DESTINATION: 15,
    SignalGroup.INFRASTRUCTURE: 10,
}
SEVERITY_POINTS: dict[Severity, Decimal] = {
    Severity.CRITICAL: Decimal("1.00"),
    Severity.HIGH: Decimal("0.70"),
    Severity.MEDIUM: Decimal("0.40"),
    Severity.LOW: Decimal("0.15"),
    Severity.INFO: Decimal("0.00"),
}
# §12 intent gating: which groups are evaluated per intent.
INTENT_GROUPS: dict[Intent, frozenset[SignalGroup]] = {
    Intent.BROWSE: frozenset(
        {SignalGroup.REPUTATION, SignalGroup.IDENTITY, SignalGroup.INFRASTRUCTURE}
    ),
    Intent.LOGIN: frozenset(GROUP_WEIGHTS) - {SignalGroup.PAYMENT_DESTINATION},
    Intent.PAYMENT: frozenset(GROUP_WEIGHTS),
    Intent.DOWNLOAD: frozenset(
        {SignalGroup.REPUTATION, SignalGroup.IDENTITY, SignalGroup.INFRASTRUCTURE}
    ),
    Intent.DATA_SUBMISSION: frozenset(GROUP_WEIGHTS),
}
# §8.2 band table.
BAND_DECISIONS: dict[RiskLevel, dict[Intent, Decision]] = {
    RiskLevel.CRITICAL: {i: Decision.BLOCK for i in Intent},
    RiskLevel.HIGH: {
        Intent.BROWSE: Decision.WARN,
        Intent.LOGIN: Decision.BLOCK,
        Intent.PAYMENT: Decision.BLOCK,
        Intent.DOWNLOAD: Decision.WARN,
        Intent.DATA_SUBMISSION: Decision.BLOCK,
    },
    RiskLevel.MEDIUM: {i: Decision.WARN for i in Intent},
    RiskLevel.LOW: {i: Decision.ALLOW for i in Intent},
}
_DECISION_RANK = {
    Decision.UNKNOWN: 0,
    Decision.ALLOW: 1,
    Decision.REVIEW: 2,
    Decision.WARN: 3,
    Decision.BLOCK: 4,
}


@dataclass(frozen=True)
class Finding:
    """A rule outcome before persistence. ``observed``/``expected`` feed reasons and the UI."""

    code: str
    confidence: Decimal
    detail: str
    observed: Mapping[str, Any] | None = None
    expected: Mapping[str, Any] | None = None
    evidence_keys: tuple[str, ...] = ()
    severity_override: Severity | None = None  # documented exceptions only (R-INF-01, R-INF-09)
    simulated: bool = False

    @property
    def rule(self):  # type: ignore[no-untyped-def]
        return rule(self.code)

    @property
    def group(self) -> SignalGroup:
        return rule(self.code).group

    @property
    def severity(self) -> Severity:
        return self.severity_override or rule(self.code).severity

    @property
    def points(self) -> Decimal:
        return SEVERITY_POINTS[self.severity] * self.confidence


@dataclass(frozen=True)
class CoverageResult:
    percent: int
    collected: tuple[SignalGroup, ...]
    unavailable: tuple[SignalGroup, ...]
    skipped: tuple[SignalGroup, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "percent": self.percent,
            "collected": [g.value for g in self.collected],
            "unavailable": [g.value for g in self.unavailable],
            "skipped": [g.value for g in self.skipped],
        }


@dataclass(frozen=True)
class Verdict:
    decision: Decision
    risk_level: RiskLevel
    risk_score: int
    coverage: CoverageResult
    overrides: tuple[str, ...]
    contributions: dict[SignalGroup, int] = field(default_factory=dict)


def compute_coverage(states: Mapping[SignalGroup, CoverageState]) -> CoverageResult:
    """§6: coverage = Σ weight of collected groups. Missing entries count as unavailable."""
    order = list(GROUP_WEIGHTS)
    collected = tuple(g for g in order if states.get(g) == CoverageState.COLLECTED)
    skipped = tuple(g for g in order if states.get(g) == CoverageState.SKIPPED)
    unavailable = tuple(g for g in order if g not in collected and g not in skipped)
    return CoverageResult(
        percent=sum(GROUP_WEIGHTS[g] for g in collected),
        collected=collected,
        unavailable=unavailable,
        skipped=skipped,
    )


def _round_half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def score(findings: Iterable[Finding]) -> tuple[int, dict[SignalGroup, int]]:
    """§5.1: group_raw = min(1, Σ points×confidence); contribution = round(weight × raw)."""
    raw: dict[SignalGroup, Decimal] = {g: Decimal(0) for g in GROUP_WEIGHTS}
    for finding in findings:
        raw[finding.group] += finding.points
    contributions = {
        g: _round_half_up(Decimal(GROUP_WEIGHTS[g]) * min(Decimal(1), raw[g]))
        for g in GROUP_WEIGHTS
    }
    return min(100, sum(contributions.values())), contributions


def band(risk_score: int) -> RiskLevel:
    if risk_score >= 75:
        return RiskLevel.CRITICAL
    if risk_score >= 50:
        return RiskLevel.HIGH
    if risk_score >= 25:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def overrides_for(
    findings: Iterable[Finding], intent: Intent, *, target_unreachable: bool = False
) -> list[tuple[str, Decision]]:
    """§8.1, evaluated in order. Returns every override that fired with its forced decision."""
    by_code: dict[str, Finding] = {f.code: f for f in findings}
    fired: list[tuple[str, Decision]] = []
    if "DOMAIN_ON_ANALYST_BLOCKLIST" in by_code:
        fired.append(("O-1", Decision.BLOCK))
    payee = by_code.get("PAYEE_NOT_IN_VERIFIED_PROFILE")
    if (
        payee is not None
        and intent == Intent.PAYMENT
        and (payee.observed or {}).get("match", "none") == "none"
        and len((payee.expected or {}).get("payees", [])) >= 1
    ):
        fired.append(("O-2", Decision.BLOCK))
    if "PAYEE_LINKED_TO_REPORTED_SCAM" in by_code and intent == Intent.PAYMENT:
        fired.append(("O-3", Decision.BLOCK))
    if intent == Intent.LOGIN and (
        "CREDENTIAL_DESTINATION_MISMATCH" in by_code or "CREDENTIALS_POSTED_OVER_HTTP" in by_code
    ):
        fired.append(("O-4", Decision.BLOCK))
    third_party = by_code.get("CREDENTIALS_POSTED_TO_THIRD_PARTY")
    if third_party is not None and intent == Intent.LOGIN:
        fired.append(("O-5", Decision.BLOCK))
    if "KNOWN_MALICIOUS_REPUTATION" in by_code or "LISTED_BY_EXTERNAL_FEED" in by_code:
        # O-6: confirmed internally, or listed by an attributed external feed (R-REP-06).
        fired.append(("O-6", Decision.BLOCK))
    scored = [f for f in by_code.values() if f.severity != Severity.INFO]
    if target_unreachable and not scored:
        fired.append(("O-7", Decision.UNKNOWN))
    return fired


def decide(
    findings: list[Finding],
    coverage: CoverageResult,
    intent: Intent,
    *,
    target_unreachable: bool = False,
) -> Verdict:
    risk_score, contributions = score(findings)
    level = band(risk_score)
    decision = BAND_DECISIONS[level][intent]

    fired = overrides_for(findings, intent, target_unreachable=target_unreachable)
    forced_block = any(d == Decision.BLOCK for _, d in fired)
    for _, forced in fired:
        # An override can only raise the decision; O-7 (UNKNOWN) applies only with no findings.
        if forced == Decision.UNKNOWN or _DECISION_RANK[forced] > _DECISION_RANK[decision]:
            decision = forced

    # §8.4.3: a page claiming two organisations caps the decision at WARN (unless forced BLOCK).
    if any((f.observed or {}).get("conflicting_claims") for f in findings) and not forced_block:
        if _DECISION_RANK[decision] > _DECISION_RANK[Decision.WARN]:
            decision = Decision.WARN

    # §8.5 critical floor: ALLOW is unreachable while any critical finding exists.
    if decision == Decision.ALLOW and any(f.severity == Severity.CRITICAL for f in findings):
        decision = Decision.WARN

    # §8.3 coverage gate, after banding and overrides.
    if coverage.percent < 25:
        if not forced_block:
            decision, level = Decision.UNKNOWN, RiskLevel.UNKNOWN
    elif coverage.percent < 50 and decision == Decision.ALLOW:
        decision = Decision.REVIEW

    return Verdict(
        decision=decision,
        risk_level=level,
        risk_score=risk_score,
        coverage=coverage,
        overrides=tuple(oid for oid, _ in fired),
        contributions=contributions,
    )


def is_unreachable_code(code: str) -> bool:
    return code == TARGET_UNREACHABLE


def decide_message(findings: list[Finding], coverage: CoverageResult, intent: Intent) -> Verdict:
    """Message decision policy (RISK_ENGINE.md §8.1a, MESSAGE_ANALYSIS.md §5).

    ``decide`` first; then O-10 (a linked page was blocked), O-8 (language alone is exactly REVIEW),
    O-9 (uncorroborated requests stay between REVIEW and WARN), and a WARN floor once anything
    corroborates. These caps exist only for messages: language must never condemn on its own.
    """
    from app.risk.codes import CORROBORATING_CODES, LANGUAGE_ONLY_CODES, SENDER_VERIFIED_CODES

    base = decide(findings, coverage, intent)
    if base.decision == Decision.UNKNOWN:
        return base  # coverage gate: nothing to cap
    decision: Decision = base.decision
    level: RiskLevel = base.risk_level
    fired = list(base.overrides)
    codes = {f.code for f in findings}
    scored = {f.code for f in findings if f.severity != Severity.INFO}
    corroborated = bool(codes & CORROBORATING_CODES)

    def apply(new: Decision, override_id: str) -> None:
        nonlocal decision
        if new != decision:
            decision = new
            fired.append(override_id)

    if "MESSAGE_LINK_BLOCKED" in codes:
        apply(Decision.BLOCK, "O-10")
    elif scored and scored <= LANGUAGE_ONLY_CODES:
        apply(Decision.REVIEW, "O-8")
    elif scored and not corroborated and not (codes & SENDER_VERIFIED_CODES):
        if _DECISION_RANK[decision] > _DECISION_RANK[Decision.WARN]:
            apply(Decision.WARN, "O-9")
        elif _DECISION_RANK[decision] < _DECISION_RANK[Decision.REVIEW]:
            apply(Decision.REVIEW, "O-9")
    elif corroborated and _DECISION_RANK[decision] < _DECISION_RANK[Decision.WARN]:
        decision = Decision.WARN
    return Verdict(
        decision=decision,
        risk_level=level,
        risk_score=base.risk_score,
        coverage=coverage,
        overrides=tuple(dict.fromkeys(fired)),
        contributions=base.contributions,
    )
