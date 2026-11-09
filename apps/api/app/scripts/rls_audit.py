"""Audit row-level security and Supabase role exposure on the configured database.

Usage (apps/api):  python -m app.scripts.rls_audit

For every table in ``public``: RLS on? any policy? can Supabase's ``anon`` / ``authenticated`` roles
SELECT/INSERT/UPDATE/DELETE it? The API connects as the owner and bypasses RLS by design; the public
publishable key must reach nothing (DATABASE_DESIGN.md §8.1, §13.3). Exit 1 on any exposure.
"""

from __future__ import annotations

import asyncio
import sys

from app.config import get_settings

SQL = """
select c.relname,
       c.relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as exposed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
where c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname
"""


async def main() -> int:
    import asyncpg

    s = get_settings()
    url = (s.direct_database_url or s.database_url).replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    conn = await asyncpg.connect(url, statement_cache_size=0, timeout=10)
    try:
        roles = await conn.fetchval(
            "select count(*) from pg_roles where rolname in ('anon','authenticated')"
        )
        rows = await conn.fetch(SQL)
    finally:
        await conn.close()
    bad = 0
    for r in rows:
        problem = (not r["relrowsecurity"]) or bool(r["exposed"])
        bad += problem
        print(
            f"  {'FAIL' if problem else 'ok  '} {r['relname']:<28} rls={r['relrowsecurity']!s:<5} "
            f"policies={r['policies']} anon/authenticated_privileges={bool(r['exposed'])}"
        )
    print(f"supabase roles present: {roles == 2} · tables: {len(rows)} · problems: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))
