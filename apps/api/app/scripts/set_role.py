"""Grant a signed-in user a role (users.role is ours; Clerk claims never set it).

Run: ``python -m app.scripts.set_role <email|clerk_user_id> <user|analyst|operator>``
The user must have signed in once so the row exists. With no arguments, lists users.
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import or_, select

from app.config import get_settings
from app.db.engine import create_engine, create_session_factory
from app.models.tables import User

ROLES = ("user", "analyst", "operator")


async def main(argv: list[str]) -> int:
    engine = create_engine(get_settings().database_url)
    try:
        async with create_session_factory(engine)() as db:
            if not argv:
                for u in (await db.execute(select(User).order_by(User.created_at))).scalars():
                    print(f"{u.role:9} {u.email:40} {u.clerk_user_id}")
                return 0
            if len(argv) != 2 or argv[1] not in ROLES:
                print(__doc__)
                return 2
            ident, role = argv
            users = list(
                (
                    await db.execute(
                        select(User).where(or_(User.email == ident, User.clerk_user_id == ident))
                    )
                ).scalars()
            )
            if len(users) != 1:
                print(f"{len(users)} users match {ident!r}; sign in first or pass the clerk id.")
                return 1
            users[0].role = role
            await db.commit()
            print(f"{users[0].email} ({users[0].clerk_user_id}) is now {role}")
            return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
