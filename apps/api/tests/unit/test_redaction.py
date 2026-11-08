"""Evidence redaction (DATABASE_DESIGN.md §12): secrets never reach storage."""

from __future__ import annotations

from app.security.redaction import redact, redact_text


def test_bearer_token_redacted() -> None:
    out = redact_text("Authorization: Bearer eyJhbGciOi.abc-def_ghi")
    assert "eyJhbGciOi" not in out and "Bearer [redacted]" in out


def test_password_and_token_pairs_in_text() -> None:
    out = redact_text("login?password=hunter2&user=a and token=abc123")
    assert "hunter2" not in out and "abc123" not in out
    assert "user=a" in out


def test_sensitive_query_params_in_url() -> None:
    out = redact_text("https://collect.badhost.example/cb?session=s3cr3t&page=2&otp=123456")
    assert "s3cr3t" not in out and "123456" not in out
    assert "page=2" in out


def test_card_like_digit_runs() -> None:
    for card in ("4111 1111 1111 1111", "4111-1111-1111-1111", "4111111111111111"):
        out = redact_text(f"paid with {card} yesterday")
        assert "1111" not in out, card


def test_sensitive_dict_keys() -> None:
    payload = {
        "password": "x",
        "otp": "123456",
        "cookie": "sid=1",
        "nested": {"api_key": "tl_live_abc", "note": "fine"},
        "list": [{"Card": "4111111111111111"}],
    }
    out = redact(payload)
    assert out["password"] == out["otp"] == out["cookie"] == "[redacted]"
    assert out["nested"]["api_key"] == "[redacted]"
    assert out["nested"]["note"] == "fine"
    assert out["list"][0]["Card"] == "[redacted]"


def test_fingerprints_and_ordinary_text_untouched() -> None:
    for fingerprint in ("a1" * 32, "07" * 32):
        assert redact_text(fingerprint) == fingerprint
        assert redact({"fingerprint_sha256": fingerprint}) == {"fingerprint_sha256": fingerprint}
    text = "Page 'Northstar University — Admissions 2026': 1 password field(s), 2 form(s)"
    assert redact_text(text) == text


def test_non_string_values_pass_through() -> None:
    assert redact({"age_days": 12, "verified": True, "a": None}) == {
        "age_days": 12,
        "verified": True,
        "a": None,
    }
