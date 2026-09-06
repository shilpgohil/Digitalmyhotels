from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, literal_column, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.permissions import RoleCode
from app.domain.gst import money
from app.models.booking import CheckIn
from app.models.hotel import Hotel, HotelSettings
from app.models.invoice import GstSettings
from app.models.payment import Payment
from app.models.platform import Subscription, SubscriptionPlan
from app.models.user import HotelMembership, Role, User
from app.schemas.platform import (
    CreateHotelRequest,
    HotelAdminListOut,
    HotelAdminOut,
    PlatformDashboardOut,
)
from app.services.audit import write_audit
from app.services.auth import create_user
from app.services.subscriptions import assign_plan, get_plan_by_code, refresh_status


def _slugify(name: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "hotel"


def _latest_sub_sq():
    """Latest subscription row per hotel (Postgres DISTINCT ON)."""
    return (
        select(Subscription)
        .distinct(Subscription.hotel_id)
        .order_by(Subscription.hotel_id, Subscription.created_at.desc())
        .subquery()
    )


def _sub_expired_cond(latest) -> object:
    """Latest subscription is past its grace period (and not suspended).

    Hotel.status is never flipped automatically when a subscription lapses,
    so "expired" must be derived from the subscription — otherwise expired
    hotels never appear on the admin's expired list or dashboard counts.
    Coalesced to FALSE so hotels without any subscription stay unaffected.
    """
    return func.coalesce(
        and_(
            latest.c.status != "suspended",
            latest.c.expiry_date + latest.c.grace_days < func.current_date(),
        ),
        False,
    )


async def _hotel_status_counts(db: AsyncSession) -> dict[str, int]:
    """Single-pass hotel counts with subscription-aware expiry semantics."""
    latest = _latest_sub_sq()
    sub_expired = _sub_expired_cond(latest)
    expired_cond = or_(Hotel.status == "expired", sub_expired)  # type: ignore[arg-type]
    one: object = literal_column("1")
    row = (await db.execute(
        select(
            func.count().label("total"),
            func.count(
                case((and_(Hotel.status == "active", not_(expired_cond)), one))
            ).label("active"),
            func.count(case((Hotel.status == "suspended", one))).label("suspended"),
            func.count(
                case((and_(Hotel.status == "trial", not_(expired_cond)), one))
            ).label("trial"),
            func.count(case((expired_cond, one))).label("expired"),
        )
        .select_from(Hotel)
        .outerjoin(latest, latest.c.hotel_id == Hotel.id)
    )).one()
    return {
        "total": int(row.total),
        "active": int(row.active),
        "suspended": int(row.suspended),
        "trial": int(row.trial),
        "expired": int(row.expired),
    }


async def dashboard(db: AsyncSession) -> PlatformDashboardOut:
    counts = await _hotel_status_counts(db)

    users = int(await db.scalar(select(func.count()).select_from(User)) or 0)
    # Expiring soon: latest subscription per hotel inside the warning window
    # (expiry within 7 days, grace period not yet over) — mirrors
    # subscriptions.refresh_status's "expiring_soon" state. Counting every
    # subscription row would double-count hotels with superseded rows and
    # include long-expired ones.
    today = date.today()
    soon = today + timedelta(days=7)
    latest = _latest_sub_sq()
    expiring = int(
        await db.scalar(
            select(func.count())
            .select_from(latest)
            .join(Hotel, Hotel.id == latest.c.hotel_id)
            .where(
                Hotel.status != "suspended",
                latest.c.status != "suspended",
                latest.c.expiry_date <= soon,
                latest.c.expiry_date + latest.c.grace_days >= today,
            )
        )
        or 0
    )
    # Today's check-ins across all hotels. "Today" is hotel-local; the
    # platform operates in India, so IST midnight is the correct boundary
    # (UTC midnight is 05:30 IST and mislabels early-morning check-ins).
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today_start = ist_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    today_checkins = int(
        await db.scalar(
            select(func.count()).select_from(CheckIn).where(
                CheckIn.checked_in_at >= today_start
            )
        )
        or 0
    )
    # Total revenue: all completed payments across all hotels.
    total_revenue = money(
        await db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.status == "completed"
            )
        )
        or 0
    )
    return PlatformDashboardOut(
        total_hotels=counts["total"],
        active_hotels=counts["active"],
        inactive_hotels=counts["suspended"],
        trial_hotels=counts["trial"],
        expired_hotels=counts["expired"],
        total_users=users,
        expiring_soon=expiring,
        today_checkins=today_checkins,
        total_revenue=total_revenue,
    )


async def list_hotels(
    db: AsyncSession,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
    recent_days: int | None = None,
) -> HotelAdminListOut:
    base = select(Hotel).order_by(Hotel.created_at.desc())
    # Active + expired lists are subscription-aware: Hotel.status is never
    # flipped automatically when a plan lapses, so Active must exclude
    # lapsed hotels and Expired must include them.
    if status in {"expired", "active"}:
        latest = _latest_sub_sq()
        base = base.outerjoin(latest, latest.c.hotel_id == Hotel.id)
        if status == "expired":
            base = base.where(or_(Hotel.status == "expired", _sub_expired_cond(latest)))  # type: ignore[arg-type]
            if recent_days is not None:
                cutoff = date.today() - timedelta(days=recent_days)
                base = base.where(latest.c.expiry_date >= cutoff)
        else:
            # "not expired": either no subscription (coalesce → True) or
            # expiry + grace >= today, avoiding not_() on an untyped expr.
            not_expired = func.coalesce(
                or_(
                    latest.c.status == "suspended",
                    latest.c.expiry_date + latest.c.grace_days >= func.current_date(),
                ),
                True,
            )
            base = base.where(and_(Hotel.status == "active", not_expired))
    elif status:
        base = base.where(Hotel.status == status)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(Hotel.name).like(like))

    total_count = int((await db.scalar(select(func.count()).select_from(base.subquery()))) or 0)
    hotels = list((await db.execute(base.limit(limit).offset(offset))).scalars().all())

    # Batch-load subscriptions, owner memberships, and plans for the current page.
    hotel_ids = [h.id for h in hotels]

    subs_by_hotel: dict[UUID, Subscription] = {}
    plans_by_id: dict[UUID, SubscriptionPlan] = {}
    if hotel_ids:
        sub_rows = (await db.execute(
            select(Subscription)
            .where(Subscription.hotel_id.in_(hotel_ids))
            .order_by(Subscription.created_at.desc())
        )).scalars().all()
        for sub_row in sub_rows:
            if sub_row.hotel_id not in subs_by_hotel:
                subs_by_hotel[sub_row.hotel_id] = sub_row
        plan_ids = {s.plan_id for s in subs_by_hotel.values()}
        if plan_ids:
            plan_rows = (await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.id.in_(plan_ids))
            )).scalars().all()
            plans_by_id = {p.id: p for p in plan_rows}

    # Batch-load owner memberships for this page.
    owner_role = (await db.execute(
        select(Role).where(Role.code == RoleCode.OWNER.value)
    )).scalar_one_or_none()
    owners_by_hotel: dict[UUID, User] = {}
    if hotel_ids and owner_role:
        membership_rows = (await db.execute(
            select(HotelMembership)
            .where(
                HotelMembership.hotel_id.in_(hotel_ids),
                HotelMembership.role_id == owner_role.id,
                HotelMembership.status == "active",
            )
        )).scalars().all()
        user_ids = {m.user_id for m in membership_rows}
        users_map: dict[UUID, User] = {}
        if user_ids:
            user_rows = (await db.execute(
                select(User).where(User.id.in_(user_ids))
            )).scalars().all()
            users_map = {u.id: u for u in user_rows}
        for m in membership_rows:
            if m.hotel_id not in owners_by_hotel and m.user_id in users_map:
                owners_by_hotel[m.hotel_id] = users_map[m.user_id]

    items: list[HotelAdminOut] = []
    for hotel in hotels:
        sub: Subscription | None = subs_by_hotel.get(hotel.id)
        if sub is not None:
            refresh_status(sub)
        plan = plans_by_id.get(sub.plan_id) if sub is not None else None
        owner = owners_by_hotel.get(hotel.id)
        items.append(
            HotelAdminOut(
                id=hotel.id,
                name=hotel.name,
                slug=hotel.slug,
                city=hotel.city,
                state=hotel.state,
                phone=hotel.phone,
                status=hotel.status,
                created_at=hotel.created_at,
                subscription_status=sub.status if sub else None,
                subscription_plan_name=plan.name if plan else None,
                expiry_date=sub.expiry_date if sub else None,
                owner_name=owner.full_name if owner else None,
                owner_email=owner.email if owner else None,
            )
        )

    counts = await _hotel_status_counts(db)
    return HotelAdminListOut(
        items=items,
        total=total_count,
        active=counts["active"],
        suspended=counts["suspended"],
        expired=counts["expired"],
        trial=counts["trial"],
        limit=limit,
        offset=offset,
    )


async def create_hotel_with_owner(
    db: AsyncSession,
    body: CreateHotelRequest,
    *,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> Hotel:
    slug = _slugify(body.name)
    existing = await db.execute(select(Hotel).where(Hotel.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{date.today().strftime('%y%m%d')}"

    address_line1: str | None = None
    if body.address:
        address_line1 = body.address[:255]

    hotel = Hotel(
        name=body.name.strip(),
        slug=slug,
        city=body.city,
        state=body.state,
        phone=body.phone,
        email=str(body.email) if body.email else None,
        address_line1=address_line1,
        status="trial",
    )
    db.add(hotel)
    await db.flush()
    settings = HotelSettings(hotel_id=hotel.id, access_mode=body.access_mode)
    db.add(settings)
    gst_settings = GstSettings(hotel_id=hotel.id)
    if body.gstin:
        gst_settings.is_gst_registered = True
        gst_settings.gstin = body.gstin
    db.add(gst_settings)

    owner = await create_user(
        db,
        email=str(body.owner_email),
        password=body.owner_password,
        full_name=body.owner_full_name,
        phone=body.owner_phone or None,
        must_reset_password=True,
    )
    role_result = await db.execute(select(Role).where(Role.code == RoleCode.OWNER.value))
    role = role_result.scalar_one_or_none()
    if role is None:
        raise ValidationAppError("Owner role is not seeded")
    db.add(
        HotelMembership(
            user_id=owner.id, hotel_id=hotel.id, role_id=role.id, status="active"
        )
    )
    if body.plan_code:
        plan = await get_plan_by_code(db, body.plan_code)
        await assign_plan(db, hotel_id=hotel.id, plan=plan, trial=True)
    await write_audit(
        db,
        action="platform.hotel_created",
        entity_type="hotel",
        entity_id=hotel.id,
        actor_id=actor_id,
        hotel_id=hotel.id,
        after={"name": hotel.name, "owner_email": owner.email},
        correlation_id=correlation_id,
    )
    return hotel


async def set_hotel_status(
    db: AsyncSession,
    hotel_id: UUID,
    status: str,
    *,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> Hotel:
    if status not in ("active", "suspended", "trial", "expired"):
        raise ValidationAppError("Invalid hotel status")
    result = await db.execute(select(Hotel).where(Hotel.id == hotel_id))
    hotel = result.scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")
    before = hotel.status
    hotel.status = status
    await write_audit(
        db,
        action="platform.hotel_status",
        entity_type="hotel",
        entity_id=hotel.id,
        actor_id=actor_id,
        hotel_id=hotel.id,
        before={"status": before},
        after={"status": status},
        correlation_id=correlation_id,
    )
    return hotel
