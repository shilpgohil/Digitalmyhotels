from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ForbiddenError, NotFoundError, utcnow
from app.models.hotel import Hotel
from app.models.platform import (
    Subscription,
    SubscriptionPlan,
    SubscriptionRenewalRequest,
)


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


def compute_sub_status(sub: Subscription, today: date | None = None) -> str:
    """Derive the current subscription status WITHOUT mutating the ORM object.

    Returns one of:
      'trial'         — within trial window.
      'active'        — paid plan, more than 7 days left.
      'expiring_soon' — future expiry within 7 days (still operating normally).
      'in_grace'      — past expiry_date but within grace window (wind-down mode).
      'expired'       — past both expiry_date AND grace window (fully blocked).
      'suspended'     — manually suspended by super admin.

    Use this in READ paths (list views, detail views) to avoid unintended
    SQLAlchemy auto-flush of a dirty ORM object.
    """
    today = today or date.today()
    if sub.status == "suspended":
        return "suspended"
    grace_end = sub.expiry_date + timedelta(days=sub.grace_days or 0)
    if today <= sub.expiry_date:
        soon = sub.expiry_date - timedelta(days=7)
        if today >= soon:
            return "expiring_soon"
        return "trial" if sub.status == "trial" else "active"
    if today <= grace_end:
        return "in_grace"
    return "expired"


def refresh_status(sub: Subscription, today: date | None = None) -> str:
    """Update sub.status in-place and return the new value.

    WARNING: This mutates the ORM object — only call in WRITE contexts
    (assert_transactions_allowed, extend_subscription, etc.) where the status
    update should be persisted. For READ-ONLY paths use compute_sub_status()
    to avoid unintended SQLAlchemy auto-flush writes.
    """
    new_status = compute_sub_status(sub, today)
    sub.status = new_status
    return new_status


async def is_past_grace(db: AsyncSession, hotel_id: UUID) -> bool:
    """True when the hotel's subscription lapsed BEYOND its grace period.

    Used by the tenant dependency for wind-down enforcement (plan Part 2):
    hotels without any subscription row (local/dev/tests) are never blocked;
    a suspended subscription is handled by the hotel-suspension check instead.
    """
    sub = await get_active_subscription(db, hotel_id)
    if sub is None or sub.status == "suspended":
        return False
    grace_end = sub.expiry_date + timedelta(days=sub.grace_days or 0)
    return date.today() > grace_end


async def assert_transactions_allowed(db: AsyncSession, hotel_id: UUID) -> None:
    """Hotels without a subscription row stay unrestricted (local/dev/tests).

    NOTE: an admin-suspended HOTEL is blocked here too (defence in depth —
    the tenant dependency already rejects suspended hotels for staff, but
    this also covers super-admin-context calls into a suspended hotel).
    """
    hotel_status = await db.scalar(select(Hotel.status).where(Hotel.id == hotel_id))
    if hotel_status == "suspended":
        raise ForbiddenError(
            "This hotel has been deactivated by the platform.",
            code="hotel_suspended",
        )
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
    """Partner-facing catalogue: active, priced plans only.

    Legacy trial/standard rows stay in the table for existing subscriptions
    but are hidden here (is_active=False) so the Choose Your Plan page
    shows the current Figma tiers.
    """
    result = await db.execute(
        select(SubscriptionPlan)
        .where(
            SubscriptionPlan.is_active.is_(True),
            SubscriptionPlan.price > 0,
        )
        .order_by(SubscriptionPlan.duration_days.asc())
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


async def renew_subscription(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    plan: SubscriptionPlan,
    start: date | None = None,
    grace_days: int = 7,
) -> Subscription:
    """Paid renewal/assignment by the platform.

    Extends from max(requested start / today, current expiry) so renewing
    early never eats the remaining paid days, and reactivates the hotel so
    it leaves the expired lists (a manual suspension is left untouched).
    """
    hotel = (
        await db.execute(select(Hotel).where(Hotel.id == hotel_id))
    ).scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")
    effective = start or date.today()
    current = await get_active_subscription(db, hotel_id)
    if (
        current is not None
        and current.status != "suspended"
        and current.expiry_date > effective
    ):
        effective = current.expiry_date
    sub = await assign_plan(
        db,
        hotel_id=hotel_id,
        plan=plan,
        start=effective,
        grace_days=grace_days,
        trial=False,
    )
    if hotel.status in ("trial", "expired"):
        hotel.status = "active"
    return sub


async def extend_subscription(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    days: int,
) -> Subscription:
    """Custom grace grant (client 09/2026): super admin extends the CURRENT
    plan by an arbitrary number of days — a short courtesy period, not a paid
    renewal.

    - Active plan: expiry moves out by `days` (remaining days preserved).
    - Already-lapsed plan: extension runs from TODAY (today + days), so a
      "5-day grant" always gives 5 usable days.
    - Suspended hotels cannot be extended (unsuspend is a deliberate action).
    - Reactivates an expired hotel so it leaves the expired lists.
    """
    hotel = (
        await db.execute(select(Hotel).where(Hotel.id == hotel_id))
    ).scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")
    sub = await get_active_subscription(db, hotel_id)
    if sub is None:
        raise NotFoundError(
            "This hotel has no subscription to extend — assign a plan instead."
        )
    if sub.status == "suspended" or hotel.status == "suspended":
        raise ConflictError(
            "Suspended hotels cannot be extended. Reactivate the hotel first.",
            code="hotel_suspended",
        )
    base = max(sub.expiry_date, date.today())
    sub.expiry_date = base + timedelta(days=days)
    refresh_status(sub)
    if hotel.status in ("trial", "expired"):
        hotel.status = "active"
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


# ── Renewal requests (partner pays platform UPI → super admin verifies) ──────


async def create_renewal_request(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    plan: SubscriptionPlan,
    requested_by_id: UUID,
    payment_mode: str | None = None,
    note: str | None = None,
) -> SubscriptionRenewalRequest:
    pending = await db.scalar(
        select(SubscriptionRenewalRequest.id).where(
            SubscriptionRenewalRequest.hotel_id == hotel_id,
            SubscriptionRenewalRequest.status == "pending",
        )
    )
    if pending is not None:
        raise ConflictError(
            "A renewal request is already pending for this hotel.",
            code="renewal_request_pending",
        )
    req = SubscriptionRenewalRequest(
        hotel_id=hotel_id,
        plan_id=plan.id,
        amount=plan.price,  # snapshot — plan may be repriced later
        status="pending",
        payment_mode=payment_mode,
        requested_by_id=requested_by_id,
        note=note,
    )
    db.add(req)
    await db.flush()
    return req


async def get_latest_renewal_request(
    db: AsyncSession, hotel_id: UUID
) -> SubscriptionRenewalRequest | None:
    result = await db.execute(
        select(SubscriptionRenewalRequest)
        .where(SubscriptionRenewalRequest.hotel_id == hotel_id)
        .order_by(SubscriptionRenewalRequest.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_renewal_requests(
    db: AsyncSession, *, status: str | None = None
) -> list[tuple[SubscriptionRenewalRequest, Hotel, SubscriptionPlan]]:
    query = (
        select(SubscriptionRenewalRequest, Hotel, SubscriptionPlan)
        .join(Hotel, Hotel.id == SubscriptionRenewalRequest.hotel_id)
        .join(SubscriptionPlan, SubscriptionPlan.id == SubscriptionRenewalRequest.plan_id)
        .order_by(SubscriptionRenewalRequest.created_at.desc())
        .limit(200)
    )
    if status:
        query = query.where(SubscriptionRenewalRequest.status == status)
    result = await db.execute(query)
    return list(result.tuples().all())


async def get_renewal_request(
    db: AsyncSession, request_id: UUID
) -> SubscriptionRenewalRequest:
    result = await db.execute(
        select(SubscriptionRenewalRequest).where(
            SubscriptionRenewalRequest.id == request_id
        )
    )
    req = result.scalar_one_or_none()
    if req is None:
        raise NotFoundError("Renewal request not found")
    return req


async def decide_renewal_request(
    db: AsyncSession,
    request_id: UUID,
    *,
    approve: bool,
    decided_by_id: UUID,
) -> tuple[SubscriptionRenewalRequest, SubscriptionPlan]:
    """Approve (assign the plan via the standard super-admin flow) or reject."""
    req = await get_renewal_request(db, request_id)
    if req.status != "pending":
        raise ConflictError(
            "Renewal request was already decided.", code="renewal_request_decided"
        )
    plan = await get_plan(db, req.plan_id)
    if approve:
        sub = await renew_subscription(db, hotel_id=req.hotel_id, plan=plan)
        # Carry the hotel's self-reported payment_mode onto the new Subscription
        # row so the billing-history summary cards reflect the correct mode.
        if req.payment_mode:
            normalised = "other" if req.payment_mode == "manual" else req.payment_mode
            sub.payment_mode = normalised
    req.status = "approved" if approve else "rejected"
    req.decided_at = utcnow()
    req.decided_by_id = decided_by_id
    await db.flush()
    return req, plan
