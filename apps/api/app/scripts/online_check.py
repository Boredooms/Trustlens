"""Check every hosted dependency the API is configured for. Prints status only — never a value.

Usage (apps/api):  python -m app.scripts.online_check

Read-only: a ``SELECT`` on each database URL, a Redis ``PING``, a QStash schedules list, a Clerk
user count, and the LLM model list. Exit 1 when a configured service fails; exit 2 when the API
is configured for a local database (the daily path must use the hosted one).
"""

from __future__ import annotations

import asyncio
import sys
from urllib.parse import urlsplit

import httpx

from app.config import Settings, get_settings


def _host(url: str | None) -> str:
    return urlsplit(url or "").hostname or "—"


async def _db(url: str, label: str, *, pooler: bool) -> tuple[bool, str]:
    import asyncpg

    raw = url.replace("postgresql+asyncpg://", "postgresql://")
    try:
        kwargs = {"statement_cache_size": 0} if pooler else {}
        conn = await asyncio.wait_for(asyncpg.connect(raw, timeout=8, **kwargs), timeout=10)
        try:
            version = await conn.fetchval("select current_setting('server_version')")
            head = (
                await conn.fetchval("select version_num from alembic_version limit 1")
                if await conn.fetchval("select to_regclass('public.alembic_version') is not null")
                else None
            )
        finally:
            await conn.close()
        return True, f"{label} {_host(url)}:{urlsplit(url).port} postgres {version}, alembic {head}"
    except Exception as exc:  # noqa: BLE001 — report, never raise
        return False, f"{label} {_host(url)}:{urlsplit(url).port} FAILED ({type(exc).__name__})"


async def main() -> int:
    s: Settings = get_settings()
    results: list[tuple[bool, str]] = []
    local = {"localhost", "127.0.0.1", "::1", "db"}
    if _host(s.database_url) in local or _host(s.direct_database_url) in local:
        print("CONFIG ERROR: the API points at a local database; the daily path uses Supabase.")
        return 2

    results.append(await _db(s.database_url, "db runtime (transaction pooler)", pooler=True))
    if s.direct_database_url:
        results.append(await _db(s.direct_database_url, "db direct (session pooler)", pooler=False))

    async with httpx.AsyncClient(timeout=10) as http:
        if s.upstash_redis_rest_url and s.upstash_redis_rest_token:
            try:
                r = await http.post(
                    s.upstash_redis_rest_url.rstrip("/"),
                    json=["PING"],
                    headers={
                        "Authorization": f"Bearer {s.upstash_redis_rest_token.get_secret_value()}"
                    },
                )
                ok = r.status_code == 200 and r.json().get("result") == "PONG"
                results.append(
                    (ok, f"upstash redis {_host(s.upstash_redis_rest_url)} PING {r.status_code}")
                )
            except httpx.HTTPError as exc:
                results.append((False, f"upstash redis FAILED ({type(exc).__name__})"))
        else:
            results.append(
                (True, "upstash redis not configured (in-process limits, degraded header)")
            )

        signing = bool(s.qstash_current_signing_key)
        results.append((signing, f"qstash signing keys {'present' if signing else 'MISSING'}"))
        if s.qstash_token:
            try:
                r = await http.get(
                    f"{s.qstash_url.rstrip('/')}/v2/schedules",
                    headers={"Authorization": f"Bearer {s.qstash_token.get_secret_value()}"},
                )
                n = len(r.json()) if r.status_code == 200 else "?"
                results.append(
                    (
                        r.status_code == 200,
                        f"qstash {_host(s.qstash_url)} schedules={n} ({r.status_code})",
                    )
                )
            except (httpx.HTTPError, ValueError) as exc:
                results.append((False, f"qstash FAILED ({type(exc).__name__})"))

        if s.clerk_secret_key:
            try:
                r = await http.get(
                    "https://api.clerk.com/v1/users/count",
                    headers={"Authorization": f"Bearer {s.clerk_secret_key.get_secret_value()}"},
                )
                results.append(
                    (r.status_code == 200, f"clerk backend api users/count {r.status_code}")
                )
            except httpx.HTTPError as exc:
                results.append((False, f"clerk FAILED ({type(exc).__name__})"))
            try:
                r = await http.get(s.clerk_jwks_url)
                keys = len(r.json().get("keys", [])) if r.status_code == 200 else 0
                results.append((keys > 0, f"clerk jwks {_host(s.clerk_jwks_url)} keys={keys}"))
            except (httpx.HTTPError, ValueError) as exc:
                results.append((False, f"clerk jwks FAILED ({type(exc).__name__})"))

        if s.llm_configured and s.llm_api_key is not None:
            try:
                r = await http.get(
                    f"{(s.llm_base_url or '').rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
                )
                ids = (
                    {m.get("id") for m in r.json().get("data", [])}
                    if r.status_code == 200
                    else set()
                )
                listed = "available" if s.llm_model in ids else "NOT LISTED"
                results.append(
                    (
                        s.llm_model in ids,
                        f"llm {_host(s.llm_base_url)} model {listed} ({r.status_code})",
                    )
                )
            except (httpx.HTTPError, ValueError) as exc:
                results.append((False, f"llm FAILED ({type(exc).__name__})"))
        else:
            results.append((True, "llm not configured (template narrator)"))

    for ok, line in results:
        print(("  ok   " if ok else "  FAIL ") + line)
    return 0 if all(ok for ok, _ in results) else 1


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))
