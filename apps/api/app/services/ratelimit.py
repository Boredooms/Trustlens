"""Rate-limit counters (API_CONTRACTS.md §10, BACKEND_OVERVIEW.md §9.2).

Upstash Redis (REST) is the shared store so every worker enforces one limit. Each hit is one REST
pipeline round trip: ``INCR`` + ``EXPIRE … NX`` on a window-aligned key, so the reset time is known
without a third command (Upstash bills per command; the free tier is 10k/day).

The window is fixed and aligned to the epoch (``floor(now / window)``): a documented approximation
of the token bucket in API_CONTRACTS §10 that is never stricter than the documented limit.

Degradation (§9.2): any Redis error or timeout falls back to per-process counters, logs at most once
per 60 s, and marks the result ``degraded`` so the response carries ``X-RateLimit-Degraded: true``.
A Redis failure never fails a request.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.logging import get_logger

log = get_logger("ratelimit")

REDIS_TIMEOUT_S = 1.0
LOG_EVERY_S = 60.0


@dataclass(frozen=True)
class Hit:
    used: int
    limit: int
    reset_at: float  # epoch seconds
    degraded: bool

    @property
    def allowed(self) -> bool:
        return self.used <= self.limit

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


class RateLimiter:
    def __init__(self, rest_url: str | None = None, rest_token: str | None = None) -> None:
        self._url = rest_url.rstrip("/") if rest_url else None
        self._token = rest_token
        self._client: httpx.AsyncClient | None = None
        self._local: dict[str, tuple[float, int]] = {}
        self._last_error_log = 0.0

    @property
    def shared(self) -> bool:
        return bool(self._url and self._token)

    async def hit(self, key: str, limit: int, window_s: int) -> Hit:
        now = time.time()
        bucket = int(now // window_s)
        reset_at = float((bucket + 1) * window_s)
        if self.shared:
            try:
                used = await self._redis_incr(f"{key}:{bucket}", window_s)
                return Hit(used=used, limit=limit, reset_at=reset_at, degraded=False)
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                if now - self._last_error_log >= LOG_EVERY_S:
                    self._last_error_log = now
                    log.warning("ratelimit.redis_degraded", extra={"exc_type": type(exc).__name__})
        return self._local_hit(key, limit, window_s, now)

    def _local_hit(self, key: str, limit: int, window_s: int, now: float) -> Hit:
        reset_at, used = self._local.get(key, (now + window_s, 0))
        if now >= reset_at:
            reset_at, used = now + window_s, 0
        used += 1
        self._local[key] = (reset_at, used)
        if len(self._local) > 50_000:  # bound memory under key churn; drop expired buckets
            self._local = {k: v for k, v in self._local.items() if v[0] > now}
        return Hit(used=used, limit=limit, reset_at=reset_at, degraded=True)

    async def _redis_incr(self, key: str, window_s: int) -> int:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(REDIS_TIMEOUT_S),
                headers={"Authorization": f"Bearer {self._token}"},
            )
        resp = await self._client.post(
            f"{self._url}/pipeline",
            json=[["INCR", key], ["EXPIRE", key, str(window_s + 5), "NX"]],
        )
        resp.raise_for_status()
        results: list[dict[str, Any]] = resp.json()
        first = results[0]
        if "error" in first:
            raise ValueError(str(first["error"]))
        return int(first["result"])

    async def command(self, *args: str) -> Any:
        """One raw Upstash REST command (used by tests and cleanup tooling)."""
        if not self.shared:
            raise RuntimeError("Upstash Redis is not configured")
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(REDIS_TIMEOUT_S * 5),
                headers={"Authorization": f"Bearer {self._token}"},
            )
        resp = await self._client.post(f"{self._url}", json=list(args))
        resp.raise_for_status()
        return resp.json().get("result")

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
