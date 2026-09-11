"""Seed system roles, a super admin, and a demo hotel with an owner.

Run from backend/:  python -m scripts.seed
Idempotent — safe to re-run.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import time
from decimal import Decimal

from sqlalchemy import select

sys.path.insert(0, ".")

from app.core.permissions import RoleCode  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Hotel,
    HotelMembership,
    HotelSettings,
    Role,
    SubscriptionPlan,
    User,
)

ROLE_DEFS = [
    (RoleCode.SUPER_ADMIN, "Super Admin", "Platform-level control"),
    (RoleCode.OWNER, "Hotel Owner", "Full hotel access"),
    (RoleCode.MANAGER, "Hotel Manager", "Operations and financials"),
    (RoleCode.ADMIN, "Admin / Reception", "Front desk operations"),
    (RoleCode.HOUSEKEEPING, "Housekeeping", "Cleaning and maintenance"),
    (RoleCode.RECEPTIONIST, "Receptionist / Front Desk", "Front-desk staff account"),
    (RoleCode.GENERAL_STAFF, "General Staff", "Own attendance self-service only"),
]

# Note: .local/.test domains are rejected by the API's email validation.
SUPER_ADMIN_EMAIL = "superadmin@digitalmyhotels.in"
DEMO_OWNER_EMAIL = "owner@meridiancourt.in"
DEV_PASSWORD = "ChangeMe123!"


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        roles: dict[str, Role] = {}
        for code, name, desc in ROLE_DEFS:
            existing = await db.execute(select(Role).where(Role.code == code.value))
            role = existing.scalar_one_or_none()
            if role is None:
                role = Role(code=code.value, name=name, description=desc, is_system=True)
                db.add(role)
                await db.flush()
            roles[code.value] = role

        existing_sa = await db.execute(select(User).where(User.email == SUPER_ADMIN_EMAIL))
        if existing_sa.scalar_one_or_none() is None:
            db.add(
                User(
                    email=SUPER_ADMIN_EMAIL,
                    full_name="Platform Super Admin",
                    password_hash=hash_password(DEV_PASSWORD),
                    is_super_admin=True,
                )
            )

        existing_hotel = await db.execute(select(Hotel).where(Hotel.slug == "meridian-court"))
        hotel = existing_hotel.scalar_one_or_none()
        if hotel is None:
            hotel = Hotel(
                name="Meridian Court",
                slug="meridian-court",
                city="Mumbai",
                state="Maharashtra",
                country="India",
                timezone="Asia/Kolkata",
                status="active",
            )
            db.add(hotel)
            await db.flush()
            db.add(
                HotelSettings(
                    hotel_id=hotel.id,
                    check_in_time=time(14, 0),
                    check_out_time=time(11, 0),
                    invoice_prefix="MC",
                    booking_prefix="MC",
                )
            )

        existing_owner = await db.execute(select(User).where(User.email == DEMO_OWNER_EMAIL))
        owner = existing_owner.scalar_one_or_none()
        if owner is None:
            owner = User(
                email=DEMO_OWNER_EMAIL,
                full_name="Demo Hotel Owner",
                password_hash=hash_password(DEV_PASSWORD),
            )
            db.add(owner)
            await db.flush()

        existing_membership = await db.execute(
            select(HotelMembership).where(
                HotelMembership.user_id == owner.id,
                HotelMembership.hotel_id == hotel.id,
            )
        )
        if existing_membership.scalar_one_or_none() is None:
            db.add(
                HotelMembership(
                    user_id=owner.id,
                    hotel_id=hotel.id,
                    role_id=roles[RoleCode.OWNER.value].id,
                    status="active",
                )
            )

        # Legacy plans — kept for existing subscriptions/hotel-creation defaults,
        # but hidden from the partner "Choose Your Plan" page (is_active=False).
        for code, name, price, days, trial in (
            ("trial", "Trial", Decimal("0.00"), 14, 14),
            ("standard", "Standard", Decimal("4999.00"), 365, 14),
        ):
            existing_plan = (
                await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.code == code)
                )
            ).scalar_one_or_none()
            if existing_plan is None:
                db.add(
                    SubscriptionPlan(
                        code=code,
                        name=name,
                        price=price,
                        duration_days=days,
                        trial_days=trial,
                        is_active=False,
                    )
                )
            elif existing_plan.is_active:
                existing_plan.is_active = False

        # Figma pricing tiers (Sep 2026 redesign).
        # Client requirement #27: only 1/3/12-month plans are active.
        # 6-month is seeded as is_active=False (deactivated, never shown in
        # partner plan page or renewal dialog; can be re-activated via Super Admin).
        for code, name, price, days, active in (
            ("plan-1m", "1 Month", Decimal("499.00"), 30, True),
            ("plan-3m", "3 Months", Decimal("1299.00"), 90, True),
            ("plan-6m", "6 Months", Decimal("2499.00"), 180, False),
            ("plan-12m", "12 Months", Decimal("4499.00"), 365, True),
        ):
            existing_plan = (
                await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.code == code)
                )
            ).scalar_one_or_none()
            if existing_plan is None:
                db.add(
                    SubscriptionPlan(
                        code=code,
                        name=name,
                        price=price,
                        duration_days=days,
                        trial_days=14,
                        is_active=active,
                    )
                )
            elif existing_plan.is_active != active:
                # Enforce the intended active state (important: deactivate 6-month).
                existing_plan.is_active = active

        await db.commit()
        print("Seed complete.")
        print(f"  Super admin: {SUPER_ADMIN_EMAIL} / {DEV_PASSWORD}")
        print(f"  Demo owner:  {DEMO_OWNER_EMAIL} / {DEV_PASSWORD} (hotel: Meridian Court)")


if __name__ == "__main__":
    asyncio.run(seed())
