from __future__ import annotations

from datetime import date
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
    ExpenseReportOut,
    GstBookingRowOut,
    GstByBookingOut,
    GstReportOut,
    OccupancyReportOut,
    PaymentMethodReportOut,
    RestaurantBillingOut,
    RestaurantBillingRowOut,
    RevenueReportOut,
    RoomUtilizationOut,
    RoomUtilizationRowOut,
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
        end = min(booking.check_out_date, to_date)
        nights = max((end - start).days, 0)
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
    room_rev = money(
        await db.scalar(
            select(func.coalesce(func.sum(Booking.total_amount), 0)).where(
                Booking.hotel_id == hotel_id,
                Booking.status.in_(("checked_in", "checked_out")),
                Booking.check_in_date >= from_date,
                Booking.check_in_date <= to_date,
            )
        )
        or 0
    )
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
    total = money(room_rev + charge_rev)
    return RevenueReportOut(
        from_date=from_date,
        to_date=to_date,
        room_revenue=room_rev,
        charge_revenue=charge_rev,
        total_revenue=total,
        refunds=refunds,
        net_revenue=money(total - refunds),
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
                charged_on=charge.created_at.date(),
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
    hotel_id = tenant.require_hotel()
    from_date, to_date = _range(from_date, to_date)
    days = max((to_date - from_date).days, 1)

    rooms_result = await db.execute(
        select(Room, RoomType.name)
        .join(RoomType, RoomType.id == Room.room_type_id)
        .where(Room.hotel_id == hotel_id, Room.is_active.is_(True))
        .order_by(RoomType.name, Room.room_number)
    )
    room_rows = rooms_result.all()

    rows: list[RoomUtilizationRowOut] = []
    by_type: dict[str, list[Decimal]] = {}

    for room, type_name in room_rows:
        bookings = (
            await db.execute(
                select(Booking)
                .join(BookingRoom, BookingRoom.booking_id == Booking.id)
                .where(
                    BookingRoom.room_id == room.id,
                    BookingRoom.is_current.is_(True),
                    Booking.status.in_(("confirmed", "checked_in", "checked_out")),
                    Booking.check_in_date < to_date,
                    Booking.check_out_date > from_date,
                )
            )
        ).scalars().all()

        occupied = 0
        room_revenue = Decimal("0.00")
        for booking in bookings:
            start = max(booking.check_in_date, from_date)
            end = min(booking.check_out_date, to_date)
            n = max((end - start).days, 0)
            occupied += n
            if booking.room_count > 0:
                room_revenue += booking.total_amount / booking.room_count

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
                revenue=money(room_revenue),
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
