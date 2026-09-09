from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import money
from app.models.booking import Booking, BookingRoom
from app.models.expense import Expense, ExpenseCategory
from app.models.guest import Guest
from app.models.invoice import Invoice
from app.models.payment import HotelCharge, Payment, Refund
from app.models.room import Room, RoomType
from app.schemas.ops import (
    ArrivalsItem,
    ArrivalsOut,
    DailyTrendItem,
    DailyTrendOut,
    ExpenseReportOut,
    GstBookingRowOut,
    GstByBookingOut,
    GstReportOut,
    GuestMixItem,
    HotelKpis,
    MonthlyTrendItem,
    OccupancyReportOut,
    PaymentMethodReportOut,
    PlatformTrendOut,
    RestaurantBillingOut,
    RestaurantBillingRowOut,
    RevenueReportOut,
    RoomTypeRevenue,
    RoomUtilizationOut,
    RoomUtilizationRowOut,
    SmartDashboardOut,
    SmartInsight,
    TrendPoint30,
    WeekPatternItem,
)


def _range(from_date: date, to_date: date) -> tuple[date, date]:
    if to_date < from_date:
        raise ValidationAppError("to_date must be on or after from_date")
    return from_date, to_date


async def occupancy(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> OccupancyReportOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    days = max((to_date - from_date).days, 1)
    total_rooms = int(
        await db.scalar(
            select(func.count()).select_from(Room).where(
                Room.hotel_id == hotel_id, Room.is_active.is_(True)
            )
        )
        or 0
    )
    # Occupied nights ≈ nights of bookings overlapping the window.
    bookings = (
        await db.execute(
            select(Booking).where(
                Booking.hotel_id == hotel_id,
                Booking.status.in_(("confirmed", "checked_in", "checked_out")),
                Booking.check_in_date < to_date,
                Booking.check_out_date > from_date,
            )
        )
    ).scalars().all()
    occupied_nights = 0
    for booking in bookings:
        start = max(booking.check_in_date, from_date)
        # Day-use bookings (same date) contribute 1 occupied night — they
        # physically use the room for that calendar day.
        end = min(
            max(booking.check_out_date, booking.check_in_date + timedelta(days=1)),
            to_date,
        )
        nights = max((end - start).days, 1)
        occupied_nights += nights * max(booking.room_count, 1)
    available_nights = total_rooms * days
    percent = (
        money(Decimal(occupied_nights) * Decimal("100") / Decimal(available_nights))
        if available_nights
        else Decimal("0.00")
    )
    return OccupancyReportOut(
        from_date=from_date,
        to_date=to_date,
        total_rooms=total_rooms,
        occupied_nights=occupied_nights,
        available_nights=available_nights,
        occupancy_percent=percent,
    )


async def revenue(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> RevenueReportOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)

    # Revenue = payments collected (all methods) in the period.
    # We use payment-based recognition so room revenue and charge revenue
    # are never double-counted (Booking.total_amount already includes charges;
    # adding HotelCharge.total_amount on top is incorrect — audit finding #2).
    # "Room revenue" ≈ payments on stay bookings; "charge revenue" ≈ standalone
    # charge payments. Both flow through the same Payment model (hotel_id + paid_at).
    total_collected = money(
        await db.scalar(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.hotel_id == hotel_id,
                Payment.status == "completed",
                func.date(Payment.paid_at) >= from_date,
                func.date(Payment.paid_at) <= to_date,
            )
        )
        or 0
    )
    # Charge-specific revenue within the period (non-voided, for the breakdown
    # row — this is NOT added to total; it's informational only).
    charge_rev = money(
        await db.scalar(
            select(func.coalesce(func.sum(HotelCharge.total_amount), 0)).where(
                HotelCharge.hotel_id == hotel_id,
                HotelCharge.voided_at.is_(None),
                func.date(HotelCharge.created_at) >= from_date,
                func.date(HotelCharge.created_at) <= to_date,
            )
        )
        or 0
    )
    # Derive room revenue as: total collected − charge amounts (approximate,
    # since payments are booking-level, not split by line item).
    room_rev = money(max(total_collected - charge_rev, Decimal("0")))

    refunds = money(
        await db.scalar(
            select(func.coalesce(func.sum(Refund.amount), 0)).where(
                Refund.hotel_id == hotel_id,
                Refund.status == "completed",
                func.date(Refund.refunded_at) >= from_date,
                func.date(Refund.refunded_at) <= to_date,
            )
        )
        or 0
    )
    return RevenueReportOut(
        from_date=from_date,
        to_date=to_date,
        room_revenue=room_rev,
        charge_revenue=charge_rev,
        total_revenue=total_collected,
        refunds=refunds,
        net_revenue=money(total_collected - refunds),
    )


async def expenses(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> ExpenseReportOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    rows = (
        await db.execute(
            select(Expense.status, func.coalesce(func.sum(Expense.amount), 0)).where(
                Expense.hotel_id == hotel_id,
                Expense.expense_date >= from_date,
                Expense.expense_date <= to_date,
            ).group_by(Expense.status)
        )
    ).all()
    by_status = {status: money(amount) for status, amount in rows}
    cat_rows = (
        await db.execute(
            select(
                func.coalesce(ExpenseCategory.name, "Uncategorized"),
                func.coalesce(func.sum(Expense.amount), 0),
            )
            .outerjoin(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .where(
                Expense.hotel_id == hotel_id,
                Expense.expense_date >= from_date,
                Expense.expense_date <= to_date,
            )
            .group_by(ExpenseCategory.name)
        )
    ).all()
    by_category = {name: money(amount) for name, amount in cat_rows}
    total = money(sum(by_status.values(), Decimal("0.00")))
    return ExpenseReportOut(
        from_date=from_date,
        to_date=to_date,
        total=total,
        by_status=by_status,
        by_category=by_category,
    )


async def payments_by_method(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> PaymentMethodReportOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)

    async def _sum(model, method: str, date_col, status: str) -> Decimal:
        value = await db.scalar(
            select(func.coalesce(func.sum(model.amount), 0)).where(
                model.hotel_id == hotel_id,
                model.method == method,
                model.status == status,
                func.date(date_col) >= from_date,
                func.date(date_col) <= to_date,
            )
        )
        return money(value or 0)

    return PaymentMethodReportOut(
        from_date=from_date,
        to_date=to_date,
        cash=await _sum(Payment, "cash", Payment.paid_at, "completed"),
        upi=await _sum(Payment, "upi", Payment.paid_at, "completed"),
        refunds_cash=await _sum(Refund, "cash", Refund.refunded_at, "completed"),
        refunds_upi=await _sum(Refund, "upi", Refund.refunded_at, "completed"),
    )


async def gst_by_booking(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> GstByBookingOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    rows = (
        await db.execute(
            select(Invoice, Booking.booking_number)
            .join(Booking, Booking.id == Invoice.booking_id)
            .where(
                Invoice.hotel_id == hotel_id,
                Invoice.status.in_(("generated", "partially_paid", "paid")),
                Invoice.invoice_date >= from_date,
                Invoice.invoice_date <= to_date,
            )
            .order_by(Invoice.invoice_date.desc())
            .limit(500)
        )
    ).all()
    items = [
        GstBookingRowOut(
            booking_number=booking_number,
            guest_name=invoice.guest_name,
            invoice_number=invoice.invoice_number,
            invoice_date=invoice.invoice_date,
            taxable=money(invoice.subtotal - invoice.discount_amount),
            cgst=invoice.cgst_amount,
            sgst=invoice.sgst_amount,
            igst=invoice.igst_amount,
            total=invoice.total_amount,
            status=invoice.status,
        )
        for invoice, booking_number in rows
    ]
    total_taxable = money(sum((i.taxable for i in items), Decimal("0.00")))
    total_gst = money(sum((i.cgst + i.sgst + i.igst for i in items), Decimal("0.00")))
    total_amount = money(sum((i.total for i in items), Decimal("0.00")))
    return GstByBookingOut(
        from_date=from_date,
        to_date=to_date,
        items=items,
        total_taxable=total_taxable,
        total_gst=total_gst,
        total_amount=total_amount,
    )


async def restaurant_billing(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> RestaurantBillingOut:
    """Restaurant/food charges billed to in-house bookings, with GST breakdown."""
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)

    # created_at is UTC — compare against the HOTEL's local calendar date so
    # "today" means today in the hotel's timezone (charges after ~5:30 PM UTC
    # belong to the next IST day).
    from app.models.hotel import Hotel

    hotel_tz = (
        await db.execute(select(Hotel.timezone).where(Hotel.id == hotel_id))
    ).scalar_one_or_none() or "Asia/Kolkata"
    local_date = func.date(func.timezone(hotel_tz, HotelCharge.created_at))

    rows = (
        await db.execute(
            select(HotelCharge, Booking.booking_number, Guest.full_name)
            .join(Booking, Booking.id == HotelCharge.booking_id)
            .join(Guest, Guest.id == Booking.primary_guest_id, isouter=True)
            .where(
                HotelCharge.hotel_id == hotel_id,
                HotelCharge.category.in_(("restaurant", "food")),
                HotelCharge.voided_at.is_(None),
                local_date >= from_date,
                local_date <= to_date,
            )
            .order_by(HotelCharge.created_at.desc())
            .limit(500)
        )
    ).all()
    # Convert charged_on to the HOTEL's local date (audit finding: showing
    # the raw UTC date put late-evening IST charges on the wrong day —
    # exactly what the client red-boxed in the Date column).
    from zoneinfo import ZoneInfo

    try:
        _tz = ZoneInfo(hotel_tz)
    except (KeyError, ValueError):
        _tz = ZoneInfo("Asia/Kolkata")

    items: list[RestaurantBillingRowOut] = []
    for charge, booking_number, guest_name in rows:
        rate = (
            money(charge.tax_amount / charge.taxable_amount * 100)
            if charge.taxable_amount > 0
            else Decimal("0.00")
        )
        items.append(
            RestaurantBillingRowOut(
                booking_number=booking_number,
                guest_name=guest_name or "—",
                taxable_value=charge.taxable_amount,
                gst_rate=rate,
                gst_payable=charge.tax_amount,
                final_price=charge.total_amount,
                charged_on=charge.created_at.astimezone(_tz).date(),
            )
        )
    return RestaurantBillingOut(
        from_date=from_date,
        to_date=to_date,
        items=items,
        total_amount=money(sum((i.final_price for i in items), Decimal("0.00"))),
        total_taxable=money(sum((i.taxable_value for i in items), Decimal("0.00"))),
        total_gst=money(sum((i.gst_payable for i in items), Decimal("0.00"))),
    )


async def room_utilization(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> RoomUtilizationOut:
    """Single-query room utilisation report — replaces the previous N-queries
    implementation that executed one DB round-trip per room (N+1 bug)."""
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    days = max((to_date - from_date).days, 1)

    # ── Fetch all active rooms in one query ───────────────────────────────
    rooms_result = await db.execute(
        select(Room, RoomType.name)
        .join(RoomType, RoomType.id == Room.room_type_id)
        .where(Room.hotel_id == hotel_id, Room.is_active.is_(True))
        .order_by(RoomType.name, Room.room_number)
    )
    room_rows = rooms_result.all()
    if not room_rows:
        return RoomUtilizationOut(
            from_date=from_date, to_date=to_date, items=[], by_room_type={}
        )

    room_ids = [r.id for r, _ in room_rows]

    # ── Fetch ALL overlapping bookings in a single query ──────────────────
    bookings_result = await db.execute(
        select(
            BookingRoom.room_id,
            Booking.check_in_date,
            Booking.check_out_date,
            Booking.total_amount,
            Booking.room_count,
        )
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.room_id.in_(room_ids),
            BookingRoom.is_current.is_(True),
            Booking.status.in_(("confirmed", "checked_in", "checked_out")),
            Booking.check_in_date < to_date,
            Booking.check_out_date > from_date,
        )
    )
    booking_rows = bookings_result.all()

    # ── Aggregate per room (pure Python — no extra round trips) ──────────
    from uuid import UUID as _UUID

    occupied_map: dict[_UUID, int] = {}
    revenue_map: dict[_UUID, Decimal] = {}
    for row in booking_rows:
        start = max(row.check_in_date, from_date)
        end = min(row.check_out_date, to_date)
        n = max((end - start).days, 0)
        room_id = row.room_id
        occupied_map[room_id] = occupied_map.get(room_id, 0) + n
        if row.room_count and row.room_count > 0:
            revenue_map[room_id] = revenue_map.get(room_id, Decimal("0")) + (
                Decimal(str(row.total_amount)) / Decimal(str(row.room_count))
            )

    rows: list[RoomUtilizationRowOut] = []
    by_type: dict[str, list[Decimal]] = {}
    for room, type_name in room_rows:
        occupied = occupied_map.get(room.id, 0)
        available = days
        pct = (
            money(Decimal(occupied) * Decimal("100") / Decimal(available))
            if available
            else Decimal("0.00")
        )
        rows.append(
            RoomUtilizationRowOut(
                room_number=room.room_number,
                room_type_name=type_name,
                floor=room.floor,
                occupied_nights=occupied,
                available_nights=available,
                occupancy_percent=pct,
                revenue=money(revenue_map.get(room.id, Decimal("0"))),
            )
        )
        by_type.setdefault(type_name, []).append(pct)

    by_room_type = {
        t_name: money(
            sum(pcts, Decimal("0.00")) / Decimal(len(pcts)) if pcts else Decimal("0.00")
        )
        for t_name, pcts in by_type.items()
    }

    # Sort by occupancy descending so the busiest rooms are first.
    rows.sort(key=lambda r: r.occupancy_percent, reverse=True)

    return RoomUtilizationOut(
        from_date=from_date,
        to_date=to_date,
        items=rows,
        by_room_type=by_room_type,
    )


async def gst_summary(
    db: AsyncSession, tenant: TenantContext, from_date: date, to_date: date
) -> GstReportOut:
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(Invoice.subtotal), 0),
                func.coalesce(func.sum(Invoice.cgst_amount), 0),
                func.coalesce(func.sum(Invoice.sgst_amount), 0),
                func.coalesce(func.sum(Invoice.igst_amount), 0),
                func.count(),
            ).where(
                Invoice.hotel_id == hotel_id,
                Invoice.status.in_(("generated", "partially_paid", "paid")),
                Invoice.invoice_date >= from_date,
                Invoice.invoice_date <= to_date,
            )
        )
    ).one()
    return GstReportOut(
        from_date=from_date,
        to_date=to_date,
        taxable=money(row[0]),
        cgst=money(row[1]),
        sgst=money(row[2]),
        igst=money(row[3]),
        invoice_count=int(row[4] or 0),
    )


# ── Dashboard trend endpoints ────────────────────────────────────────────────

async def daily_revenue_trend(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    days: int = 14,
) -> DailyTrendOut:
    """Per-day revenue + check-in/out counts for the past N days (hotel tz).

    Uses a LEFT JOIN against a generated series so every day in the window
    appears — even days with zero activity.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.models.booking import CheckIn, CheckOut

    hotel_id = tenant.require_hotel()
    days = max(1, min(days, 60))

    # Determine hotel timezone for date grouping.
    from app.models.hotel import Hotel
    hotel_tz_str: str = (
        await db.scalar(select(Hotel.timezone).where(Hotel.id == hotel_id))
    ) or "Asia/Kolkata"
    try:
        tz = ZoneInfo(hotel_tz_str)
    except (KeyError, ValueError):
        tz = ZoneInfo("Asia/Kolkata")

    # Window: today inclusive back N−1 days.
    today_local = datetime.now(tz).date()
    window_start = today_local - timedelta(days=days - 1)

    # Revenue per local day.
    rev_rows = (
        await db.execute(
            select(
                func.date(func.timezone(hotel_tz_str, Payment.paid_at)).label("d"),
                func.coalesce(func.sum(Payment.amount), 0).label("rev"),
            ).where(
                Payment.hotel_id == hotel_id,
                Payment.status == "completed",
                func.date(func.timezone(hotel_tz_str, Payment.paid_at)) >= window_start,
            ).group_by("d")
        )
    ).all()
    rev_by_date: dict[date, Decimal] = {r.d: money(r.rev) for r in rev_rows}

    # Check-ins per local day.
    ci_rows = (
        await db.execute(
            select(
                func.date(func.timezone(hotel_tz_str, CheckIn.checked_in_at)).label("d"),
                func.count().label("cnt"),
            ).where(
                CheckIn.hotel_id == hotel_id,
                func.date(func.timezone(hotel_tz_str, CheckIn.checked_in_at)) >= window_start,
            ).group_by("d")
        )
    ).all()
    ci_by_date: dict[date, int] = {r.d: int(r.cnt) for r in ci_rows}

    # Check-outs per local day.
    co_rows = (
        await db.execute(
            select(
                func.date(func.timezone(hotel_tz_str, CheckOut.checked_out_at)).label("d"),
                func.count().label("cnt"),
            ).where(
                CheckOut.hotel_id == hotel_id,
                func.date(func.timezone(hotel_tz_str, CheckOut.checked_out_at)) >= window_start,
            ).group_by("d")
        )
    ).all()
    co_by_date: dict[date, int] = {r.d: int(r.cnt) for r in co_rows}

    items: list[DailyTrendItem] = []
    for i in range(days):
        d = window_start + timedelta(days=i)
        items.append(
            DailyTrendItem(
                date=d,
                revenue=rev_by_date.get(d, Decimal("0.00")),
                checkins=ci_by_date.get(d, 0),
                checkouts=co_by_date.get(d, 0),
            )
        )
    return DailyTrendOut(
        items=items,
        total_revenue=money(sum(it.revenue for it in items)),
        total_checkins=sum(it.checkins for it in items),
        total_checkouts=sum(it.checkouts for it in items),
    )


async def arrivals_today(
    db: AsyncSession,
    tenant: TenantContext,
) -> ArrivalsOut:
    """Confirmed bookings with check_in_date = today (hotel tz), not yet checked in."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    hotel_id = tenant.require_hotel()
    from app.models.hotel import Hotel

    hotel_tz_str = (
        await db.scalar(select(Hotel.timezone).where(Hotel.id == hotel_id))
    ) or "Asia/Kolkata"
    try:
        tz = ZoneInfo(hotel_tz_str)
    except (KeyError, ValueError):
        tz = ZoneInfo("Asia/Kolkata")
    today_local = datetime.now(tz).date()

    rows = (
        await db.execute(
            select(Booking)
            .where(
                Booking.hotel_id == hotel_id,
                Booking.status == "confirmed",
                Booking.check_in_date == today_local,
            )
            .order_by(Booking.check_in_time.asc().nulls_last())
            .limit(20)
        )
    ).scalars().all()

    # Batch rooms.
    booking_ids = [b.id for b in rows]
    room_rows: list = []
    if booking_ids:
        from app.models.room import Room

        room_rows = (
            await db.execute(
                select(BookingRoom.booking_id, Room.room_number)
                .join(Room, Room.id == BookingRoom.room_id)
                .where(
                    BookingRoom.booking_id.in_(booking_ids),
                    BookingRoom.is_current.is_(True),
                )
            )
        ).all()  # type: ignore[assignment]
    rooms_by_booking: dict = {}
    for bk_id, rnum in room_rows:
        rooms_by_booking.setdefault(bk_id, []).append(rnum)

    # Batch guests.
    guest_ids = {b.primary_guest_id for b in rows if b.primary_guest_id}
    guests: dict = {}
    if guest_ids:
        guests = {
            g.id: g.full_name
            for g in (
                await db.execute(select(Guest).where(Guest.id.in_(guest_ids)))
            ).scalars().all()
        }

    items: list[ArrivalsItem] = [
        ArrivalsItem(
            booking_id=str(b.id),
            booking_number=b.booking_number,
            guest_name=guests.get(b.primary_guest_id, "—") if b.primary_guest_id else "—",
            rooms=rooms_by_booking.get(b.id, []),
            check_in_time=b.check_in_time,
            advance_paid=b.advance_amount,
            due_amount=b.due_amount,
        )
        for b in rows
    ]
    return ArrivalsOut(items=items, total=len(items))


async def platform_monthly_trend(
    db: AsyncSession,
    *,
    months: int = 6,
) -> PlatformTrendOut:
    """Per-month hotel additions + check-ins + revenue for the super-admin
    dashboard.  Replaced the previous N-queries loop (72 round-trips at
    months=24) with 3 aggregated GROUP-BY queries — one per metric.
    """
    import calendar
    from datetime import date as _date
    from datetime import datetime

    from sqlalchemy import text

    from app.models.booking import CheckIn
    from app.models.hotel import Hotel
    from app.models.payment import Payment

    months = max(1, min(months, 24))
    now = datetime.now()

    # Build the window list (YYYY-MM strings, oldest → newest).
    window: list[tuple[str, _date, _date]] = []
    for i in range(months - 1, -1, -1):
        y, m = now.year, now.month - i
        while m <= 0:
            m += 12
            y -= 1
        start = _date(y, m, 1)
        end = _date(y, m, calendar.monthrange(y, m)[1])
        window.append((f"{y:04d}-{m:02d}", start, end))

    oldest_start = window[0][1]
    newest_end = window[-1][2]

    # ── 3 batch queries — one per metric ─────────────────────────────────
    # Hotels added per month (group by first day of month of created_at)
    hotel_rows = (
        await db.execute(
            select(
                func.to_char(func.date_trunc("month", Hotel.created_at), "YYYY-MM").label("m"),
                func.count().label("n"),
            )
            .where(
                func.date(Hotel.created_at) >= oldest_start,
                func.date(Hotel.created_at) <= newest_end,
            )
            .group_by(text("1"))
        )
    ).all()
    hotels_by_month = {r.m: int(r.n) for r in hotel_rows}

    # Revenue per month
    rev_rows = (
        await db.execute(
            select(
                func.to_char(func.date_trunc("month", Payment.paid_at), "YYYY-MM").label("m"),
                func.coalesce(func.sum(Payment.amount), 0).label("total"),
            )
            .where(
                Payment.status == "completed",
                func.date(Payment.paid_at) >= oldest_start,
                func.date(Payment.paid_at) <= newest_end,
            )
            .group_by(text("1"))
        )
    ).all()
    rev_by_month = {r.m: money(Decimal(str(r.total))) for r in rev_rows}

    # Check-ins per month
    ci_rows = (
        await db.execute(
            select(
                func.to_char(func.date_trunc("month", CheckIn.checked_in_at), "YYYY-MM").label("m"),
                func.count().label("n"),
            )
            .where(
                func.date(CheckIn.checked_in_at) >= oldest_start,
                func.date(CheckIn.checked_in_at) <= newest_end,
            )
            .group_by(text("1"))
        )
    ).all()
    ci_by_month = {r.m: int(r.n) for r in ci_rows}

    items = [
        MonthlyTrendItem(
            month=month_str,
            hotels_added=hotels_by_month.get(month_str, 0),
            revenue=rev_by_month.get(month_str, Decimal("0")),
            checkins=ci_by_month.get(month_str, 0),
        )
        for month_str, _, _ in window
    ]
    return PlatformTrendOut(items=items)


# ── Smart Dashboard (single comprehensive endpoint) ───────────────────────────

async def smart_dashboard(
    db: AsyncSession,
    tenant: TenantContext,
) -> SmartDashboardOut:
    """Return KPIs, trends, mix, and rule-generated insights in one call.

    All data covers the trailing 30 days (and today separately for KPIs),
    using the hotel's local timezone for date grouping so "today" is always
    the hotel's calendar today, not UTC today.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.models.booking import CheckIn, CheckOut
    from app.models.hotel import Hotel

    hotel_id = tenant.require_hotel()

    # ── Hotel metadata ──────────────────────────────────────────────────────
    hotel = (await db.execute(select(Hotel).where(Hotel.id == hotel_id))).scalar_one()
    hotel_tz_str = hotel.timezone or "Asia/Kolkata"
    try:
        tz = ZoneInfo(hotel_tz_str)
    except (KeyError, ValueError):
        tz = ZoneInfo("Asia/Kolkata")
    now_local = datetime.now(tz)
    today = now_local.date()
    window_start = today - timedelta(days=29)       # 30-day window
    prev_window_start = window_start - timedelta(days=30)   # prior 30 days for WoW

    def local_date(col):  # type: ignore[no-untyped-def]
        return func.date(func.timezone(hotel_tz_str, col))

    # ── Total rooms ─────────────────────────────────────────────────────────
    total_rooms = int(await db.scalar(
        select(func.count()).select_from(Room).where(
            Room.hotel_id == hotel_id, Room.is_active.is_(True)
        )
    ) or 0)

    # ── Room status counts (live) ───────────────────────────────────────────
    status_rows = (await db.execute(
        select(Room.status, func.count().label("cnt")).where(
            Room.hotel_id == hotel_id, Room.is_active.is_(True)
        ).group_by(Room.status)
    )).all()
    status_counts: dict[str, int] = {r.status: int(r.cnt) for r in status_rows}
    available_rooms = (status_counts.get("available", 0) + status_counts.get("clean_ready", 0))
    occupied_rooms = status_counts.get("occupied", 0)
    today_occ_pct = money(
        Decimal(occupied_rooms) * 100 / Decimal(total_rooms)
        if total_rooms else Decimal("0")
    )

    # ── In-house count ──────────────────────────────────────────────────────
    in_house_count = int(await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id, Booking.status == "checked_in"
        )
    ) or 0)

    # ── Arrivals today (confirmed, not yet checked in) ──────────────────────
    arrivals_today_count = int(await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id,
            Booking.status == "confirmed",
            Booking.check_in_date == today,
        )
    ) or 0)

    # ── Overdue checkouts ───────────────────────────────────────────────────
    overdue_count = int(await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id,
            Booking.status == "checked_in",
            Booking.check_out_date < today,
        )
    ) or 0)

    # ── 30-day daily revenue + check-ins/outs ───────────────────────────────
    rev_rows = (await db.execute(
        select(
            local_date(Payment.paid_at).label("d"),
            func.sum(Payment.amount).label("rev"),
        ).where(
            Payment.hotel_id == hotel_id,
            Payment.status == "completed",
            local_date(Payment.paid_at) >= window_start,
        ).group_by("d")
    )).all()
    rev_by_date: dict[date, Decimal] = {r.d: money(r.rev) for r in rev_rows}

    ci_rows = (await db.execute(
        select(
            local_date(CheckIn.checked_in_at).label("d"),
            func.count().label("cnt"),
        ).where(
            CheckIn.hotel_id == hotel_id,
            local_date(CheckIn.checked_in_at) >= window_start,
        ).group_by("d")
    )).all()
    ci_by_date: dict[date, int] = {r.d: int(r.cnt) for r in ci_rows}

    co_rows = (await db.execute(
        select(
            local_date(CheckOut.checked_out_at).label("d"),
            func.count().label("cnt"),
        ).where(
            CheckOut.hotel_id == hotel_id,
            local_date(CheckOut.checked_out_at) >= window_start,
        ).group_by("d")
    )).all()
    co_by_date: dict[date, int] = {r.d: int(r.cnt) for r in co_rows}

    # ── Nightly occupancy (bookings overlapping each day) ───────────────────
    # We approximate: for each booking that overlaps the window, mark each
    # night it spans. This is O(bookings × nights) but the 30-day window keeps it small.
    bookings_in_window = (await db.execute(
        select(
            Booking.check_in_date, Booking.check_out_date, Booking.room_count,
            Booking.total_amount, Booking.guest_type, Booking.created_at,
        ).where(
            Booking.hotel_id == hotel_id,
            Booking.status.in_(("confirmed", "checked_in", "checked_out")),
            Booking.check_in_date < today + timedelta(days=1),
            Booking.check_out_date > window_start,
        )
    )).all()

    occ_by_date: dict[date, int] = {}
    for bk in bookings_in_window:
        start = max(bk.check_in_date, window_start)
        end = min(bk.check_out_date, today + timedelta(days=1))
        d = start
        while d < end:
            occ_by_date[d] = occ_by_date.get(d, 0) + max(bk.room_count, 1)
            d += timedelta(days=1)

    trend_30d: list[TrendPoint30] = []
    for i in range(30):
        d = window_start + timedelta(days=i)
        occ = occ_by_date.get(d, 0)
        # Cap at 100 — occ_by_date sums Booking.room_count which in rare
        # edge-cases can exceed total_rooms (e.g. mid-day overlaps or data
        # corrections). A chart > 100% is misleading.
        raw_pct = Decimal(occ) * 100 / Decimal(total_rooms) if total_rooms else Decimal("0")
        occ_pct = money(min(raw_pct, Decimal("100")))
        trend_30d.append(TrendPoint30(
            date=d,
            revenue=rev_by_date.get(d, Decimal("0")),
            checkins=ci_by_date.get(d, 0),
            checkouts=co_by_date.get(d, 0),
            occupancy_pct=occ_pct,
        ))

    # ── KPIs: 30-day window ─────────────────────────────────────────────────
    total_rev_30 = money(sum(it.revenue for it in trend_30d))

    # ADR (Average Daily Rate) = billed revenue / room-nights occupied.
    # We use Booking.total_amount (billed, not collected) so the rate reflects
    # what guests were charged per room-night — consistent with industry ADR.
    # Room-nights = Booking.room_count × nights within window (not just room_count).
    total_billed_30 = money(sum(
        b.total_amount
        for b in bookings_in_window
        if b.check_out_date > b.check_in_date
    ))
    total_occ_nights = sum(
        max(b.room_count, 1) * max((
            min(b.check_out_date, today) - max(b.check_in_date, window_start)
        ).days, 0)
        for b in bookings_in_window
    )
    adr = money(total_billed_30 / Decimal(total_occ_nights) if total_occ_nights else Decimal("0"))

    # RevPAR: revenue / (total_rooms × 30 days)
    revpar = money(total_rev_30 / Decimal(total_rooms * 30) if total_rooms else Decimal("0"))

    # ALOS: average length of stay for checked-out bookings this window.
    # BUG-FIX: EXTRACT(day FROM AGE(date, date)) extracts only the "day"
    # component of a year-month-day interval, which is 0 for stays that span
    # a full calendar month (e.g. Jan 15 → Mar 15 = "2 mons 0 days" → day=0).
    # Correct approach: subtract the two DATE values directly — PostgreSQL
    # returns an INTEGER (total calendar days) when subtracting dates.
    alos_rows = (await db.execute(
        select(
            func.avg(
                Booking.check_out_date - Booking.check_in_date
            ).label("alos")
        ).where(
            Booking.hotel_id == hotel_id,
            Booking.status == "checked_out",
            Booking.check_out_date >= window_start,
        )
    )).scalar_one()
    alos = money(Decimal(str(alos_rows or "0")))

    # Average booking lead time (days between booking creation and check-in).
    # Same fix: use date subtraction, not EXTRACT(day FROM AGE(...)).
    lead_rows = (await db.execute(
        select(
            func.avg(
                Booking.check_in_date - func.date(Booking.created_at)
            ).label("lead")
        ).where(
            Booking.hotel_id == hotel_id,
            Booking.check_in_date >= window_start,
            Booking.status.notin_(("cancelled",)),
        )
    )).scalar_one()
    lead_days = money(Decimal(str(lead_rows or "0")))

    # No-show rate
    no_show_count = int(await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id,
            Booking.status == "no_show",
            Booking.check_in_date >= window_start,
        )
    ) or 0)
    confirmed_plus_ns = int(await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id,
            Booking.status.in_(("no_show", "checked_in", "checked_out", "confirmed")),
            Booking.check_in_date >= window_start,
        )
    ) or 0)
    no_show_rate = money(
        Decimal(no_show_count) * 100 / Decimal(confirmed_plus_ns)
        if confirmed_plus_ns else Decimal("0")
    )

    # WoW: prior 30-day window revenue for RevPAR comparison.
    # prior_occ_nights_q removed — was computed but never used.
    prior_rev = money(await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.hotel_id == hotel_id,
            Payment.status == "completed",
            local_date(Payment.paid_at) >= prev_window_start,
            local_date(Payment.paid_at) < window_start,
        )
    ) or 0)
    prior_revpar = money(
        Decimal(str(prior_rev)) / Decimal(total_rooms * 30) if total_rooms else Decimal("0")
    )
    revenue_wow = money(
        (total_rev_30 - prior_rev) * 100 / prior_rev if prior_rev else Decimal("0")
    )
    revpar_wow = money(
        (revpar - prior_revpar) * 100 / prior_revpar if prior_revpar else Decimal("0")
    )

    kpis = HotelKpis(
        revpar=revpar,
        adr=adr,
        alos=alos,
        lead_days=lead_days,
        no_show_rate=no_show_rate,
        revpar_wow=revpar_wow,
        revenue_wow=revenue_wow,
    )

    # ── Guest mix (30 days) ─────────────────────────────────────────────────
    # BUG-FIX: include only checked_in and checked_out bookings (actual guests
    # who stayed or are staying). Including "confirmed" future bookings inflates
    # the counts and skews the mix chart with guests who haven't arrived yet.
    mix_rows = (await db.execute(
        select(
            func.coalesce(Booking.guest_type, "other").label("gt"),
            func.count().label("cnt"),
            func.coalesce(func.sum(Booking.total_amount), 0).label("rev"),
        ).where(
            Booking.hotel_id == hotel_id,
            Booking.status.in_(("checked_in", "checked_out")),
            Booking.check_in_date >= window_start,
        ).group_by("gt").order_by(func.count().desc())
    )).all()
    guest_mix = [
        GuestMixItem(guest_type=r.gt or "other", count=int(r.cnt), revenue=money(r.rev))
        for r in mix_rows
    ]

    # ── Room-type revenue (30 days) ─────────────────────────────────────────
    # BUG-FIX: room_nights must be room_count × stay_length, not just SUM(room_count).
    # A 2-room 3-night booking contributes 6 room-nights, not 2.
    # PostgreSQL: DATE - DATE returns INTEGER (days), so room_count * (checkout - checkin)
    # gives the correct room-night count per booking.
    rt_rows = (await db.execute(
        select(
            RoomType.name.label("rt_name"),
            func.coalesce(func.sum(Booking.total_amount), 0).label("rev"),
            func.coalesce(
                func.sum(
                    Booking.room_count * (Booking.check_out_date - Booking.check_in_date)
                ), 0
            ).label("room_nights"),
        )
        .join(BookingRoom, BookingRoom.booking_id == Booking.id)
        .join(RoomType, RoomType.id == BookingRoom.room_type_id)
        .where(
            Booking.hotel_id == hotel_id,
            Booking.status.in_(("checked_in", "checked_out")),
            Booking.check_in_date >= window_start,
        ).group_by(RoomType.name).order_by(func.sum(Booking.total_amount).desc())
    )).all()
    room_type_revenue = [
        RoomTypeRevenue(
            room_type=r.rt_name,
            revenue=money(r.rev),
            room_nights=max(int(r.room_nights), 0),
            adr=money(
                Decimal(str(r.rev)) / Decimal(str(r.room_nights))
                if r.room_nights and int(r.room_nights) > 0
                else Decimal("0")
            ),
        )
        for r in rt_rows
    ]

    # ── Week pattern: avg check-ins + revenue by day-of-week ────────────────
    dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    # PostgreSQL EXTRACT(DOW, ...) = 0=Sunday … 6=Saturday; remap to 0=Mon…6=Sun
    # (use ISODOW: 1=Mon … 7=Sun)
    dow_rev_rows = (await db.execute(
        select(
            func.extract("isodow", local_date(Payment.paid_at)).label("dow"),
            func.coalesce(func.sum(Payment.amount), 0).label("rev"),
            func.count().label("cnt"),
        ).where(
            Payment.hotel_id == hotel_id,
            Payment.status == "completed",
            local_date(Payment.paid_at) >= window_start,
        ).group_by("dow").order_by("dow")
    )).all()
    dow_ci_rows = (await db.execute(
        select(
            func.extract("isodow", local_date(CheckIn.checked_in_at)).label("dow"),
            func.count().label("cnt"),
        ).where(
            CheckIn.hotel_id == hotel_id,
            local_date(CheckIn.checked_in_at) >= window_start,
        ).group_by("dow").order_by("dow")
    )).all()

    # Build lookup: isodow (1–7) → (total_rev, cnt_weeks)
    # 30 days / 7 = ~4 occurrences per weekday
    weeks_in_window = max(1, 30 // 7)
    rev_by_dow: dict[int, Decimal] = {}
    for r in dow_rev_rows:
        rev_by_dow[int(r.dow)] = money(Decimal(str(r.rev)) / Decimal(weeks_in_window))
    ci_by_dow_raw: list = list(dow_ci_rows)  # type: ignore[assignment]
    ci_by_dow: dict[int, int] = {}
    for r in ci_by_dow_raw:
        ci_by_dow[int(r.dow)] = int(round(int(r.cnt) / weeks_in_window))

    week_pattern = [
        WeekPatternItem(
            dow=dow_names[i],
            avg_revenue=rev_by_dow.get(i + 1, Decimal("0")),
            avg_checkins=Decimal(ci_by_dow.get(i + 1, 0)),
        )
        for i in range(7)
    ]

    # ── Smart Insights (rule-based NLG) ─────────────────────────────────────
    insights: list[SmartInsight] = []

    # Today's revenue
    today_rev = rev_by_date.get(today, Decimal("0"))
    week_avg_rev = money(
        sum(rev_by_date.get(today - timedelta(days=i), Decimal("0")) for i in range(1, 8))
        / Decimal(7)
    )

    if today_rev > 0:
        if week_avg_rev > 0:
            pct_vs_avg = int((today_rev - week_avg_rev) * 100 / week_avg_rev)
            if pct_vs_avg >= 20:
                insights.append(SmartInsight(
                    id="rev_above_avg",
                    level="success",
                    icon="TrendingUp",
                    title="Strong Revenue Day",
                    body=(
                        f"Today's revenue of ₹{int(today_rev):,} is {pct_vs_avg}% above "
                        f"your 7-day average (₹{int(week_avg_rev):,}). Great momentum!"
                    ),
                    metric=f"₹{int(today_rev):,}",
                    link="/payments",
                ))
            elif pct_vs_avg <= -25:
                insights.append(SmartInsight(
                    id="rev_below_avg",
                    level="warning",
                    icon="TrendingDown",
                    title="Below Average Revenue",
                    body=(
                        f"Today's revenue (₹{int(today_rev):,}) is {abs(pct_vs_avg)}% below "
                        f"your 7-day average of ₹{int(week_avg_rev):,}."
                    ),
                    metric=f"₹{int(today_rev):,}",
                    link="/payments",
                ))

    # Revenue 3-day trend
    day1 = rev_by_date.get(today, Decimal("0"))
    day2 = rev_by_date.get(today - timedelta(days=1), Decimal("0"))
    day3 = rev_by_date.get(today - timedelta(days=2), Decimal("0"))
    if day1 > day2 > day3 > 0:
        insights.append(SmartInsight(
            id="rev_3day_growth",
            level="success",
            icon="TrendingUp",
            title="Revenue Growing",
            body="Revenue has grown for 3 consecutive days — a positive demand signal.",
        ))

    # Overdue checkouts
    if overdue_count > 0:
        insights.append(SmartInsight(
            id="overdue_checkouts",
            level="alert",
            icon="AlertTriangle",
            title=f"{overdue_count} Overdue Checkout{'s' if overdue_count > 1 else ''}",
            body=(
                f"{overdue_count} guest(s) are past their checkout time. "
                "Reach out to confirm late departure or start checkout."
            ),
            link="/current-guests",
        ))

    # Low room availability vs arrivals
    if total_rooms > 0:
        avail_pct = int(available_rooms * 100 / total_rooms)
        if avail_pct < 20 and arrivals_today_count > available_rooms:
            insights.append(SmartInsight(
                id="low_avail_vs_arrivals",
                level="alert",
                icon="AlertOctagon",
                title="Room Availability Conflict",
                body=(
                    f"Only {available_rooms} room(s) available, but {arrivals_today_count} "
                    "guest(s) arriving today. Check housekeeping status immediately."
                ),
                metric=f"{avail_pct}% available",
                link="/rooms",
            ))
        elif avail_pct < 15:
            insights.append(SmartInsight(
                id="low_avail",
                level="warning",
                icon="BedDouble",
                title="Low Availability",
                body=(
                    f"Only {available_rooms} of {total_rooms} rooms available ({avail_pct}%). "
                    "Consider whether any rooms can be expedited from housekeeping."
                ),
                metric=f"{avail_pct}% free",
                link="/rooms",
            ))

    # Arrivals today reminder
    if arrivals_today_count > 0:
        insights.append(SmartInsight(
            id="arrivals_reminder",
            level="info",
            icon="CalendarCheck",
            title=f"{arrivals_today_count} Arriving Today",
            body=(
                f"{arrivals_today_count} confirmed guest(s) expected today. "
                "Ensure rooms are ready and IDs are verified at check-in."
            ),
            link="/checkin",
        ))

    # High occupancy
    if today_occ_pct >= 90:
        insights.append(SmartInsight(
            id="high_occupancy",
            level="success",
            icon="Building2",
            title="Near Full Capacity",
            body=(
                f"Running at {int(today_occ_pct)}% occupancy — outstanding! "
                "Ensure housekeeping is on standby for quick turnovers."
            ),
            metric=f"{int(today_occ_pct)}%",
        ))

    # No-show warning
    if no_show_rate > 10:
        insights.append(SmartInsight(
            id="high_noshow",
            level="warning",
            icon="UserX",
            title="High No-Show Rate",
            body=(
                f"{int(no_show_rate)}% of bookings in the last 30 days were no-shows. "
                "Consider requesting advance payments to reduce no-shows."
            ),
            metric=f"{int(no_show_rate)}%",
        ))

    # RevPAR insight
    if revpar > 0:
        wow_str = ""
        if revpar_wow > 5:
            wow_str = f" — up {int(revpar_wow)}% vs prior period"
        elif revpar_wow < -5:
            wow_str = f" — down {abs(int(revpar_wow))}% vs prior period"
        insights.append(SmartInsight(
            id="revpar",
            level="info" if abs(revpar_wow) <= 5 else ("success" if revpar_wow > 0 else "warning"),
            icon="IndianRupee",
            title="RevPAR",
            body=f"Revenue per available room over 30 days is ₹{int(revpar):,}{wow_str}.",
            metric=f"₹{int(revpar):,}",
        ))

    # ALOS insight
    if alos >= 3:
        insights.append(SmartInsight(
            id="alos_long",
            level="success",
            icon="CalendarDays",
            title="Long Average Stay",
            body=(
                f"Guests are staying an average of {float(alos):.1f} nights"
                " — strong occupancy per booking."
            ),
            metric=f"{float(alos):.1f} nights",
        ))
    elif alos > 0 and alos < 1.5:
        insights.append(SmartInsight(
            id="alos_short",
            level="info",
            icon="CalendarDays",
            title="Short Average Stay",
            body=(
                f"Average stay is {float(alos):.1f} nights. Promoting multi-night packages "
                "or weekend deals could boost revenue."
            ),
            metric=f"{float(alos):.1f} nights",
        ))

    # Sort: alerts first, then warnings, success, info
    _level_order = {"alert": 0, "warning": 1, "success": 2, "info": 3}
    insights.sort(key=lambda x: _level_order.get(x.level, 4))

    return SmartDashboardOut(
        insights=insights,
        kpis=kpis,
        trend_30d=trend_30d,
        guest_mix=guest_mix,
        room_type_revenue=room_type_revenue,
        week_pattern=week_pattern,
        today_occupancy_pct=today_occ_pct,
        total_rooms=total_rooms,
        available_rooms=available_rooms,
        in_house_count=in_house_count,
        arrivals_today=arrivals_today_count,
        overdue_count=overdue_count,
    )
