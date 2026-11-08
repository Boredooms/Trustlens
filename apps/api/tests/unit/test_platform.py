"""Platform features without a database: QStash signatures, rate limiter, redirect inspection,
deep-scan gating and the HTTP surface of the new routes."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from jose import jwt

from app.config import Settings
from app.errors import TargetNotAllowed
from app.security import qstash
from app.services import guard, redirects
from app.services.ratelimit import RateLimiter

from ..conftest import make_settings

CURRENT, NEXT = "sig_current_key_for_tests", "sig_next_key_for_tests"
JOB_URL = "http://testserver/internal/jobs/keepalive"


def sign(
    key: str = CURRENT,
    *,
    url: str = JOB_URL,
    body: bytes = b"{}",
    iss: str = "Upstash",
    exp_delta: int = 300,
    nbf: bool = True,
    **extra: Any,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": iss,
        "sub": url,
        "exp": now + exp_delta,
        "iat": now,
        "body": qstash.body_hash(body),
        "jti": "test",
        **extra,
    }
    if nbf:
        claims["nbf"] = now
    return str(jwt.encode(claims, key, algorithm="HS256"))


def qsettings(**overrides: Any) -> Settings:
    return make_settings(
        qstash_current_signing_key=CURRENT, qstash_next_signing_key=NEXT, **overrides
    )


# ── QStash signatures ───────────────────────────────────────────────────────────
def test_qstash_accepts_current_and_next_key() -> None:
    s = qsettings()
    assert qstash.verify(sign(CURRENT), b"{}", JOB_URL, s)["iss"] == "Upstash"
    assert qstash.verify(sign(NEXT), b"{}", JOB_URL, s)["sub"] == JOB_URL


def test_qstash_ignores_scheme_behind_tls_proxy() -> None:
    token = sign(url="https://testserver/internal/jobs/keepalive")
    assert qstash.verify(token, b"{}", JOB_URL, qsettings())


@pytest.mark.parametrize(
    ("token_factory", "body", "url"),
    [
        (lambda: sign("some-other-key"), b"{}", JOB_URL),
        (lambda: sign(iss="NotUpstash"), b"{}", JOB_URL),
        (lambda: sign(exp_delta=-120), b"{}", JOB_URL),
        (lambda: sign(nbf=False), b"{}", JOB_URL),
        (lambda: sign(), b'{"tampered":1}', JOB_URL),
        (lambda: sign(), b"{}", "http://testserver/internal/jobs/retention"),
        (lambda: sign(url="http://evil.example/internal/jobs/keepalive"), b"{}", JOB_URL),
        (lambda: "not-a-jwt", b"{}", JOB_URL),
        (lambda: jwt.encode({"iss": "Upstash"}, CURRENT, algorithm="HS512"), b"{}", JOB_URL),
    ],
)
def test_qstash_rejects_bad_signatures(
    token_factory: Callable[[], str], body: bytes, url: str
) -> None:
    with pytest.raises(qstash.InvalidSignature):
        qstash.verify(token_factory(), body, url, qsettings())


def test_qstash_without_keys_rejects_everything() -> None:
    with pytest.raises(qstash.InvalidSignature):
        qstash.verify(sign(), b"{}", JOB_URL, make_settings())
    with pytest.raises(qstash.InvalidSignature):
        qstash.verify(None, b"{}", JOB_URL, qsettings())


# ── Rate limiter ────────────────────────────────────────────────────────────────
async def test_local_limiter_counts_and_is_marked_degraded() -> None:
    limiter = RateLimiter()
    hits = [await limiter.hit("rl:t:a", 3, 60) for _ in range(4)]
    assert [h.used for h in hits] == [1, 2, 3, 4]
    assert [h.allowed for h in hits] == [True, True, True, False]
    assert all(h.degraded for h in hits) and hits[-1].remaining == 0


def _redis(handler: Callable[[httpx.Request], httpx.Response]) -> RateLimiter:
    limiter = RateLimiter("https://redis.test", "token")
    limiter._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return limiter


async def test_redis_limiter_uses_one_pipeline_round_trip() -> None:
    seen: list[Any] = []
    counter = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen.append((request.url.path, json.loads(request.content)))
        counter["n"] += 1
        return httpx.Response(200, json=[{"result": counter["n"]}, {"result": 1}])

    limiter = _redis(handler)
    first = await limiter.hit("rl:t:b", 2, 3600)
    second = await limiter.hit("rl:t:b", 2, 3600)
    third = await limiter.hit("rl:t:b", 2, 3600)
    assert (first.used, second.used, third.used) == (1, 2, 3)
    assert not first.degraded and third.allowed is False
    path, commands = seen[0]
    assert path == "/pipeline" and commands[0][0] == "INCR" and commands[1][0] == "EXPIRE"
    assert commands[1][-1] == "NX" and commands[0][1].startswith("rl:t:b:")
    assert first.reset_at > time.time()
    await limiter.aclose()


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, json={"error": "boom"}),
        httpx.Response(200, json=[{"error": "WRONGTYPE"}]),
        httpx.Response(200, text="not json"),
    ],
)
async def test_redis_failure_degrades_and_never_raises(response: httpx.Response) -> None:
    limiter = _redis(lambda request: response)
    hit = await limiter.hit("rl:t:c", 5, 60)
    assert hit.degraded and hit.allowed and hit.used == 1


async def test_redis_timeout_degrades() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    hit = await _redis(handler).hit("rl:t:d", 5, 60)
    assert hit.degraded and hit.allowed


# ── Redirect inspection ─────────────────────────────────────────────────────────
@pytest.fixture
def no_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolve every public test host to a public documentation address; keep the real guard
    policy for IP literals and internal names."""
    real = guard.check_target

    async def fake(url: str, *, dns_timeout: float = 2.0, is_demo_host: bool = False) -> Any:
        target = guard.parse_target(url)
        if target.host.endswith(".test"):
            return guard.Target(**{**target.__dict__, "addresses": ("93.184.216.34",)})
        return await real(url, dns_timeout=dns_timeout, is_demo_host=is_demo_host)

    monkeypatch.setattr(guard, "check_target", fake)


def _client(routes: dict[str, tuple[int, str | None]]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        status, location = routes.get(str(request.url), (200, None))
        headers = {"location": location} if location else {}
        return httpx.Response(status, headers=headers)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


async def test_redirect_chain_cross_domain(no_dns: None) -> None:
    client = _client(
        {
            "https://short.test/a": (302, "https://hop.test/b"),
            "https://hop.test/b": (301, "/c"),
        }
    )
    out = await redirects.inspect_chain(client, "https://short.test/a", 10, make_settings())
    assert out["final_url"] == "https://hop.test/c"
    assert out["cross_domain"] is True and out["loop_detected"] is False
    assert [h["status"] for h in out["hops"]] == [302, 301, 200]
    assert out["hops"][1]["location"] == "https://hop.test/c" and out["blocked_hop"] is None


async def test_redirect_loop_detected(no_dns: None) -> None:
    client = _client(
        {"https://a.test/": (302, "https://b.test/"), "https://b.test/": (302, "https://a.test/")}
    )
    out = await redirects.inspect_chain(client, "https://a.test/", 10, make_settings())
    assert out["loop_detected"] is True and len(out["hops"]) == 2


async def test_redirect_into_private_range_is_a_finding_not_an_error(no_dns: None) -> None:
    client = _client({"https://a.test/": (302, "http://127.0.0.1/admin")})
    out = await redirects.inspect_chain(client, "https://a.test/", 10, make_settings())
    assert out["blocked_hop"] == {"url": "http://127.0.0.1/admin", "reason": "loopback"}
    assert out["final_url"] == "http://127.0.0.1/admin" and len(out["hops"]) == 1


async def test_redirect_hop_cap(no_dns: None) -> None:
    client = _client({f"https://a.test/{i}": (302, f"https://a.test/{i + 1}") for i in range(20)})
    out = await redirects.inspect_chain(client, "https://a.test/0", 3, make_settings())
    assert len(out["hops"]) == 3
    assert out["blocked_hop"] == {"url": "https://a.test/3", "reason": "too_many_hops"}


async def test_redirect_first_url_rejected_by_policy() -> None:
    client = _client({})
    out = await redirects.inspect_chain(client, "http://169.254.169.254/", 5, make_settings())
    assert out["hops"] == [] and out["blocked_hop"]["url"] == "http://169.254.169.254/"


async def test_redirect_demo_host_never_contacted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("demo hosts must not be contacted")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    out = await redirects.inspect_chain(
        client,
        "https://apply.northstar-admissions.example/pay",
        5,
        make_settings(demo_mode=True),
    )
    assert out["simulated"] is True and out["hops"] == [] and out["blocked_hop"] is None


def test_reason_prefers_guard_issue() -> None:
    exc = TargetNotAllowed(details=[{"field": "url", "issue": "private_range"}])
    assert redirects._reason(exc) == "private_range"


# ── HTTP surface (database unreachable) ─────────────────────────────────────────
async def test_inspect_redirect_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/v1/inspect-redirect", json={"url": "https://example.com"})
    assert r.status_code == 401


async def test_appeal_body_is_validated(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/api/v1/appeals",
        json={"domain": "example.com", "email": "not-an-email", "message": "short"},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_FAILED"
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"email", "message"} <= fields


async def test_appeal_queue_requires_analyst(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/v1/appeals")).status_code == 401


@pytest.fixture
def jobs_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    from app.main import create_app

    return create_app(qsettings())


async def _jobs_client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


async def test_internal_jobs_need_signature_or_operator(jobs_app: FastAPI) -> None:
    async with await _jobs_client(jobs_app) as c:
        assert (await c.post("/internal/jobs/keepalive")).status_code == 401
        bad = await c.post(
            "/internal/jobs/keepalive",
            content=b"{}",
            headers={"Upstash-Signature": sign("wrong-key")},
        )
        assert bad.status_code == 401
        unknown = await c.post(
            "/internal/jobs/nope",
            content=b"{}",
            headers={"Upstash-Signature": sign(url="http://testserver/internal/jobs/nope")},
        )
        assert unknown.status_code == 404


async def test_internal_job_with_db_down_is_503_for_retry(jobs_app: FastAPI) -> None:
    async with await _jobs_client(jobs_app) as c:
        r = await c.post(
            "/internal/jobs/keepalive", content=b"{}", headers={"Upstash-Signature": sign()}
        )
    assert r.status_code == 503 and r.json()["error"]["code"] == "NOT_READY"


def test_internal_jobs_are_not_in_public_openapi(app: FastAPI) -> None:
    paths = app.openapi()["paths"]
    assert not any(p.startswith("/internal") for p in paths)
    for path in (
        "/api/v1/inspect-redirect",
        "/api/v1/appeals",
        "/api/v1/appeals/{appeal_id}/verify",
        "/api/v1/appeals/{appeal_id}/review",
        "/api/v1/usage",
        "/api/v1/certificates/{certificate_id}",
        "/api/v1/certificates/monitors/{monitor_id}",
    ):
        assert path in paths, path


def test_register_schedules_dry_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from app.scripts import register_schedules

    monkeypatch.setattr(register_schedules, "get_settings", lambda: make_settings(qstash_token="t"))
    assert register_schedules.main(["--api-base", "https://api.test", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert out.count("would upsert") == len(register_schedules.SCHEDULES)
    assert "https://api.test/internal/jobs/cert-sweep" in out
    with pytest.raises(SystemExit):
        register_schedules.main(["--api-base", "http://insecure.test"])


# ── Deep scan (no browser needed) ───────────────────────────────────────────────
async def test_deep_scan_request_policy() -> None:
    from app.services import deep_scan

    s = make_settings()
    assert await deep_scan.allow_request("data:text/plain,hi", s) is None
    assert await deep_scan.allow_request("http://127.0.0.1/x", s) == "loopback"
    assert await deep_scan.allow_request("http://169.254.169.254/latest", s) == "metadata_address"
    assert await deep_scan.allow_request("ftp://example.com/", s) == "unsupported_scheme"


def test_deep_scan_merge_keeps_static_findings() -> None:
    from app.services import deep_scan
    from app.services.observations import FormObs, PageObs

    static = PageObs(
        status="collected",
        forms=[FormObs("https://a.test/login", "post", True)],
        payees=[{"type": "upi_vpa", "value": "x@okaxis"}],
        password_fields=1,
        fetch_blocked=False,
    )
    rendered = PageObs(
        status="collected",
        forms=[FormObs("https://evil.test/collect", "post", True)],
        payees=[{"type": "upi_vpa", "value": "y@okaxis"}],
        dom_source="playwright",
    )
    merged = deep_scan.merge(static, rendered)
    assert {f.action for f in merged.forms} == {"https://a.test/login", "https://evil.test/collect"}
    assert {p["value"] for p in merged.payees} == {"x@okaxis", "y@okaxis"}
    assert merged.password_fields == 1 and merged.dom_source == "playwright"
    assert deep_scan.merge(static, None) is static


async def test_deep_flag_off_keeps_static_path(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/v1/scans", json={"url": "https://example.com", "deep": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "DEEP_SCAN_DISABLED"
