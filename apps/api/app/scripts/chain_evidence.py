"""Anchor demo reports on the configured chain and record verification evidence.

Usage (apps/api, node running, CHAIN_* set):  python -m app.scripts.chain_evidence [--limit 3]

Anchors up to ``--limit`` simulated reports through the same service the API uses, verifies each
(original → valid, tampered copy → invalid), and merges the results into
``docs/evidence/web3/chain.json`` (written first by ``pnpm --filter @trustlens/contracts
run deploy:local``). Development chain only: refuses any chain id other than 31337.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.db.engine import create_engine, create_session_factory
from app.models.tables import ThreatReport
from app.services import anchors
from app.services.chain import ChainClient
from app.services.serialise import ts
from app.utils import utcnow

EVIDENCE = Path(__file__).resolve().parents[4] / "docs" / "evidence" / "web3" / "chain.json"


def _git_sha() -> str | None:
    try:
        out = subprocess.run(  # noqa: S603 — fixed argv, no user input
            ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
            cwd=EVIDENCE.parents[2],
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


async def main(limit: int) -> int:
    settings = get_settings()
    if settings.chain_id != 31337:
        print("chain_evidence only runs against the local development chain (31337).")
        return 2
    engine = create_engine(settings.database_url)
    factory = create_session_factory(engine)
    client = ChainClient(settings)
    results: list[dict[str, Any]] = []
    try:
        async with factory() as db:
            reports = list(
                (
                    await db.execute(
                        select(ThreatReport)
                        .where(ThreatReport.simulated.is_(True))
                        .order_by(ThreatReport.created_at)
                        .limit(limit)
                    )
                ).scalars()
            )
            if not reports:
                print("No simulated reports. Run: python -m app.scripts.seed_demo")
                return 1
            for report in reports:
                outcome = await anchors.anchor_report(db, settings, report, None, client)
                await db.commit()
                v = await anchors.verify_anchor(db, settings, report.id, client)
                tampered = {**v["payload"], "indicator": "tampered.example"}
                t = await anchors.verify_anchor(db, settings, report.id, client, supplied=tampered)
                a = outcome.anchor
                results.append(
                    {
                        "report_id": report.id,
                        "report_id_bytes32": a.report_id_bytes32,
                        "tx": a.tx_hash,
                        "block": a.block_number,
                        "revision": a.revision,
                        "commitment": a.commitment,
                        "payload_hash": a.payload_hash,
                        "verify_original": {"valid": v["valid"], "checks": v["checks"]},
                        "verify_tampered": {"valid": t["valid"], "checks": t["checks"]},
                        "simulated": True,
                    }
                )
                print(
                    f"  {report.id} rev {a.revision} tx {a.tx_hash[:12]}… block {a.block_number}"
                    f"  original valid={v['valid']}  tampered valid={t['valid']}"
                )
    finally:
        await engine.dispose()

    doc: dict[str, Any] = json.loads(EVIDENCE.read_text("utf-8")) if EVIDENCE.exists() else {}
    doc.update(
        {
            "chain_id": settings.chain_id,
            "contract": client.contract,
            "seeded_reports": results,
            "commit": _git_sha(),
            "evidence_generated_at": ts(utcnow()),
        }
    )
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(doc, indent=2) + "\n", "utf-8")
    ok = all(r["verify_original"]["valid"] and not r["verify_tampered"]["valid"] for r in results)
    print(f"{'OK' if ok else 'FAILED'}: wrote {EVIDENCE}")
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=3)
    raise SystemExit(asyncio.run(main(parser.parse_args().limit)))
