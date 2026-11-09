"""Notes (API_ENDPOINTS.md §18) against real Postgres. Needs TEST_DATABASE_URL; else skipped."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from app.main import create_app
from app.utils import new_ulid

from ..conftest import make_settings

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")]


def who(tag: str) -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{tag}-{uuid.uuid4().hex[:8]}@notes.test:user"}


@pytest.fixture
async def app(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FastAPI]:
    from langgraph.checkpoint.memory import InMemorySaver

    from app.services import investigations

    async def in_memory(settings: object, stack: object) -> InMemorySaver:
        return InMemorySaver()

    monkeypatch.setattr(investigations, "open_checkpointer", in_memory)
    application = create_app(
        make_settings(
            database_url=TEST_DB, dev_auth_enabled=True, ip_hash_salt="s" * 32, demo_mode=True
        )
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


BLOCKS = [
    {"id": "b1", "type": "heading", "text": "Lookalike admissions portal", "level": 2},
    {"id": "b2", "type": "paragraph", "text": "Payee differs from the registered one."},
    {"id": "b3", "type": "todo", "text": "Report to Northstar security", "checked": False},
    {"id": "b4", "type": "divider"},
]


async def test_note_roundtrip_is_private_and_upserts(client: httpx.AsyncClient) -> None:
    owner, other = who("owner"), who("other")
    subject = new_ulid()
    url = f"/api/v1/notes/campaign/{subject}"

    r = await client.get(url, headers=owner)
    assert r.status_code == 200 and r.json()["blocks"] == []  # blank, not 404

    r = await client.put(url, headers=owner, json={"blocks": BLOCKS})
    assert r.status_code == 200, r.text
    first = r.json()
    assert [b["type"] for b in first["blocks"]] == ["heading", "paragraph", "todo", "divider"]

    r = await client.put(
        url, headers=owner, json={"blocks": [*BLOCKS[:2], {**BLOCKS[2], "checked": True}]}
    )
    assert r.status_code == 200 and r.json()["id"] == first["id"]  # same row, updated
    assert r.json()["blocks"][2]["checked"] is True

    r = await client.get(url, headers=other)
    assert r.json()["blocks"] == []  # another person never sees it

    listed = (await client.get("/api/v1/notes", headers=owner)).json()["data"]
    assert [n["subject_id"] for n in listed] == [subject]

    assert (await client.delete(url, headers=owner)).status_code == 204
    assert (await client.get(url, headers=owner)).json()["blocks"] == []


async def test_note_validation_rejects_markup_and_unknown_blocks(client: httpx.AsyncClient) -> None:
    h = who("val")
    url = f"/api/v1/notes/report/{new_ulid()}"
    for bad in (
        {"blocks": [{"id": "x", "type": "html", "text": "<script>alert(1)</script>"}]},
        {"blocks": [{"id": "x", "type": "paragraph", "text": "a", "onclick": "x"}]},
        {"blocks": [{"id": "x", "type": "paragraph", "checked": True}]},
        {"blocks": [{"id": "dup", "type": "paragraph"}, {"id": "dup", "type": "quote"}]},
        {"blocks": [{"id": "x", "type": "paragraph", "text": "z" * 4001}]},
    ):
        r = await client.put(url, headers=h, json=bad)
        assert r.status_code == 422, (bad, r.text)
    r = await client.put("/api/v1/notes/report/not-a-ulid", headers=h, json={"blocks": []})
    assert r.status_code == 422


async def test_scan_note_requires_a_visible_scan(client: httpx.AsyncClient) -> None:
    r = await client.put(
        f"/api/v1/notes/scan/{new_ulid()}", headers=who("scan"), json={"blocks": BLOCKS}
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "SCAN_NOT_FOUND"


async def test_machine_keys_cannot_use_notes(client: httpx.AsyncClient) -> None:
    h = who("key")
    r = await client.post(
        "/api/v1/api-keys", headers=h, json={"name": "ci", "scopes": ["assess:read"]}
    )
    secret = r.json()["secret"]
    r = await client.get("/api/v1/notes", headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "INSUFFICIENT_SCOPE"
