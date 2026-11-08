"""External threat intelligence (THREAT_INTELLIGENCE_SOURCES.md). Primary source: URLhaus.

Modes (``INTEL_MODE``): ``live`` (needs ``URLHAUS_AUTH_KEY``), ``fixture`` (recorded, labelled
simulated listings for demo hosts), ``off``; ``auto`` = live with a key, else fixture in DEMO_MODE,
else off. Every result carries attribution and the mode. A timeout, 429 or error is
``unavailable`` — never "not listed". Results are cached in Postgres (``intel_observations``), not
in process memory, because the API runs several workers.
"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.errors import DomainError
from app.logging import get_logger
from app.models.tables import IntelObservation
from app.services import guard
from app.services.observations import IntelObs
from app.utils import iso_z, new_ulid, utcnow

log = get_logger("intel")

URLHAUS_HOST_API = "https://urlhaus-api.abuse.ch/v1/host/"
SOURCE = "urlhaus"
SOURCE_NAME = "URLhaus (abuse.ch)"
TTL = timedelta(hours=6)
MAX_BYTES = 1_000_000
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "urlhaus.json"


def resolve_mode(settings: Settings) -> str:
    mode = settings.intel_mode
    if mode == "auto":
        if settings.urlhaus_auth_key is not None:
            return "live"
        return "fixture" if settings.demo_mode else "off"
    if mode == "live" and settings.urlhaus_auth_key is None:
        return "off"  # documented: no key ⇒ the source is absent, never silently faked
    return mode


@lru_cache(maxsize=1)
def _fixture_hosts() -> dict[str, dict[str, Any]]:
    data: dict[str, Any] = json.loads(FIXTURES.read_text("utf-8"))
    return dict(data["hosts"])


def _indicator_hash(host: str) -> str:
    return hashlib.sha256(f"host:{host}".encode()).hexdigest()


def _result(host: str, mode: str, status: str, **kw: Any) -> dict[str, Any]:
    return {
        "source": SOURCE,
        "source_name": SOURCE_NAME,
        "mode": mode,
        "indicator": host,
        "indicator_type": "host",
        "status": status,  # listed | not_listed | unavailable
        "queried_at": iso_z(utcnow()),
        **kw,
    }


def fixture_lookup(host: str) -> dict[str, Any]:
    hit = _fixture_hosts().get(host)
    if hit is None:
        return _result(host, "fixture", "not_listed", simulated=True)
    return _result(
        host,
        "fixture",
        "listed",
        listing_id=hit["listing_id"],
        threat=hit["threat"],
        url_status=hit["url_status"],
        tags=hit.get("tags", []),
        reference=None,
        simulated=True,
    )


def parse_urlhaus_host(host: str, doc: dict[str, Any]) -> dict[str, Any]:
    status = doc.get("query_status")
    if status == "no_results":
        return _result(host, "live", "not_listed")
    if status != "ok":
        return _result(host, "live", "unavailable", reason=str(status)[:40])
    urls = doc.get("urls") or []
    online = any(u.get("url_status") == "online" for u in urls)
    first = urls[0] if urls else {}
    return _result(
        host,
        "live",
        "listed",
        listing_id=str(first.get("id") or doc.get("urlhaus_reference") or "")[:80],
        threat=first.get("threat"),
        url_status="online" if online else "offline",
        url_count=doc.get("url_count"),
        reference=doc.get("urlhaus_reference"),
    )


async def live_lookup(host: str, settings: Settings, http: httpx.AsyncClient) -> dict[str, Any]:
    if settings.urlhaus_auth_key is None:  # pragma: no cover - resolve_mode prevents this
        return _result(host, "live", "unavailable", reason="no_key")
    try:
        await guard.check_target(URLHAUS_HOST_API, dns_timeout=settings.dns_timeout_seconds)
        resp = await http.post(
            URLHAUS_HOST_API,
            data={"host": host},
            headers={"Auth-Key": settings.urlhaus_auth_key.get_secret_value()},
            timeout=min(5.0, settings.probe_timeout_seconds),
            follow_redirects=False,
        )
    except (httpx.HTTPError, DomainError, TimeoutError) as exc:
        return _result(host, "live", "unavailable", reason=type(exc).__name__)
    if resp.status_code == 429:
        return _result(
            host,
            "live",
            "unavailable",
            reason="rate_limited",
            retry_after=resp.headers.get("retry-after"),
        )
    if resp.status_code != 200 or len(resp.content) > MAX_BYTES:
        return _result(host, "live", "unavailable", reason=f"http_{resp.status_code}")
    try:
        return parse_urlhaus_host(host, resp.json())
    except ValueError:
        return _result(host, "live", "unavailable", reason="bad_json")


async def lookup(
    factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    http: httpx.AsyncClient,
    hosts: list[str],
) -> IntelObs:
    mode = resolve_mode(settings)
    if mode == "off":
        return IntelObs(status="skipped")
    sources: list[dict[str, Any]] = []
    for host in dict.fromkeys(h.lower() for h in hosts if h):
        if mode == "fixture":
            sources.append(fixture_lookup(host))
            continue
        key = _indicator_hash(host)
        async with factory() as db:
            cached = (
                await db.execute(
                    select(IntelObservation)
                    .where(
                        IntelObservation.source == SOURCE,
                        IntelObservation.indicator_hash == key,
                        IntelObservation.expires_at > utcnow(),
                    )
                    .order_by(IntelObservation.queried_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if cached is not None:
                sources.append({**cached.result, "cached": True})
                continue
            result = await live_lookup(host, settings, http)
            if result["status"] != "unavailable":  # never cache a failure as an answer
                db.add(
                    IntelObservation(
                        id=new_ulid(),
                        source=SOURCE,
                        indicator_type="host",
                        indicator_hash=key,
                        status=result["status"],
                        listing_id=result.get("listing_id"),
                        result=result,
                        queried_at=utcnow(),
                        expires_at=utcnow() + TTL,
                    )
                )
                await db.commit()
            sources.append(result)
    status: Literal["collected", "unavailable"] = (
        "collected" if all(s["status"] != "unavailable" for s in sources) else "unavailable"
    )
    log.info("intel.lookup", extra={"mode": mode, "hosts": len(sources), "status": status})
    return IntelObs(status=status, sources=sources)
