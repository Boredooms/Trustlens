"""Redirect-chain inspection (API_ENDPOINTS.md §6 ``POST /inspect-redirect``, TL-005).

Every hop is validated and DNS-resolved by the SSRF guard *before* it is requested. A blocked hop
is a finding, not an error: the chain stops and ``blocked_hop`` names the hop and the policy
reason. Only the status line and ``Location`` are read; response bodies are never downloaded.
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.config import Settings
from app.errors import DomainError
from app.services import guard
from app.services.demo_fixtures import is_demo_host


def _reason(exc: DomainError) -> str:
    """The guard's specific policy reason (e.g. ``private_range``), else the error code."""
    for detail in exc.details or []:
        issue = detail.get("issue")
        if issue:
            return str(issue)
    return str(exc.code).lower()


async def inspect_chain(
    client: httpx.AsyncClient, url: str, max_hops: int, settings: Settings
) -> dict[str, Any]:
    start = guard.parse_target(url)  # syntax errors are client errors (422), raised here
    hops: list[dict[str, Any]] = []
    seen: set[str] = set()
    current = start.normalised_url
    loop_detected = False
    blocked: dict[str, str] | None = None
    simulated = False

    while True:
        if current in seen:
            loop_detected = True
            break
        if len(hops) >= max_hops:
            # Still redirecting after the allowed number of hops: stop without requesting it.
            blocked = {"url": current, "reason": "too_many_hops"}
            break
        seen.add(current)
        try:
            target = guard.parse_target(current)
            demo = settings.demo_mode and is_demo_host(target.host, target.registrable_domain)
            if demo:
                # Recorded demo hosts are never contacted (guard.py docstring): no redirects.
                simulated = True
                break
            await guard.check_target(current, dns_timeout=settings.dns_timeout_seconds)
        except DomainError as exc:
            blocked = {"url": current, "reason": _reason(exc)}
            break
        loop = asyncio.get_running_loop()
        started = loop.time()
        try:
            async with client.stream(
                "GET", current, timeout=settings.probe_timeout_seconds
            ) as resp:
                guard.check_peer(resp, urlsplit(current).hostname or "")
                status, location = resp.status_code, resp.headers.get("location")
        except DomainError as exc:  # connected peer was a disallowed (rebound) address
            blocked = {"url": current, "reason": _reason(exc)}
            break
        except (httpx.HTTPError, TimeoutError):
            blocked = {"url": current, "reason": "unreachable"}
            break
        elapsed = round((loop.time() - started) * 1000)
        if resp.is_redirect and location:
            nxt = urljoin(current, location)
            hops.append({"url": current, "status": status, "location": nxt, "elapsed_ms": elapsed})
            current = nxt
            continue
        hops.append({"url": current, "status": status, "location": None, "elapsed_ms": elapsed})
        break

    final_url = current
    try:
        final_domain = guard.parse_target(final_url).registrable_domain
    except DomainError:
        final_domain = ""
    return {
        "final_url": final_url,
        "cross_domain": final_domain != start.registrable_domain,
        "loop_detected": loop_detected,
        "hops": hops,
        "blocked_hop": blocked,
        "simulated": simulated,
    }
