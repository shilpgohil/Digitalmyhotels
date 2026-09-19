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
    """Single-pass hotel counts with subscription-aware expiry semantics.

    expired_cond_for_count intentionally includes grace-period hotels
    (subscription lapsed but grace_days not yet over) so the dashboard's
    "Expired Hotels" card count matches what the /admin/expired page shows.
    """
    latest = _latest_sub_sq()
    sub_expired = _sub_expired_cond(latest)
    # Strict "past grace" condition — hotel.status or DB date math
    strictly_expired_cond = or_(Hotel.status == "expired", sub_expired)  # type: ignore[arg-type]
    # Broader "needs attention" condition — includes grace-period hotels.
    # Used for the dashboard "Expired Hotels" card so its count matches the page.
    in_grace = func.coalesce(
        and_(
            latest.c.status != "suspended",
            latest.c.expiry_date < func.current_date(),
            latest.c.expiry_date + latest.c.grace_days >= func.current_date(),
        ),
        False,
    )
    expired_for_count = or_(strictly_expired_cond, in_grace)  # type: ignore[arg-type]

    one: object = literal_column("1")
    row = (await db.execute(
        select(
            func.count().label("total"),
            func.count(
                case((and_(Hotel.status == "active", not_(strictly_expired_cond)), one))
            ).label("active"),
            func.count(case((Hotel.status == "suspended", one))).label("suspended"),
            func.count(
                case((and_(Hotel.status == "trial", not_(strictly_expired_cond)), one))
            ).label("trial"),
            func.count(case((expired_for_count, one))).label("expired"),
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
    # "About to Expire" count — ONLY hotels with a FUTURE expiry within 7 days.
    # Intentionally excludes grace-period hotels (expiry already past) so the
    # count matches what the /admin/expired?filter=expiring page shows.
    # Grace-period hotels are counted in expired_hotels instead.
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
                latest.c.expiry_date >= func.current_date(),   # future only
                latest.c.expiry_date <= soon,
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
    # Total revenue: platform SaaS subscription income (what hotels paid to
    # use DigitalMyHotels). Excludes trial subscriptions. Matches the "Total
    # Collected" stat on the /admin/revenue Billing History page so clicking
    # the card shows the same number as the page.
    total_revenue = money(
        await db.scalar(
            select(func.coalesce(func.sum(SubscriptionPlan.price), 0))
            .select_from(Subscription)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .where(Subscription.status != "trial")
        )
        or 0
    )
    # Recently expired count — uses the SAME subscription-aware expired
    # condition as the list filter (not latest.c.status == "expired" which
    # only counts hotels whose DB status was explicitly flipped).
    thirty_days_ago = today - timedelta(days=30)
    _re_latest = _latest_sub_sq()
    _re_expired_cond = or_(
        Hotel.status == "expired",
        _sub_expired_cond(_re_latest),
    )
    recently_expired = int(
        await db.scalar(
            select(func.count())
            .select_from(Hotel)
            .outerjoin(_re_latest, _re_latest.c.hotel_id == Hotel.id)
            .where(
                _re_expired_cond,  # type: ignore[arg-type]
                or_(
                    _re_latest.c.expiry_date.is_(None),
                    _re_latest.c.expiry_date >= thirty_days_ago,
                ),
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
        recently_expired=recently_expired,
        today_checkins=today_checkins,
        total_revenue=total_revenue,
    )


async def revenue_summary(
    db: AsyncSession,
    *,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Per-hotel completed-payment revenue for the Total Revenue screen
    (client 09/2026: "Missing Total Revenue screen in Super Admin flow")."""
    base = (
        select(
            Hotel.id.label("hotel_id"),
            Hotel.name.label("hotel_name"),
            Hotel.city.label("city"),
            func.coalesce(func.sum(Payment.amount), 0).label("revenue"),
            func.count(Payment.id).label("payments_count"),
        )
        .join(Payment, and_(Payment.hotel_id == Hotel.id, Payment.status == "completed"))
        .group_by(Hotel.id, Hotel.name, Hotel.city)
        .order_by(func.sum(Payment.amount).desc())
    )
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(Hotel.name).like(like))

    total_count = int(
        (await db.scalar(select(func.count()).select_from(base.subquery()))) or 0
    )
    rows = (await db.execute(base.limit(limit).offset(offset))).all()

    grand_total = money(
        await db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.status == "completed"
            )
        )
        or 0
    )
    return {
        "total_revenue": grand_total,
        "items": [
            {
                "hotel_id": r.hotel_id,
                "hotel_name": r.hotel_name,
                "city": r.city,
                "revenue": money(r.revenue),
                "payments_count": int(r.payments_count),
            }
            for r in rows
        ],
        "total": total_count,
    }


async def billing_history(
    db: AsyncSession,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    mode: str | None = None,
    q: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> dict:
    """Billing History — one row per Subscription, with all-time summary cards."""
    from datetime import date as _date
    from decimal import Decimal as _Dec

    from sqlalchemy import String, cast

    from app.models.platform import SubscriptionPlan
    from app.models.user import HotelMembership
    from app.models.user import User as _User

    # ── Owner subquery ──────────────────────────────────────────────────────
    owner_role = (
        await db.execute(
            select(Role).where(Role.code == "owner").limit(1)
        )
    ).scalar_one_or_none()
    owner_role_id = owner_role.id if owner_role else None

    owner_sq = (
        select(
            HotelMembership.hotel_id,
            _User.full_name.label("owner_name"),
            _User.phone.label("owner_phone"),
        )
        .join(_User, _User.id == HotelMembership.user_id)
        .where(HotelMembership.role_id == owner_role_id)
        .distinct(HotelMembership.hotel_id)
        .order_by(HotelMembership.hotel_id, HotelMembership.created_at)
        .subquery()
    )

    # ── Base query ──────────────────────────────────────────────────────────
    base = (
        select(
            Subscription.id.label("subscription_id"),
            Hotel.id.label("hotel_id"),
            Hotel.name.label("hotel_name"),
            owner_sq.c.owner_name,
            owner_sq.c.owner_phone,
            Subscription.created_at.label("payment_date"),
            SubscriptionPlan.price.label("plan_amount"),
            SubscriptionPlan.name.label("plan_name"),
            SubscriptionPlan.duration_days.label("plan_duration_days"),
            Subscription.expiry_date,
            cast(None, String).label("payment_mode"),
        )
        .join(Hotel, Hotel.id == Subscription.hotel_id)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
        .outerjoin(owner_sq, owner_sq.c.hotel_id == Hotel.id)
        .where(Subscription.status != "trial")
        .order_by(Subscription.created_at.desc())
    )

    if date_from:
        base = base.where(func.date(Subscription.created_at) >= date_from)
    if date_to:
        base = base.where(func.date(Subscription.created_at) <= date_to)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(Hotel.name).like(like))

    total_count = int(
        (await db.scalar(select(func.count()).select_from(base.subquery()))) or 0
    )
    rows = (await db.execute(base.limit(limit).offset(offset))).all()

    # ── Summary (all-time, unfiltered) ──────────────────────────────────────
    total_collected = money(
        await db.scalar(
            select(func.coalesce(func.sum(SubscriptionPlan.price), 0))
            .select_from(Subscription)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .where(Subscription.status != "trial")
        ) or 0
    )
    today_first = _date.today().replace(day=1)
    this_month = money(
        await db.scalar(
            select(func.coalesce(func.sum(SubscriptionPlan.price), 0))
            .select_from(Subscription)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .where(
                Subscription.status != "trial",
                func.date(Subscription.created_at) >= today_first,
            )
        ) or 0
    )

    return {
        "summary": {
            "total_collected": total_collected,
            "this_month": this_month,
            "cash": _Dec("0"),
            "upi": _Dec("0"),
            "card": _Dec("0"),
            "other": _Dec("0"),
        },
        "items": [
            {
                "subscription_id": str(r.subscription_id),
                "hotel_id": str(r.hotel_id),
                "hotel_name": r.hotel_name,
                "owner_name": r.owner_name,
                "owner_phone": r.owner_phone,
                "payment_date": (
                    r.payment_date.date() if hasattr(r.payment_date, "date") else r.payment_date
                ),
                "plan_amount": r.plan_amount,
                "plan_name": r.plan_name,
                "plan_duration_days": r.plan_duration_days,
                "expiry_date": r.expiry_date,
                "payment_mode": r.payment_mode,
            }
            for r in rows
        ],
        "total": total_count,
    }


async def list_hotels(
    db: AsyncSession,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
    recent_days: int | None = None,
    expiring_within: int | None = None,
) -> HotelAdminListOut:
    base = select(Hotel).order_by(Hotel.created_at.desc())
    # Active + expired lists are subscription-aware: Hotel.status is never
    # flipped automatically when a plan lapses, so Active must exclude
    # lapsed hotels and Expired must include them.
    if status in {"expired", "active", "expiring_soon"}:
        latest = _latest_sub_sq()
        base = base.outerjoin(latest, latest.c.hotel_id == Hotel.id)
        if status == "expiring_soon":
            # "About to Expire" view: hotels whose subscription lapses within
            # the next `expiring_within` days (default 7) but NOT yet lapsed.
            days = expiring_within if expiring_within is not None else 7
            soon = date.today() + timedelta(days=days)
            base = base.where(
                and_(
                    latest.c.status != "suspended",
                    latest.c.expiry_date >= func.current_date(),
                    latest.c.expiry_date <= soon,
                )
            )
        elif status == "expired":
            expired_cond = or_(Hotel.status == "expired", _sub_expired_cond(latest))  # type: ignore[arg-type]
            if recent_days is not None:
                # "Recently Expired" view (client 09/2026):
                #  a) hotels that expired within the last `recent_days` —
                #     hotels whose status was set to expired manually but have
                #     no subscription row must not be NULL-filtered out
                #     (previous bug: `expiry_date >= cutoff` on a NULL row
                #     silently dropped them from the list);
                #  b) PLUS hotels whose plan lapses within the next
                #     `expiring_within` days — "about to expire" rows the
                #     admin should renew before they lapse.
                cutoff = date.today() - timedelta(days=recent_days)
                recently_expired = and_(
                    expired_cond,
                    or_(
                        latest.c.expiry_date.is_(None),
                        latest.c.expiry_date >= cutoff,
                    ),
                )
                # Grace-period hotels: subscription lapsed (expiry_date < today)
                # but still within the grace window (expiry + grace_days >= today).
                # These need admin attention and belong in "Recently Expired".
                # (Q5 answered: show them here, not in a separate section.)
                in_grace = and_(
                    latest.c.status != "suspended",
                    latest.c.expiry_date < func.current_date(),
                    latest.c.expiry_date + latest.c.grace_days >= func.current_date(),
                    latest.c.expiry_date >= cutoff,
                )
                recently_expired_or_grace = or_(recently_expired, in_grace)
                if expiring_within is not None:
                    soon = date.today() + timedelta(days=expiring_within)
                    about_to_expire = and_(
                        latest.c.status != "suspended",
                        latest.c.expiry_date >= func.current_date(),
                        latest.c.expiry_date <= soon,
                    )
                    base = base.where(or_(recently_expired_or_grace, about_to_expire))
                else:
                    base = base.where(recently_expired_or_grace)
            else:
                base = base.where(expired_cond)
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

    from app.schemas.guest import title_case_name as _tc
    hotel = Hotel(
        name=_tc(body.name.strip()),
        slug=slug,
        city=body.city,
        state=body.state,
        phone=body.phone,
        email=str(body.email) if body.email else None,
        address_line1=address_line1,
        status="trial",
        total_rooms=body.total_rooms,
        map_id=body.map_id,
        max_team_members=body.max_team_members,
    )
    db.add(hotel)
    await db.flush()
    # Determine tax_inclusive_pricing from gst_type
    gst_type = body.gst_type or "no_gst"
    tax_inclusive = gst_type == "included_by_hotel"
    settings = HotelSettings(
        hotel_id=hotel.id,
        access_mode=body.access_mode,
        tax_inclusive_pricing=tax_inclusive,
    )
    db.add(settings)
    gst_settings = GstSettings(hotel_id=hotel.id)
    if body.gstin:
        gst_settings.is_gst_registered = True
        gst_settings.gstin = body.gstin
    elif gst_type in ("included_by_hotel", "included_by_customer"):
        gst_settings.is_gst_registered = True
    db.add(gst_settings)
    # Payment config (merchant name + payment URL)
    if body.merchant_name or body.payment_url:
        from app.models.hotel import HotelPaymentConfig as _HPC
        db.add(_HPC(
            hotel_id=hotel.id,
            merchant_name=body.merchant_name,
            payment_url=body.payment_url,
        ))

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


async def _owner_for_hotel(db: AsyncSession, hotel_id: UUID) -> User | None:
    owner_role = (
        await db.execute(select(Role).where(Role.code == RoleCode.OWNER.value))
    ).scalar_one_or_none()
    if owner_role is None:
        return None
    membership = (
        await db.execute(
            select(HotelMembership)
            .where(
                HotelMembership.hotel_id == hotel_id,
                HotelMembership.role_id == owner_role.id,
                HotelMembership.status == "active",
            )
            .order_by(HotelMembership.created_at)
        )
    ).scalars().first()
    if membership is None:
        return None
    return await db.get(User, membership.user_id)


async def get_hotel_detail(db: AsyncSession, hotel_id: UUID) -> dict:
    """Hotel profile + owner contact + GST + subscription for the Super Admin
    edit page. Returns ALL fields entered during hotel creation so the admin
    always sees the complete, up-to-date picture (client 9-10 rows 13/14)."""
    hotel = (await db.execute(select(Hotel).where(Hotel.id == hotel_id))).scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")
    owner = await _owner_for_hotel(db, hotel_id)

    # GST settings (for GSTIN display)
    from app.models.invoice import GstSettings

    gst_row = (
        await db.execute(select(GstSettings).where(GstSettings.hotel_id == hotel_id))
    ).scalar_one_or_none()

    # Latest subscription
    latest_sub = (
        await db.execute(
            select(Subscription)
            .where(Subscription.hotel_id == hotel_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    plan_name: str | None = None
    sub_status: str | None = None
    sub_expiry: str | None = None
    if latest_sub:
        plan_result = await db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == latest_sub.plan_id)
        )
        plan_obj = plan_result.scalar_one_or_none()
        plan_name = plan_obj.name if plan_obj else None
        sub_status = latest_sub.status
        sub_expiry = str(latest_sub.expiry_date) if latest_sub.expiry_date else None

    # Effective status — subscription-aware, matching the list views.
    # Hotel.status is never flipped automatically when a plan lapses, so the
    # raw column can still say "active" for a hotel whose subscription is
    # long past its grace period. The detail page must derive the same
    # "expired" the admin list shows (client 09/2026: "hotel already
    # expired but displays status Active in detail").
    effective_status = hotel.status
    if (
        hotel.status == "active"
        and latest_sub is not None
        and latest_sub.status != "suspended"
        and latest_sub.expiry_date is not None
        and latest_sub.expiry_date + timedelta(days=latest_sub.grace_days or 0)
        < date.today()
    ):
        effective_status = "expired"

    return {
        "id": hotel.id,
        "name": hotel.name,
        "city": hotel.city,
        "state": hotel.state,
        "phone": hotel.phone,
        "email": hotel.email,
        "address_line1": hotel.address_line1,
        "status": effective_status,
        "created_at": hotel.created_at,
        "gstin": gst_row.gstin if gst_row else None,
        "is_gst_registered": gst_row.is_gst_registered if gst_row else False,
        "owner_user_id": owner.id if owner else None,
        "max_team_members": hotel.max_team_members or 5,
        "owner_name": owner.full_name if owner else None,
        "owner_email": owner.email if owner else None,
        "owner_phone": owner.phone if owner else None,
        "subscription_plan_name": plan_name,
        "subscription_status": sub_status,
        "subscription_expiry": sub_expiry,
        # Feature gate: load from HotelSettings (plan §feature-modes)
        "access_mode": (
            (
                await db.scalar(
                    select(HotelSettings.access_mode).where(HotelSettings.hotel_id == hotel_id)
                )
            )
            or "full"
        ),
    }


async def update_hotel_admin(
    db: AsyncSession,
    hotel_id: UUID,
    changes: dict,
    *,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> dict:
    """Super Admin edit of hotel profile + owner phone backfill (items 28/30).

    Only explicit fields are touched; owner_phone updates the owner USER so
    phone login starts working for accounts created without one.
    """
    hotel = (await db.execute(select(Hotel).where(Hotel.id == hotel_id))).scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")

    owner_phone = changes.pop("owner_phone", None)
    gstin = changes.pop("gstin", None)
    # access_mode is stored in HotelSettings, not Hotel itself.
    new_access_mode = changes.pop("access_mode", None)
    before = {k: str(getattr(hotel, k)) for k in changes if hasattr(hotel, k)}
    for key, value in changes.items():
        if hasattr(hotel, key):
            # Auto-capitalize hotel name on edit (same as creation).
            if key == "name" and isinstance(value, str):
                from app.schemas.guest import title_case_name as _tc_edit
                value = _tc_edit(value.strip())
            setattr(hotel, key, value)

    # Update GSTIN in the hotel's GST settings row (client 9-10 rows 13/14)
    if gstin is not None:
        from app.models.invoice import GstSettings as _GstSettings

        gst_row = (
            await db.execute(
                select(_GstSettings).where(_GstSettings.hotel_id == hotel_id)
            )
        ).scalar_one_or_none()
        if gst_row is None:
            gst_row = _GstSettings(hotel_id=hotel_id)
            db.add(gst_row)
        gst_row.gstin = gstin.strip().upper() if gstin.strip() else None
        gst_row.is_gst_registered = bool(gst_row.gstin)

    # Update access_mode in HotelSettings if the SA changed it.
    if new_access_mode is not None:
        settings_row = (
            await db.execute(
                select(HotelSettings).where(HotelSettings.hotel_id == hotel_id)
            )
        ).scalar_one_or_none()
        if settings_row is None:
            settings_row = HotelSettings(hotel_id=hotel_id)
            db.add(settings_row)
        old_mode = settings_row.access_mode
        settings_row.access_mode = new_access_mode
        before["access_mode"] = old_mode

    if owner_phone is not None:
        owner = await _owner_for_hotel(db, hotel_id)
        if owner is None:
            raise ValidationAppError(
                "This hotel has no active owner account", code="no_owner"
            )
        from app.schemas.guest import normalize_phone

        normalized = normalize_phone(owner_phone)
        if not normalized:
            raise ValidationAppError("Invalid owner phone number", code="invalid_phone")
        owner.phone = normalized

    await write_audit(
        db,
        action="platform.hotel_updated",
        entity_type="hotel",
        entity_id=hotel.id,
        actor_id=actor_id,
        hotel_id=hotel.id,
        before=before,
        after={
            **{k: str(v) for k, v in changes.items()},
            **({"owner_phone": "updated"} if owner_phone is not None else {}),
        },
        correlation_id=correlation_id,
    )
    await db.flush()
    return await get_hotel_detail(db, hotel_id)


async def update_plan(
    db: AsyncSession,
    plan_id: UUID,
    changes: dict,
    *,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> SubscriptionPlan:
    """Edit a subscription plan (item 27). Deactivation hides the plan from
    new assignments but never deletes it — existing subscriptions keep their
    reference (the 6-month plan is deactivated, not removed)."""
    plan = (
        await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id))
    ).scalar_one_or_none()
    if plan is None:
        raise NotFoundError("Plan not found")
    before = {k: str(getattr(plan, k)) for k in changes}
    for key, value in changes.items():
        setattr(plan, key, value)
    await write_audit(
        db,
        action="platform.plan_updated",
        entity_type="subscription_plan",
        entity_id=plan.id,
        actor_id=actor_id,
        before=before,
        after={k: str(v) for k, v in changes.items()},
        correlation_id=correlation_id,
    )
    await db.flush()
    return plan


def _mask_phone(phone: str | None) -> str:
    if not phone:
        return ""
    if len(phone) <= 4:
        return "*" * len(phone)
    return "*" * (len(phone) - 4) + phone[-4:]


async def search_customers(
    db: AsyncSession,
    *,
    q: str | None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Cross-hotel guest search for Super Admin "All Customers" (item 36).

    Returns MASKED summaries only (name, masked phone, hotel, city, ID last-4).
    The full profile requires the separate audited detail action.
    """
    from app.models.guest import Guest
    from app.schemas.guest import normalize_phone

    stmt = (
        select(Guest, Hotel.name.label("hotel_name"))
        .join(Hotel, Hotel.id == Guest.hotel_id)
    )
    if q:
        normalized = normalize_phone(q)
        conditions: list = [Guest.full_name.ilike(f"%{q}%")]
        if normalized:
            conditions.append(Guest.normalized_phone.contains(normalized))
        stmt = stmt.where(or_(*conditions))
    total = int(
        (
            await db.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
    )
    rows = (
        await db.execute(
            stmt.order_by(Guest.full_name).limit(limit).offset(offset)
        )
    ).all()
    items = [
        {
            "guest_id": guest.id,
            "full_name": guest.full_name,
            "phone_masked": _mask_phone(guest.normalized_phone),
            "hotel_id": guest.hotel_id,
            "hotel_name": hotel_name,
            "city": guest.city,
            "id_proof_type": guest.id_proof_type,
            "id_last4": guest.id_last4,
            "created_at": guest.created_at,
        }
        for guest, hotel_name in rows
    ]
    return items, total


async def export_customers(
    db: AsyncSession,
    *,
    q: str | None,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> list[dict]:
    """FULL customer export for the platform owner (client 16/09: the CSV
    "Missing ID and No show contact No" — the old export reused the masked
    list). Returns UNMASKED phone + decrypted ID number; every export writes
    a platform.customers_exported audit row (super-admin only endpoint).
    """
    from app.core.encryption import decrypt_sensitive
    from app.models.guest import Guest
    from app.schemas.guest import normalize_phone

    stmt = select(Guest, Hotel.name.label("hotel_name")).join(
        Hotel, Hotel.id == Guest.hotel_id
    )
    if q:
        normalized = normalize_phone(q)
        conditions: list = [Guest.full_name.ilike(f"%{q}%")]
        if normalized:
            conditions.append(Guest.normalized_phone.contains(normalized))
        stmt = stmt.where(or_(*conditions))
    rows = (await db.execute(stmt.order_by(Guest.full_name).limit(10000))).all()

    items: list[dict] = []
    for guest, hotel_name in rows:
        id_number: str = ""
        if guest.id_encrypted:
            try:
                id_number = decrypt_sensitive(guest.id_encrypted)
            except Exception:  # noqa: BLE001 — legacy/foreign-key rows: degrade to last4
                id_number = f"****{guest.id_last4}" if guest.id_last4 else ""
        elif guest.id_last4:
            id_number = f"****{guest.id_last4}"
        items.append(
            {
                "full_name": guest.full_name,
                "phone": guest.normalized_phone or "",
                "hotel_name": hotel_name,
                "city": guest.city or "",
                "id_proof_type": guest.id_proof_type or "",
                "id_number": id_number,
                "created_at": guest.created_at,
            }
        )
    await write_audit(
        db,
        action="platform.customers_exported",
        entity_type="guest",
        entity_id=actor_id,
        actor_id=actor_id,
        after={"rows": len(items), "query": q or ""},
        correlation_id=correlation_id,
    )
    return items


async def get_customer_detail(
    db: AsyncSession,
    guest_id: UUID,
    *,
    actor_id: UUID,
    correlation_id: str | None = None,
) -> dict:
    """Explicit, AUDITED full-profile view of one customer (item 36).

    This is the only cross-hotel path to a guest's unmasked contact data;
    every call writes platform.customer_viewed to the audit log.
    """
    from app.models.guest import Guest

    row = (
        await db.execute(
            select(Guest, Hotel.name.label("hotel_name"))
            .join(Hotel, Hotel.id == Guest.hotel_id)
            .where(Guest.id == guest_id)
        )
    ).first()
    if row is None:
        raise NotFoundError("Customer not found")
    guest, hotel_name = row
    await write_audit(
        db,
        action="platform.customer_viewed",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=actor_id,
        hotel_id=guest.hotel_id,
        after={"hotel": hotel_name, "phone_last4": (guest.normalized_phone or "")[-4:]},
        correlation_id=correlation_id,
    )
    return {
        "guest_id": guest.id,
        "full_name": guest.full_name,
        "phone": guest.normalized_phone,
        "email": guest.email,
        "address": guest.address,
        "city": guest.city,
        "state": guest.state,
        "country": guest.country,
        "postal_code": guest.postal_code,
        "gender": guest.gender,
        "date_of_birth": guest.date_of_birth,
        "id_proof_type": guest.id_proof_type,
        "id_last4": guest.id_last4,
        "hotel_id": guest.hotel_id,
        "hotel_name": hotel_name,
        "created_at": guest.created_at,
    }


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
