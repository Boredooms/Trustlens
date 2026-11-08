"""Startup validation (ENVIRONMENT_CONFIGURATION.md §6, §9)."""

from __future__ import annotations

import pytest

from app.config import ConfigurationError, Settings, load_settings
from tests.conftest import BASE_SETTINGS

REQUIRED_ENV = {
    "DATABASE_URL": BASE_SETTINGS["database_url"],
    "CLERK_ISSUER": BASE_SETTINGS["clerk_issuer"],
    "CLERK_JWKS_URL": BASE_SETTINGS["clerk_jwks_url"],
    "CLERK_AUTHORIZED_PARTY": BASE_SETTINGS["clerk_authorized_party"],
}


@pytest.fixture
def no_env_file(monkeypatch: pytest.MonkeyPatch, tmp_path: pytest.TempPathFactory) -> None:
    monkeypatch.chdir(tmp_path)  # so no stray .env is picked up


@pytest.mark.parametrize("missing", sorted(REQUIRED_ENV))
def test_missing_required_variable_aborts_with_its_name(
    missing: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    no_env_file: None,
) -> None:
    for name, value in REQUIRED_ENV.items():
        if name != missing:
            monkeypatch.setenv(name, value)
    with pytest.raises(ConfigurationError) as excinfo:
        load_settings()
    message = str(excinfo.value)
    assert missing in message
    assert "Traceback" not in message
    assert missing in capsys.readouterr().err


def test_complete_environment_loads(monkeypatch: pytest.MonkeyPatch, no_env_file: None) -> None:
    for name, value in REQUIRED_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173, https://app.example")
    settings = load_settings()
    assert settings.allowed_origins == ["http://localhost:5173", "https://app.example"]
    assert settings.llm_configured is False


def test_wildcard_origin_is_rejected(settings_factory) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError, match="ALLOWED_ORIGINS"):
        settings_factory(allowed_origins="*")


def test_production_requires_platform_secrets(settings_factory) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError, match="JWT_SECRET") as excinfo:
        settings_factory(environment="production")
    for name in ("CLERK_SECRET_KEY", "UPSTASH_REDIS_REST_TOKEN", "IP_HASH_SALT"):
        assert name in str(excinfo.value)


def test_production_rejects_short_jwt_secret(settings_factory) -> None:  # type: ignore[no-untyped-def]
    complete = {
        "environment": "production",
        "direct_database_url": "postgresql://x@db:5432/x",
        "clerk_secret_key": "sk_test_x",
        "supabase_url": "https://x.supabase.co",
        "supabase_service_role_key": "x",
        "upstash_redis_rest_url": "https://x.upstash.io",
        "upstash_redis_rest_token": "x",
        "qstash_current_signing_key": "x",
        "ip_hash_salt": "x",
    }
    with pytest.raises(ValueError, match="at least 32"):
        settings_factory(**complete, jwt_secret="short")
    assert settings_factory(**complete, jwt_secret="x" * 32).is_production


def test_invalid_log_level_falls_back_to_info(settings_factory) -> None:  # type: ignore[no-untyped-def]
    assert settings_factory(log_level="chatty").log_level == "info"


def test_blank_clerk_party_is_rejected(settings_factory) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError, match="clerk_authorized_party"):
        settings_factory(clerk_authorized_party="   ")


def test_settings_type_is_exported() -> None:
    assert Settings.model_fields["clerk_authorized_party"].is_required()
