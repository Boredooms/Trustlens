"""Application settings.

Owner document: docs/08-infrastructure/ENVIRONMENT_CONFIGURATION.md. Every variable read here
must be listed there. Validation is fail-fast: a missing security-relevant variable aborts startup
with one message that names the variable, never a stack trace at first request (§6, §9.2).
"""

from __future__ import annotations

import logging
import sys
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "production"]
LogLevel = Literal["debug", "info", "warning", "error"]

_VALID_LOG_LEVELS: tuple[str, ...] = ("debug", "info", "warning", "error")

log = logging.getLogger("trustlens.config")


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── 2.1 Core ────────────────────────────────────────────────────────────────
    environment: Environment = "development"
    app_version: str = "0.1.0"
    port: int = 8000
    database_url: str
    direct_database_url: str | None = None
    jwt_secret: SecretStr | None = None
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    # ── 2.2 Scanning ────────────────────────────────────────────────────────────
    scan_concurrency: int = Field(default=4, ge=1, le=32)
    scan_budget_seconds: int = Field(default=60, ge=5, le=300)
    probe_timeout_seconds: float = Field(default=5, gt=0, le=30)
    dns_timeout_seconds: float = Field(default=2, gt=0, le=10)
    max_redirect_hops: int = Field(default=10, ge=0, le=20)
    max_page_bytes: int = Field(default=2_097_152, ge=1024)
    deep_scan_enabled: bool = False
    playwright_timeout_seconds: int = 15
    playwright_max_bytes: int = 26_214_400
    scan_user_agent: str = "TrustLensScanner/0.4 (+https://trustlens.example/bot)"
    blocked_ports: Annotated[list[int], NoDecode] = Field(
        default_factory=lambda: [22, 25, 3306, 5432, 6379, 9200, 11211]
    )

    # ── 2.3 Reputation and intelligence ─────────────────────────────────────────
    reputation_block_threshold: int = -60
    reputation_max_per_day: int = -24
    report_min_coverage: int = 50
    campaign_min_score: float = 0.45
    graph_max_depth: int = Field(default=3, ge=1, le=3)
    graph_max_nodes: int = 500
    graph_statement_timeout_ms: int = 3000

    # ── 2.4 AI ──────────────────────────────────────────────────────────────────
    llm_api_key: SecretStr | None = None
    llm_base_url: str | None = None
    llm_model: str = "provider/model-a"
    llm_max_input_tokens: int = 8000
    llm_max_output_tokens: int = 1200
    llm_timeout_seconds: int = 45
    llm_temperature: float = 0.2
    # Provider-specific request fields merged into the chat body, as JSON. Example for NVIDIA
    # NIM reasoning models: {"chat_template_kwargs": {"enable_thinking": false}}
    llm_extra_body: dict[str, Any] = Field(default_factory=dict)
    ai_daily_limit_per_user: int = 20
    ai_monthly_budget_usd: float = 20
    prompt_version: str = "inv-1.0"

    # ── 2.5 Demo and operations ─────────────────────────────────────────────────
    demo_mode: bool = False
    dev_auth_enabled: bool = False  # development-only stand-in for Clerk; refused in production
    allow_demo_seed: bool = False
    demo_org_slug: str = "northstar"
    log_level: str = "info"
    rate_limit_enabled: bool = True
    ip_hash_salt: SecretStr | None = None
    sentry_dsn: str | None = None

    # ── 2.6 Hosted platforms ────────────────────────────────────────────────────
    clerk_secret_key: SecretStr | None = None
    clerk_issuer: str
    clerk_jwks_url: str
    clerk_authorized_party: str
    clerk_webhook_secret: SecretStr | None = None
    supabase_url: str | None = None
    supabase_service_role_key: SecretStr | None = None
    upstash_redis_rest_url: str | None = None
    upstash_redis_rest_token: SecretStr | None = None
    qstash_current_signing_key: SecretStr | None = None
    qstash_next_signing_key: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    email_from: str = "TrustLens <no-reply@trustlens.example>"
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "trustlens-investigations"
    # QStash publishing (only app.scripts.register_schedules uses these; the API verifies signatures
    # with the signing keys above and never needs the token at runtime).
    qstash_token: SecretStr | None = None
    qstash_url: str = "https://qstash.upstash.io"

    # ── 2.7 Web3 report registry (docs/02-architecture/WEB3_REGISTRY.md §7) ──────
    # Unset CHAIN_RPC_URL disables anchoring; scans and reports never depend on the chain.
    chain_rpc_url: str | None = None
    chain_id: int = 31337
    chain_registry_address: str | None = None
    chain_sender_address: str | None = None
    chain_timeout_seconds: float = Field(default=5, gt=0, le=30)

    # ── Parsing ─────────────────────────────────────────────────────────────────
    @field_validator("allowed_origins", "blocked_ports", mode="before")
    @classmethod
    def _csv(cls, value: object) -> object:
        return _split_csv(value)

    @field_validator("log_level", mode="before")
    @classmethod
    def _log_level(cls, value: object) -> str:
        # §6: an invalid LOG_LEVEL falls back to info with a warning; it is not security-relevant.
        text = str(value).strip().lower() if value is not None else "info"
        if text not in _VALID_LOG_LEVELS:
            log.warning("config.invalid_log_level", extra={"value": text, "fallback": "info"})
            return "info"
        return text

    @field_validator("clerk_issuer", "clerk_jwks_url", "clerk_authorized_party", "database_url")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()

    # ── Cross-field safety gates (§6) ───────────────────────────────────────────
    @model_validator(mode="after")
    def _safety_gates(self) -> Settings:
        if "*" in self.allowed_origins:
            raise ValueError(
                "ALLOWED_ORIGINS must not contain '*' — the API allows credentials and needs an "
                "explicit allowlist"
            )
        if self.environment == "production" and self.dev_auth_enabled:
            raise ValueError("DEV_AUTH_ENABLED must not be set in production")
        if self.environment == "production":
            missing = [
                name
                for name, value in (
                    ("DIRECT_DATABASE_URL", self.direct_database_url),
                    ("JWT_SECRET", self.jwt_secret),
                    ("CLERK_SECRET_KEY", self.clerk_secret_key),
                    ("SUPABASE_URL", self.supabase_url),
                    ("SUPABASE_SERVICE_ROLE_KEY", self.supabase_service_role_key),
                    ("UPSTASH_REDIS_REST_URL", self.upstash_redis_rest_url),
                    ("UPSTASH_REDIS_REST_TOKEN", self.upstash_redis_rest_token),
                    ("QSTASH_CURRENT_SIGNING_KEY", self.qstash_current_signing_key),
                    ("IP_HASH_SALT", self.ip_hash_salt),
                )
                if value is None
            ]
            if missing:
                raise ValueError("missing required production variable(s): " + ", ".join(missing))
            if self.jwt_secret is not None and len(self.jwt_secret.get_secret_value()) < 32:
                raise ValueError("JWT_SECRET must be at least 32 characters in production")
            if self.chain_rpc_url and self.chain_id == 31337:
                raise ValueError(
                    "CHAIN_ID=31337 is the local development chain and is refused in production"
                )
        if self.chain_rpc_url and not (self.chain_registry_address and self.chain_sender_address):
            raise ValueError(
                "CHAIN_REGISTRY_ADDRESS and CHAIN_SENDER_ADDRESS are required when CHAIN_RPC_URL "
                "is set"
            )
        return self

    # ── Derived values ──────────────────────────────────────────────────────────
    @property
    def llm_configured(self) -> bool:
        return self.llm_api_key is not None and bool(self.llm_api_key.get_secret_value())

    @property
    def chain_configured(self) -> bool:
        return bool(self.chain_rpc_url and self.chain_registry_address)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


class ConfigurationError(SystemExit):
    """Raised at startup when settings are invalid. Carries a single readable message."""


def _format_validation_error(exc: ValidationError) -> str:
    lines = ["TrustLens configuration error — the API will not start:"]
    for err in exc.errors():
        loc = err.get("loc") or ()
        name = str(loc[0]).upper() if loc else "SETTINGS"
        if err.get("type") == "missing":
            lines.append(f"  - {name}: required variable is not set")
        else:
            message = str(err.get("msg", "invalid value")).removeprefix("Value error, ")
            lines.append(f"  - {name}: {message}" if loc else f"  - {message}")
    lines.append(
        "See docs/08-infrastructure/ENVIRONMENT_CONFIGURATION.md and apps/api/.env.example."
    )
    return "\n".join(lines)


def load_settings() -> Settings:
    """Build settings or abort with a readable message (no traceback)."""
    try:
        return Settings()  # required fields come from the environment
    except ValidationError as exc:
        message = _format_validation_error(exc)
        print(message, file=sys.stderr)
        raise ConfigurationError(message) from None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
