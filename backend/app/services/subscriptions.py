from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ForbiddenError, NotFoundError
from app.models.platform import Subscription, SubscriptionPlan


async def get_active_subscription(
    db: AsyncSession, hotel_id: UUID
) -> Subscription | None:
    result = await db.execute(
        select(Subscription)
        .where(Subscription.hotel_id == hotel_id)
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def refresh_status(sub: Subscription, today: date | None = None) -> str:
    today = today or date.today()
    grace_end = sub.expiry_date + timedelta(days=sub.grace_days)
    if sub.status == "suspended":
        return "suspended"
    if today <= sub.expiry_date:
        soon = sub.expiry_date - timedelta(days=7)
        sub.status = "expiring_soon" if today >= soon else (
            "trial" if sub.status == "trial" else "active"
        )
    elif today <= grace_end:
        sub.status = "expiring_soon"
    else:
        sub.status = "expired"
    return sub.status


async def assert_transactions_allowed(db: AsyncSession, hotel_id: UUID) -> None:
    """Hotels without a subscription row stay unrestricted (local/dev/tests)."""
    sub = await get_active_subscription(db, hotel_id)
    if sub is None:
        return
    refresh_status(sub)
    if sub.status == "suspended":
        raise ForbiddenError("Hotel is suspended", code="hotel_suspended")
    if sub.status == "expired" and sub.block_transactions_after_expiry:
        raise ForbiddenError(
            "Hotel subscription has expired. Transactions are blocked.",
            code="subscription_expired",
        )


async def list_plans(db: AsyncSession) -> list[SubscriptionPlan]:
    result = await db.execute(
        select(SubscriptionPlan).order_by(SubscriptionPlan.price.asc())
    )
    return list(result.scalars().all())


async def assign_plan(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    plan: SubscriptionPlan,
    start: date | None = None,
    grace_days: int = 7,
    trial: bool = False,
) -> Subscription:
    start = start or date.today()
    days = plan.trial_days if trial else plan.duration_days
    sub = Subscription(
        hotel_id=hotel_id,
        plan_id=plan.id,
        status="trial" if trial else "active",
        start_date=start,
        expiry_date=start + timedelta(days=days),
        grace_days=grace_days,
        payment_status="unpaid" if trial else "paid",
    )
    db.add(sub)
    await db.flush()
    return sub


async def get_plan_by_code(db: AsyncSession, code: str) -> SubscriptionPlan:
    result = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == code))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise NotFoundError("Subscription plan not found")
    return plan


async def get_plan(db: AsyncSession, plan_id: UUID) -> SubscriptionPlan:
    result = await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id))
    plan = result.scalar_one_or_none()
    if plan is None:
        raise NotFoundError("Subscription plan not found")
    return plan
