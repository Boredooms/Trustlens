"""Deep scan: render one page in headless Chromium (TECH_STACK.md §4.5, FR-008, TL-010).

Off unless ``DEEP_SCAN_ENABLED`` *and* the scan asked for ``deep``. Playwright is an optional
dependency (``requirements-deepscan.txt`` + ``python -m playwright install chromium``) and is only
imported here, lazily, so startup never pays for it (DEPLOYMENT_ARCHITECTURE.md §6).

Budget: one page, ``PLAYWRIGHT_TIMEOUT_SECONDS`` (15 s) wall clock, ``PLAYWRIGHT_MAX_BYTES`` (25 MB)
of responses, one render at a time per process (the 512 MB instance cannot afford two).

SSRF: every request the page makes — navigation, redirects, subresources, XHR/fetch — is
intercepted and checked by the same guard as the static scanner before Chromium may send it; a
rejected request is aborted. Non-network schemes (``data:``, ``blob:``, ``about:``) never leave the
process and are allowed. Service workers are blocked, downloads are refused, and WebSockets are
never connected (``route_web_socket`` answers them locally; older Playwright: ``WebSocket`` is
removed from the page by an init script). Known residual risk, documented in
SECURITY_THREAT_MODEL.md: Chromium re-resolves DNS after the guard's check (a rebinding window of
milliseconds between our check and its connect).

Rendering never executes on demo hosts (they are recorded fixtures and are never contacted).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import urlsplit

from app.config import Settings
from app.errors import DomainError
from app.logging import get_logger
from app.services import guard
from app.services.observations import PageObs

log = get_logger("deep_scan")

SETTLE_MS = 1000  # let client-side scripts inject forms after DOMContentLoaded
LOCAL_SCHEMES = {"data", "blob", "about"}
_gate: asyncio.Semaphore | None = None
_gate_loop: asyncio.AbstractEventLoop | None = None


_NO_WEBSOCKET = "Object.defineProperty(window, 'WebSocket', {value: undefined});"


async def _refuse_socket(ws: Any) -> None:
    await ws.close()


def available() -> bool:
    try:
        import playwright.async_api  # noqa: F401
    except ImportError:
        return False
    return True


def _semaphore() -> asyncio.Semaphore:
    """One render per process, bound to the running loop (tests create a loop per test)."""
    global _gate, _gate_loop
    loop = asyncio.get_running_loop()
    if _gate is None or _gate_loop is not loop:
        _gate, _gate_loop = asyncio.Semaphore(1), loop
    return _gate


async def allow_request(url: str, settings: Settings) -> str | None:
    """``None`` if the renderer may send this request, else the policy reason."""
    scheme = urlsplit(url).scheme.lower()
    if scheme in LOCAL_SCHEMES:
        return None
    try:
        await guard.check_target(url, dns_timeout=settings.dns_timeout_seconds)
    except DomainError as exc:
        for detail in exc.details or []:
            if detail.get("issue"):
                return str(detail["issue"])
        return str(exc.code).lower()
    return None


async def render_page(url: str, settings: Settings) -> PageObs | None:
    """Rendered-DOM page observation, or ``None`` if rendering is unavailable or failed (the
    caller keeps the static observation; a failed render is never a verdict input)."""
    if not available():
        log.warning("deep_scan.playwright_missing")
        return None
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright

    from app.services.collectors import analyse_html

    blocked: list[dict[str, str]] = []
    received = {"bytes": 0}

    async with _semaphore():
        try:
            async with asyncio.timeout(settings.playwright_timeout_seconds):
                async with async_playwright() as pw:
                    browser = await pw.chromium.launch(headless=True)
                    try:
                        context = await browser.new_context(
                            user_agent=settings.scan_user_agent,
                            java_script_enabled=True,
                            accept_downloads=False,
                            service_workers="block",
                            ignore_https_errors=False,
                        )

                        async def route(route: Any) -> None:
                            request_url = route.request.url
                            if received["bytes"] > settings.playwright_max_bytes:
                                blocked.append({"url": request_url, "reason": "byte_budget"})
                                await route.abort("blockedbyclient")
                                return
                            reason = await allow_request(request_url, settings)
                            if reason is not None:
                                blocked.append({"url": request_url, "reason": reason})
                                await route.abort("blockedbyclient")
                                return
                            await route.continue_()

                        await context.route("**/*", route)
                        if hasattr(context, "route_web_socket"):
                            # Not calling connect_to_server() keeps every socket local (mocked).
                            await context.route_web_socket(re.compile(".*"), _refuse_socket)
                        else:
                            await context.add_init_script(_NO_WEBSOCKET)

                        def on_response(response: Any) -> None:
                            length = response.headers.get("content-length")
                            if length and length.isdigit():
                                received["bytes"] += int(length)

                        page = await context.new_page()
                        page.on("response", on_response)
                        await page.goto(
                            url,
                            wait_until="domcontentloaded",
                            timeout=settings.playwright_timeout_seconds * 1000,
                        )
                        await page.wait_for_timeout(SETTLE_MS)
                        html = await page.content()
                        final_url = page.url
                    finally:
                        await browser.close()
        except (TimeoutError, PlaywrightError) as exc:
            log.info("deep_scan.render_failed", extra={"exc_type": type(exc).__name__})
            return None

    obs = analyse_html(html[: settings.max_page_bytes], final_url)
    obs.dom_source = "playwright"
    if blocked:
        log.info("deep_scan.requests_blocked", extra={"count": len(blocked)})
    return obs


def merge(static: PageObs, rendered: PageObs | None) -> PageObs:
    """Prefer the rendered DOM (it sees script-injected forms and payees) but never lose a form or
    payee the static fetch saw; keep the static fetch's blocking signal."""
    if rendered is None or rendered.status != "collected":
        return static
    actions = {f.action for f in rendered.forms}
    forms = [*rendered.forms, *(f for f in static.forms if f.action not in actions)]
    payee_values = {p.get("value") for p in rendered.payees}
    payees = [*rendered.payees, *(p for p in static.payees if p.get("value") not in payee_values)]
    rendered.forms = forms
    rendered.payees = payees
    rendered.password_fields = max(rendered.password_fields, static.password_fields)
    rendered.fetch_blocked = static.fetch_blocked
    rendered.logo_phash = rendered.logo_phash or static.logo_phash
    return rendered
