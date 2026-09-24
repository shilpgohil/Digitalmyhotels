"""Seed or reset Super Admin credentials.

Run from backend directory:
    python -m scripts.seed_superadmin
    python -m scripts.seed_superadmin custom_admin@domain.com MySecurePassword123!
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

sys.path.insert(0, ".")

from app.core.security import hash_password  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402


async def main() -> None:
    email = sys.argv[1].strip() if len(sys.argv) > 1 else "superadmin@digitalmyhotels.in"
    password = sys.argv[2].strip() if len(sys.argv) > 2 else "ChangeMe123!"

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User).where(User.email == email))
        user = res.scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                full_name="Platform Super Admin",
                password_hash=hash_password(password),
                is_super_admin=True,
                is_active=True,
            )
            db.add(user)
            action = "created"
        else:
            user.password_hash = hash_password(password)
            user.is_super_admin = True
            user.is_active = True
            action = "updated"

        await db.commit()
        print(f"Super Admin successfully {action}:")
        print(f"  Email:    {email}")
        print(f"  Password: {password}")


if __name__ == "__main__":
    asyncio.run(main())
