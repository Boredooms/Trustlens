"""Local launcher: ``python -m app.serve [--reload]``.

On Windows, psycopg's async driver (used by the LangGraph Postgres checkpointer) cannot run on the
default Proactor event loop, so this selects the selector loop before uvicorn starts. On Linux
(Render, Docker) plain ``uvicorn app.main:app`` is equivalent.
"""

from __future__ import annotations

import asyncio
import os
import sys

import uvicorn

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        reload="--reload" in sys.argv,
        loop="asyncio",
    )
