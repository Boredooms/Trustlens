"""Svix signature verification and the DNS-rebinding peer check (no database)."""

from __future__ import annotations

import time
from typing import Any

import httpx
import pytest

from app.errors import TargetNotAllowed
from app.security import svix
from app.services import guard

SECRET = "whsec_dGVzdC1zZWNyZXQtZm9yLXN2aXgtd2ViaG9va3M="


# ── Svix ────────────────────────────────────────────────────────────────────────
def test_svix_accepts_valid_and_rotated_signatures() -> None:
    now = int(time.time())
    body = b'{"type":"user.created"}'
    good = svix.sign(SECRET, "msg_1", now, body)
    svix.verify(SECRET, msg_id="msg_1", timestamp=str(now), signature=good, body=body)
    other = svix.sign("whsec_b3RoZXI=", "msg_1", now, body)
    svix.verify(SECRET, msg_id="msg_1", timestamp=str(now), signature=f"{other} {good}", body=body)


@pytest.mark.parametrize(
    ("msg_id", "ts_offset", "body", "sig_body"),
    [
        ("msg_1", 0, b"tampered", b"original"),  # body changed
        ("msg_2", 0, b"x", b"x"),  # id changed (signed as msg_1 below)
        ("msg_1", -301, b"x", b"x"),  # replay outside tolerance
        ("msg_1", 301, b"x", b"x"),  # from the future
    ],
)
def test_svix_rejects(msg_id: str, ts_offset: int, body: bytes, sig_body: bytes) -> None:
    now = int(time.time())
    stamp = now + ts_offset
    sig = svix.sign(SECRET, "msg_1", stamp, sig_body)
    with pytest.raises(svix.InvalidSignature):
        svix.verify(SECRET, msg_id=msg_id, timestamp=str(stamp), signature=sig, body=body, now=now)


def test_svix_rejects_missing_headers_and_v2() -> None:
    now = int(time.time())
    with pytest.raises(svix.InvalidSignature):
        svix.verify(SECRET, msg_id=None, timestamp=str(now), signature="v1,x", body=b"")
    sig = svix.sign(SECRET, "m", now, b"").replace("v1,", "v2,")
    with pytest.raises(svix.InvalidSignature):
        svix.verify(SECRET, msg_id="m", timestamp=str(now), signature=sig, body=b"")


# ── DNS rebinding: validate the connected peer ──────────────────────────────────
class _Stream:
    def __init__(self, addr: Any) -> None:
        self.addr = addr

    def get_extra_info(self, key: str) -> Any:
        return self.addr if key == "server_addr" else None


def _resp(addr: Any) -> httpx.Response:
    return httpx.Response(200, extensions={"network_stream": _Stream(addr)})


@pytest.mark.parametrize(
    "addr", [("127.0.0.1", 443), ("10.0.0.5", 443), ("169.254.169.254", 80), ("::1", 443, 0, 0)]
)
def test_peer_check_rejects_rebound_private_addresses(addr: tuple[Any, ...]) -> None:
    with pytest.raises(TargetNotAllowed):
        guard.check_peer(_resp(addr), "rebind.example")


def test_peer_check_allows_public_and_unknown_peers() -> None:
    guard.check_peer(_resp(("93.184.215.14", 443)), "example.com")
    guard.check_peer(httpx.Response(200), "example.com")  # mock transports expose no stream
    assert guard.peer_address(_resp(None)) is None


async def test_guarded_get_blocks_rebound_peer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import collectors

    async def ok(url: str, **_: Any) -> Any:
        return guard.parse_target(url)

    monkeypatch.setattr(guard, "check_target", ok)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text="<html>secret internal page</html>",
            extensions={"network_stream": _Stream(("10.1.2.3", 443))},
        )

    from tests.conftest import make_settings

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        resp, body, redirects = await collectors.guarded_get(
            client, "https://rebind.example/", make_settings(), max_bytes=1024
        )
    assert resp is None and body == b""
    assert redirects.blocked_hop is not None
    assert redirects.blocked_hop["reason"] == "target_not_allowed"


async def test_redirect_inspector_blocks_rebound_peer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import redirects

    async def ok(url: str, **_: Any) -> Any:
        return guard.parse_target(url)

    monkeypatch.setattr(guard, "check_target", ok)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, extensions={"network_stream": _Stream(("192.168.1.1", 443))})

    from tests.conftest import make_settings

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await redirects.inspect_chain(
            client, "https://rebind.example/", 10, make_settings()
        )
    assert result["blocked_hop"] is not None
    assert result["blocked_hop"]["reason"] == "private_range"
    assert result["hops"] == []
