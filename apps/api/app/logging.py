"""Structured JSON logging with request-id binding.

Owner document: docs/08-infrastructure/MONITORING_HEALTHCHECKS.md §2–§3.
Never log passwords, tokens, cookies, API keys, full URLs with queries, page HTML, form values,
evidence payloads or model prompts (§3.2). Callers pass identifiers, not content.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_STATIC_FIELDS: dict[str, str] = {}

# Attributes present on every LogRecord; anything else passed via ``extra`` is a structured field.
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()) | {
    "message",
    "asctime",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
            "logger": record.name,
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        payload.update(_STATIC_FIELDS)
        if record.exc_info:
            # Stack traces stay server-side (BACKEND_OVERVIEW.md §7).
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str, *, env: str, version: str) -> None:
    _STATIC_FIELDS.update({"env": env, "version": version})
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # uvicorn's access log duplicates our request log and includes query strings.
    logging.getLogger("uvicorn.access").disabled = True
    # httpx/httpcore log every outbound URL at INFO — including user ids in Clerk Backend API
    # paths and scanned URLs' query strings. Our own events carry what is needed.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers[:] = []
        logging.getLogger(name).propagate = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"trustlens.{name}")
