"""Governance routes are registered, documented and require authentication (no database)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

ORG = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
ROUTES = [
    ("POST", "/api/v1/organisations"),
    ("PATCH", f"/api/v1/organisations/{ORG}"),
    ("POST", f"/api/v1/organisations/{ORG}/domains"),
    ("POST", f"/api/v1/organisations/{ORG}/domains/{ORG}/verify"),
    ("DELETE", f"/api/v1/organisations/{ORG}/domains/{ORG}"),
    ("DELETE", f"/api/v1/organisations/{ORG}/recipients/{ORG}"),
    ("GET", f"/api/v1/organisations/{ORG}/members"),
    ("POST", f"/api/v1/organisations/{ORG}/members"),
    ("PATCH", f"/api/v1/organisations/{ORG}/members/{ORG}"),
    ("DELETE", f"/api/v1/organisations/{ORG}/members/{ORG}"),
    ("DELETE", f"/api/v1/organisations/{ORG}/invites/{ORG}"),
    ("POST", "/api/v1/invites/sometoken-sometoken-sometoken/accept"),
    ("GET", "/api/v1/audit-logs"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
async def test_governance_routes_require_auth(
    client: httpx.AsyncClient, method: str, path: str
) -> None:
    response = await client.request(method, path, json={})
    assert response.status_code == 401, (method, path, response.text)
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_governance_routes_are_in_openapi(app: FastAPI) -> None:
    paths = app.openapi()["paths"]
    for method, path in ROUTES:
        template = path.replace(ORG, "{x}").replace("sometoken-sometoken-sometoken", "{token}")
        matches = [
            p
            for p in paths
            if p.count("/") == template.count("/")
            and all(
                a == b or (a.startswith("{") and b.startswith("{"))
                for a, b in zip(p.split("/"), template.split("/"), strict=True)
            )
        ]
        assert any(method.lower() in paths[p] for p in matches), (method, path)
    # The 501 placeholder is gone.
    assert "post" in paths["/api/v1/organisations/{org_id}/domains"]
