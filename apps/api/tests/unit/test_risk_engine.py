"""Risk engine (RISK_ENGINE.md §14) including the worked example (§5.2)."""

from __future__ import annotations

import string
from decimal import Decimal

import pytest

from app.risk.codes import RULES
from app.risk.engine import Finding, compute_coverage, decide, score
from app.risk.reasons import FORBIDDEN_WORDS, TEMPLATES, reasons, render
from app.schemas.enums import CoverageState, Decision, Intent, RiskLevel, SignalGroup

ALL_COLLECTED = {g: CoverageState.COLLECTED for g in SignalGroup}


def f(code: str, conf: str = "1.00", **kw) -> Finding:  # type: ignore[no-untyped-def]
    return Finding(code=code, confidence=Decimal(conf), detail="", **kw)


WORKED_EXAMPLE = [
    f("DOMAIN_NOT_REGISTERED_BY_BRAND", "0.95"),
    f("LOGO_NEAR_DUPLICATE", "0.80"),
    f("CREDENTIAL_DESTINATION_MISMATCH", "0.90"),
    f(
        "PAYEE_NOT_IN_VERIFIED_PROFILE",
        "1.00",
        observed={"payee": "fees@okaxis", "match": "none"},
        expected={"payees": ["fees@northstar-demo"]},
    ),
    f("SHARES_INFRA_WITH_REPORTED_THREAT", "0.70"),
    f("DOMAIN_RECENTLY_REGISTERED", "1.00"),
]


def test_worked_example_scores_62_high_and_o2_forces_block() -> None:
    verdict = decide(WORKED_EXAMPLE, compute_coverage(ALL_COLLECTED), Intent.PAYMENT)
    assert verdict.risk_score == 62
    assert verdict.risk_level == RiskLevel.HIGH
    assert verdict.decision == Decision.BLOCK
    assert "O-2" in verdict.overrides
    assert verdict.contributions == {
        SignalGroup.REPUTATION: 0,
        SignalGroup.IDENTITY: 25,
        SignalGroup.CREDENTIAL_DESTINATION: 18,
        SignalGroup.PAYMENT_DESTINATION: 15,
        SignalGroup.INFRASTRUCTURE: 4,
    }


def test_worked_example_for_browse_is_warn_without_override() -> None:
    verdict = decide(WORKED_EXAMPLE, compute_coverage(ALL_COLLECTED), Intent.BROWSE)
    assert verdict.decision == Decision.WARN
    assert verdict.overrides == ()


def test_determinism() -> None:
    cov = compute_coverage(ALL_COLLECTED)
    first = decide(WORKED_EXAMPLE, cov, Intent.PAYMENT)
    assert all(decide(WORKED_EXAMPLE, cov, Intent.PAYMENT) == first for _ in range(5))
    ctx = {"org": "Northstar University", "domain": "apply.northstar-admissions.example"}
    assert reasons(WORKED_EXAMPLE, ctx) == reasons(list(reversed(WORKED_EXAMPLE)), ctx)


def test_group_cap() -> None:
    three = [
        f("CREDENTIAL_DESTINATION_MISMATCH"),
        f("CREDENTIALS_POSTED_OVER_HTTP"),
        f("CREDENTIALS_POSTED_TO_THIRD_PARTY"),
    ]
    assert score(three)[0] == 20


def test_coverage_gates() -> None:
    low = [f("DOMAIN_RECENTLY_REGISTERED")]  # 2 points → LOW
    thirty = compute_coverage(
        {
            SignalGroup.REPUTATION: CoverageState.COLLECTED,
            SignalGroup.IDENTITY: CoverageState.UNAVAILABLE,
        }
    )
    assert thirty.percent == 30
    assert decide(low, thirty, Intent.BROWSE).decision == Decision.REVIEW
    twenty = compute_coverage({SignalGroup.CREDENTIAL_DESTINATION: CoverageState.COLLECTED})
    verdict = decide(low, twenty, Intent.BROWSE)
    assert (verdict.decision, verdict.risk_level) == (Decision.UNKNOWN, RiskLevel.UNKNOWN)


def test_o2_forces_block_even_with_low_score_and_low_coverage() -> None:
    payee = f(
        "PAYEE_NOT_IN_VERIFIED_PROFILE", observed={"match": "none"}, expected={"payees": ["x@y"]}
    )
    cov = compute_coverage({SignalGroup.PAYMENT_DESTINATION: CoverageState.COLLECTED})
    verdict = decide([payee], cov, Intent.PAYMENT)
    assert verdict.risk_score == 15
    assert verdict.decision == Decision.BLOCK


def test_o2_requires_verified_recipients() -> None:
    payee = f("PAYEE_NOT_IN_VERIFIED_PROFILE", observed={"match": "none"}, expected={"payees": []})
    assert "O-2" not in decide([payee], compute_coverage(ALL_COLLECTED), Intent.PAYMENT).overrides


def test_override_ordering_o1_first() -> None:
    payee = f(
        "PAYEE_NOT_IN_VERIFIED_PROFILE", observed={"match": "none"}, expected={"payees": ["a@b"]}
    )
    fired = decide(
        [payee, f("DOMAIN_ON_ANALYST_BLOCKLIST")], compute_coverage(ALL_COLLECTED), Intent.PAYMENT
    )
    assert fired.overrides[:2] == ("O-1", "O-2")


def test_o4_login_credential_mismatch() -> None:
    verdict = decide(
        [f("CREDENTIAL_DESTINATION_MISMATCH", "0.2")], compute_coverage(ALL_COLLECTED), Intent.LOGIN
    )
    assert verdict.decision == Decision.BLOCK and "O-4" in verdict.overrides


@pytest.mark.parametrize(
    ("code", "intent", "override"),
    [
        ("PAYEE_LINKED_TO_REPORTED_SCAM", Intent.PAYMENT, "O-3"),
        ("CREDENTIALS_POSTED_OVER_HTTP", Intent.LOGIN, "O-4"),
        ("CREDENTIALS_POSTED_TO_THIRD_PARTY", Intent.LOGIN, "O-5"),
        ("KNOWN_MALICIOUS_REPUTATION", Intent.BROWSE, "O-6"),
    ],
)
def test_each_forcing_override(code: str, intent: Intent, override: str) -> None:
    verdict = decide([f(code, "0.1")], compute_coverage(ALL_COLLECTED), intent)
    assert verdict.decision == Decision.BLOCK
    assert override in verdict.overrides


def test_o7_unreachable_without_findings_is_unknown() -> None:
    verdict = decide([], compute_coverage(ALL_COLLECTED), Intent.BROWSE, target_unreachable=True)
    assert verdict.decision == Decision.UNKNOWN and "O-7" in verdict.overrides


def test_positive_findings_never_lower_score() -> None:
    base = [f("DOMAIN_NOT_REGISTERED_BY_BRAND")]
    with_positive = [*base, f("IDENTITY_MATCH_CONFIRMED"), f("PAYEE_MATCH_CONFIRMED")]
    assert score(base)[0] == score(with_positive)[0]


def test_allow_unreachable_with_critical_finding() -> None:
    for code, rule in RULES.items():
        if rule.severity.value != "critical":
            continue
        for intent in Intent:
            verdict = decide([f(code)], compute_coverage(ALL_COLLECTED), intent)
            assert verdict.decision != Decision.ALLOW, (code, intent)


def test_allow_requires_coverage_50() -> None:
    cov = compute_coverage(
        {
            SignalGroup.IDENTITY: CoverageState.COLLECTED,
            SignalGroup.CREDENTIAL_DESTINATION: CoverageState.COLLECTED,
        }
    )
    assert cov.percent == 45
    assert decide([], cov, Intent.LOGIN).decision == Decision.REVIEW


def test_every_code_has_a_template_without_forbidden_words() -> None:
    assert set(TEMPLATES) == set(RULES)
    for code, template in TEMPLATES.items():
        for word in FORBIDDEN_WORDS:
            assert word not in template.lower(), code


def test_templates_render_without_unfilled_slots() -> None:
    ctx = {"org": "Northstar University", "domain": "x.example", "brand": "Northstar"}
    for code in TEMPLATES:
        fields = {name for _, name, _, _ in string.Formatter().parse(TEMPLATES[code]) if name}
        observed = {name: "v" for name in fields}
        text = render(f(code, observed=observed), ctx)
        assert "{" not in text and "}" not in text, code


def test_payee_reason_names_both_values() -> None:
    out = reasons(WORKED_EXAMPLE, {"org": "Northstar University"})
    # Ordered by weight x points: credential 18 > identity 16.6 > payee 15.
    assert "credentials" in out[0] and "verified domains" in out[1]
    assert "fees@okaxis" in out[2] and "fees@northstar-demo" in out[2]
