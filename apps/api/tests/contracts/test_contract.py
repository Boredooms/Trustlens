"""Wire contract: five decisions, one error envelope, snake_case everywhere.

Owner: docs/02-architecture/API_CONTRACTS.md (§5, §7, §14) and ADR-007.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import APIRouter, FastAPI
from pydantic import BaseModel

from app.errors import DomainError, TargetNotAllowed
from app.schemas import enums
from app.schemas.common import DecisionObject, ErrorEnvelope, RequestModel

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "contract_enums.json").read_text("utf-8")
)
SNAKE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
REQUEST_ID = re.compile(r"^req_[0-9A-HJKMNP-TV-Z]{26}$")

ENUM_CLASSES = {
    "decision": enums.Decision,
    "risk_level": enums.RiskLevel,
    "scan_status": enums.ScanStatus,
    "intent": enums.Intent,
    "signal_group": enums.SignalGroup,
    "severity": enums.Severity,
    "coverage_state": enums.CoverageState,
    "report_status": enums.ReportStatus,
    "investigation_status": enums.InvestigationStatus,
    "recipient_type": enums.RecipientType,
    "match": enums.Match,
    "verification_status": enums.VerificationStatus,
    "entity_type": enums.EntityType,
}


def test_exactly_five_decisions() -> None:
    assert [d.value for d in enums.Decision] == ["BLOCK", "WARN", "ALLOW", "REVIEW", "UNKNOWN"]


@pytest.mark.parametrize("name", sorted(ENUM_CLASSES))
def test_enum_matches_shared_fixture(name: str) -> None:
    assert [member.value for member in ENUM_CLASSES[name]] == FIXTURE[name]


def test_decision_object_requires_coverage() -> None:
    with pytest.raises(ValueError):
        DecisionObject.model_validate(
            {"decision": "ALLOW", "risk_level": "LOW", "risk_score": 3, "reasons": []}
        )


def test_decision_object_rejects_unknown_decision() -> None:
    with pytest.raises(ValueError):
        DecisionObject.model_validate(
            {
                "decision": "SAFE",
                "risk_level": "LOW",
                "risk_score": 3,
                "coverage": {"percent": 90, "collected": [], "unavailable": [], "skipped": []},
                "reasons": [],
            }
        )


# ── Error envelope ──────────────────────────────────────────────────────────────


def assert_envelope(response: httpx.Response, code: str, status: int) -> dict[str, Any]:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {"error"}
    ErrorEnvelope.model_validate(body)
    error = body["error"]
    assert error["code"] == code
    assert error["message"] and "Traceback" not in error["message"]
    assert error["request_id"] == response.headers["x-request-id"]
    return error


class _Probe(RequestModel):
    url: str
    note: str | None = None


def _probe_app(app: FastAPI) -> FastAPI:
    router = APIRouter()

    @router.post("/__probe/echo")
    async def echo(body: _Probe) -> dict[str, str]:
        return {"url": body.url}

    @router.get("/__probe/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail: password=hunter2")

    @router.get("/__probe/domain")
    async def domain() -> None:
        raise TargetNotAllowed()

    app.include_router(router)
    return app


@pytest.fixture
def probe_app(app: FastAPI) -> FastAPI:
    return _probe_app(app)


async def test_unknown_route_is_not_found_envelope(client: httpx.AsyncClient) -> None:
    assert_envelope(await client.get("/api/v1/does-not-exist"), "NOT_FOUND", 404)


async def test_wrong_method_is_envelope(client: httpx.AsyncClient) -> None:
    assert_envelope(await client.post("/health"), "METHOD_NOT_ALLOWED", 405)


async def test_validation_failure_envelope(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    error = assert_envelope(
        await client.post("/__probe/echo", json={"url": "x", "typo_field": 1}),
        "VALIDATION_FAILED",
        422,
    )
    assert {"field": "typo_field", "issue": "extra_forbidden"} in error["details"]


async def test_missing_field_names_the_field(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    error = assert_envelope(await client.post("/__probe/echo", json={}), "VALIDATION_FAILED", 422)
    assert error["details"][0]["field"] == "url"


async def test_malformed_json_envelope(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/__probe/echo", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert_envelope(response, "MALFORMED_JSON", 400)


async def test_oversized_body_is_413(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    response = await client.post("/__probe/echo", json={"url": "x", "note": "a" * 300_000})
    assert_envelope(response, "PAYLOAD_TOO_LARGE", 413)


async def test_oversized_chunked_body_is_413(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    async def chunks():  # type: ignore[no-untyped-def]
        for _ in range(40):
            yield b"a" * 8192

    response = await client.post(
        "/__probe/echo", content=chunks(), headers={"content-type": "application/json"}
    )
    assert_envelope(response, "PAYLOAD_TOO_LARGE", 413)


async def test_unhandled_exception_never_leaks(
    probe_app: FastAPI, client: httpx.AsyncClient
) -> None:
    response = await client.get("/__probe/boom")
    error = assert_envelope(response, "INTERNAL_ERROR", 500)
    assert "hunter2" not in response.text
    assert "RuntimeError" not in error["message"]


async def test_domain_error_uses_its_code(probe_app: FastAPI, client: httpx.AsyncClient) -> None:
    assert_envelope(await client.get("/__probe/domain"), "TARGET_NOT_ALLOWED", 422)


# ── Request IDs ─────────────────────────────────────────────────────────────────


async def test_request_id_minted_when_absent(client: httpx.AsyncClient) -> None:
    assert REQUEST_ID.match((await client.get("/health")).headers["x-request-id"])


async def test_well_formed_request_id_is_echoed(client: httpx.AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-Id": "client-trace-1234"})
    assert response.headers["x-request-id"] == "client-trace-1234"


async def test_malformed_request_id_is_replaced(client: httpx.AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-Id": "bad id with spaces"})
    assert REQUEST_ID.match(response.headers["x-request-id"])


async def test_security_headers_present(client: httpx.AsyncClient) -> None:
    headers = (await client.get("/health")).headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"


async def test_cors_allows_only_the_allowlist(client: httpx.AsyncClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}
    good = await client.options("/health", headers={"Origin": "http://localhost:5173", **preflight})
    bad = await client.options("/health", headers={"Origin": "https://evil.example", **preflight})
    assert good.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


# ── snake_case (ADR-007) ────────────────────────────────────────────────────────


def _walk_property_names(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            found.update(props)
        for value in node.values():
            _walk_property_names(value, found)
    elif isinstance(node, list):
        for value in node:
            _walk_property_names(value, found)


def test_every_openapi_property_is_snake_case(app: FastAPI) -> None:
    names: set[str] = set()
    _walk_property_names(app.openapi(), names)
    assert names, "expected schemas in the OpenAPI document"
    offenders = sorted(n for n in names if not SNAKE.match(n))
    assert offenders == []


def test_error_codes_are_upper_snake_and_unique() -> None:
    values = [c.value for c in enums.ErrorCode]
    assert len(values) == len(set(values))
    assert all(re.fullmatch(r"[A-Z][A-Z0-9_]+", v) for v in values)


def test_domain_errors_reference_registered_codes() -> None:
    def all_subclasses(cls: type) -> list[type]:
        out = []
        for sub in cls.__subclasses__():
            out.append(sub)
            out.extend(all_subclasses(sub))
        return out

    registered = set(enums.ErrorCode)
    for cls in [DomainError, *all_subclasses(DomainError)]:
        assert cls.code in registered, cls.__name__  # type: ignore[attr-defined]


def test_models_use_snake_case_fields() -> None:
    for model in (DecisionObject, ErrorEnvelope):
        assert issubclass(model, BaseModel)
        for name in model.model_fields:
            assert SNAKE.match(name), (model.__name__, name)
