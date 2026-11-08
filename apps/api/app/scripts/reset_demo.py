"""Reset demo data between rehearsals (DEMO_RUNBOOK.md §10).

Run: ``python -m app.scripts.reset_demo``.
"""

import asyncio

from app.scripts.seed_demo import reset

if __name__ == "__main__":
    asyncio.run(reset())
