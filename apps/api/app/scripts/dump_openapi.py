"""Write the OpenAPI document to apps/api/openapi.json (BACKEND_OVERVIEW.md §11).

Run from apps/api: ``python -m app.scripts.dump_openapi``. Uses placeholder settings so the dump is
reproducible and never depends on — or leaks — real secrets.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.config import Settings
from app.main import create_app

PLACEHOLDER = Settings(
    environment="development",
    database_url="postgresql+asyncpg://openapi:openapi@localhost:1/openapi",
    clerk_issuer="https://example.clerk.accounts.dev",
    clerk_jwks_url="https://example.clerk.accounts.dev/.well-known/jwks.json",
    clerk_authorized_party="http://localhost:5173",
    app_version="0.1.0",
    _env_file=None,
)


def main() -> None:
    document = create_app(PLACEHOLDER).openapi()
    target = Path(__file__).resolve().parents[2] / "openapi.json"
    target.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
