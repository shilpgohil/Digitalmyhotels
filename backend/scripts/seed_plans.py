"""Targeted, production-safe plan seeding.

Touches ONLY the subscription_plans table:
- Upserts the 4 Figma pricing tiers (Sep 2026 redesign).
- Deactivates the legacy trial/standard plans so they disappear from the
  partner "Choose Your Plan" page (existing subscriptions keep working —
  rows are never deleted).

Run:  DATABASE_URL=<url> python -m scripts.seed_plans
(from backend/, or rely on the .env-configured DATABASE_URL for local dev)
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.platform import SubscriptionPlan

FIGMA_TIERS: tuple[tuple[str, str, Decimal, int], ...] = (
    ("plan-1m", "1 Month", Decimal("499.00"), 30),
    ("plan-3m", "3 Months", Decimal("1299.00"), 90),
    ("plan-6m", "6 Months", Decimal("2499.00"), 180),
    ("plan-12m", "12 Months", Decimal("4499.00"), 365),
)

LEGACY_CODES = ("trial", "standard")


async def seed_plans() -> None:
    async with AsyncSessionLocal() as db:
        # Deactivate legacy plans (never delete — subscriptions reference them).
        for code in LEGACY_CODES:
            plan = (
                await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.code == code)
                )
            ).scalar_one_or_none()
            if plan is not None and plan.is_active:
                plan.is_active = False
                print(f"  deactivated legacy plan: {code}")

        # Upsert the 4 Figma tiers.
        for code, name, price, days in FIGMA_TIERS:
            plan = (
                await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.code == code)
                )
            ).scalar_one_or_none()
            if plan is None:
                db.add(
                    SubscriptionPlan(
                        code=code,
                        name=name,
                        price=price,
                        duration_days=days,
                        trial_days=14,
                    )
                )
                print(f"  created plan: {code} ({name}, Rs.{price}, {days}d)")
            else:
                # Keep production aligned with the Figma pricing.
                plan.name = name
                plan.price = price
                plan.duration_days = days
                if not plan.is_active:
                    plan.is_active = True
                print(f"  updated plan: {code} ({name}, Rs.{price}, {days}d)")

        await db.commit()

        active = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.is_active.is_(True))
            )
        ).scalars().all()
        print(f"Done. Active plans now: {[p.code for p in active]}")


if __name__ == "__main__":
    asyncio.run(seed_plans())
