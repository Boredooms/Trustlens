"""Create or update the QStash cron schedules for the internal jobs (BACKEND_OVERVIEW.md §9.3).

Run by hand after a deploy, never automatically:

    python -m app.scripts.register_schedules --api-base https://<your-api>.onrender.com
    python -m app.scripts.register_schedules --api-base ... --dry-run   # print, change nothing
    python -m app.scripts.register_schedules --list

Idempotent: every schedule has a fixed ``Upstash-Schedule-Id``, so re-running updates the existing
schedule instead of adding a duplicate. Needs ``QSTASH_TOKEN`` (and ``QSTASH_URL`` for a regional
QStash) in the environment or apps/api/.env. Cron expressions are UTC.

Budget: QStash free tier is 500 messages/day; this set uses ~387/day
(288 reconcile + 96 sweep + 1 decay + 1 retention + weekly keep-alive).
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import urlsplit

import httpx

from app.config import get_settings

SCHEDULES: tuple[tuple[str, str], ...] = (
    ("cert-sweep", "*/15 * * * *"),
    ("reputation-decay", "0 2 * * *"),
    ("reconcile-scans", "*/5 * * * *"),
    ("keepalive", "0 3 * * 1"),
    ("retention", "30 2 * * *"),
)
SCHEDULE_PREFIX = "trustlens-"


def _api_base(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc:
        raise SystemExit("--api-base must be the public https:// origin of the API")
    return f"https://{parts.netloc}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api-base", help="public https origin of the API, e.g. https://api.x.com")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    parser.add_argument("--list", action="store_true", help="list existing schedules and exit")
    args = parser.parse_args(argv)

    settings = get_settings()
    if settings.qstash_token is None:
        raise SystemExit("QSTASH_TOKEN is not set.")
    base = settings.qstash_url.rstrip("/")
    headers = {"Authorization": f"Bearer {settings.qstash_token.get_secret_value()}"}

    with httpx.Client(timeout=15, headers=headers) as client:
        if args.list:
            resp = client.get(f"{base}/v2/schedules")
            resp.raise_for_status()
            for s in resp.json():
                print(f"{s.get('scheduleId'):32} {s.get('cron'):16} {s.get('destination')}")
            return 0
        if not args.api_base:
            parser.error("--api-base is required unless --list is given")
        api = _api_base(args.api_base)
        for job, cron in SCHEDULES:
            destination = f"{api}/internal/jobs/{job}"
            schedule_id = f"{SCHEDULE_PREFIX}{job}"
            if args.dry_run:
                print(f"would upsert {schedule_id:32} {cron:16} -> {destination}")
                continue
            resp = client.post(
                f"{base}/v2/schedules/{destination}",
                headers={
                    "Upstash-Cron": cron,
                    "Upstash-Schedule-Id": schedule_id,
                    "Upstash-Method": "POST",
                    "Upstash-Retries": "2",
                    "Content-Type": "application/json",
                },
                content=b"{}",
            )
            if resp.status_code >= 400:
                print(
                    f"FAILED {schedule_id}: {resp.status_code} {resp.text[:200]}", file=sys.stderr
                )
                return 1
            print(f"upserted {schedule_id:32} {cron:16} -> {destination} {json.dumps(resp.json())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
