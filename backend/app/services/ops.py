from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.core.tenant import TenantContext
from app.domain.gst import money
from app.models.booking import Booking, CheckIn, CheckOut
from app.models.expense import Expense
from app.models.hotel import Hotel
from app.models.ops import DailyClosing, ShiftHandover
from app.models.payment import GuestBookingLedger, Payment, Refund
from app.models.room import Room
from app.schemas.ops import DailyClosingClose, DailyClosingReopen, ShiftHandoverCreate
from app.services.audit import write_audit


def _now() -> datetime:
    return datetime.now(UTC)


async def _hotel_tz(db: AsyncSession, hotel_id: UUID) -> str:
    """Return the hotel's IANA timezone string (default Asia/Kolkata)."""
    tz = (
        await db.execute(select(Hotel.timezone).where(Hotel.id == hotel_id))
    ).scalar_one_or_none()
    return tz or "Asia/Kolkata"


async def _snapshot(db: AsyncSession, hotel_id: UUID, business_date: date) -> dict:
    """Build a consistent point-in-time snapshot for a business date.

    IMPORTANT design decisions (audit-driven):
    - All timestamps are converted to the HOTEL's local timezone before date
      comparison so "today" means today for IST hotels, not UTC midnight.
    - Cash/UPI collected = payments that arrived on this local business date.
    - Total revenue = ALL completed payment methods (not just cash+UPI).
    - Checkout overpayment refunds are summed from the ledger (reference_type =
      'checkout_refund') because they never create a Refund-table row.
    - API Refund rows (manual refunds) are also summed separately.
    - cash_balance = cash collected − cash expenses − cash refunds out.
    """
    hotel_tz = await _hotel_tz(db, hotel_id)

    def _local_date(col):
        return func.date(func.timezone(literal(hotel_tz), col))

    checkins = await db.scalar(
        select(func.count()).select_from(CheckIn).where(
            CheckIn.hotel_id == hotel_id,
            _local_date(CheckIn.checked_in_at) == business_date,
        )
    )
    checkouts = await db.scalar(
        select(func.count()).select_from(CheckOut).where(
            CheckOut.hotel_id == hotel_id,
            _local_date(CheckOut.checked_out_at) == business_date,
            CheckOut.is_reversed.is_(False),
        )
    )
    current_guests = await db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.hotel_id == hotel_id, Booking.status == "checked_in"
        )
    )
    total_rooms = await db.scalar(
        select(func.count()).select_from(Room).where(
            Room.hotel_id == hotel_id, Room.is_active.is_(True)
        )
    )
    occupied = await db.scalar(
        select(func.count()).select_from(Room).where(
            Room.hotel_id == hotel_id, Room.status == "occupied"
        )
    )
    # Cash payments (local business date)
    cash = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.hotel_id == hotel_id,
            Payment.method == "cash",
            Payment.status == "completed",
            _local_date(Payment.paid_at) == business_date,
        )
    )
    # UPI payments (local business date)
    upi = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.hotel_id == hotel_id,
            Payment.method == "upi",
            Payment.status == "completed",
            _local_date(Payment.paid_at) == business_date,
        )
    )
    # All collected methods → total_revenue
    all_collected = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.hotel_id == hotel_id,
            Payment.status == "completed",
            _local_date(Payment.paid_at) == business_date,
        )
    )
    # API Refund rows (manual/booking refunds, local date)
    api_refunds = await db.scalar(
        select(func.coalesce(func.sum(Refund.amount), 0)).where(
            Refund.hotel_id == hotel_id,
            Refund.status == "completed",
            _local_date(Refund.refunded_at) == business_date,
        )
    )
    # Checkout overpayment refunds (ledger-only, never hit Refund table)
    checkout_refunds = await db.scalar(
        select(func.coalesce(func.sum(GuestBookingLedger.amount), 0)).where(
            GuestBookingLedger.hotel_id == hotel_id,
            GuestBookingLedger.reference_type == "checkout_refund",
            _local_date(GuestBookingLedger.created_at) == business_date,
        )
    )
    expenses = await db.scalar(
        select(func.coalesce(func.sum(Expense.amount), 0)).where(
            Expense.hotel_id == hotel_id,
            Expense.status == "paid",
            # Expense date is already a calendar date — compare directly.
            Expense.expense_date == business_date,
        )
    )
    dues = await db.scalar(
        select(func.coalesce(func.sum(Booking.due_amount), 0)).where(
            Booking.hotel_id == hotel_id,
            Booking.status.in_(("checked_in", "checked_out")),
            Booking.due_amount > 0,
        )
    )
    total_rooms_n = int(total_rooms or 0)
    occupied_n = int(occupied or 0)
    occupancy = (
        money(Decimal(occupied_n) * Decimal("100") / Decimal(total_rooms_n))
        if total_rooms_n
        else Decimal("0")
    )
    cash_d = money(cash or 0)
    upi_d = money(upi or 0)
    revenue_d = money(all_collected or 0)
    refunds_d = money((api_refunds or 0) + (checkout_refunds or 0))
    expenses_d = money(expenses or 0)
    return {
        "checkins_count": int(checkins or 0),
        "checkouts_count": int(checkouts or 0),
        "current_guests_count": int(current_guests or 0),
        "occupancy_percent": occupancy,
        "cash_collected": cash_d,
        "upi_collected": upi_d,
        "total_revenue": revenue_d,
        "total_expenses": expenses_d,
        "refunds_total": refunds_d,
        "dues_total": money(dues or 0),
        "cash_balance": money(cash_d - expenses_d - refunds_d),
    }


def _apply_snapshot(row: DailyClosing, snap: dict) -> None:
    for key, value in snap.items():
        setattr(row, key, value)
    row.snapshot = {k: str(v) if isinstance(v, Decimal) else v for k, v in snap.items()}


async def get_or_open_day(
    db: AsyncSession, tenant: TenantContext, business_date: date | None = None
) -> DailyClosing:
    hotel_id = tenant.require_hotel()
    if business_date is None:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo

        tz_str = await _hotel_tz(db, hotel_id)
        try:
            day = _dt.now(ZoneInfo(tz_str)).date()
        except Exception:
            day = _dt.now(UTC).date()
    else:
        day = business_date
    result = await db.execute(
        select(DailyClosing).where(
            DailyClosing.hotel_id == hotel_id, DailyClosing.business_date == day
        )
    )
    row = result.scalar_one_or_none()
    snap = await _snapshot(db, hotel_id, day)
    if row is None:
        row = DailyClosing(hotel_id=hotel_id, business_date=day, status="open")
        db.add(row)
        await db.flush()
    if row.status == "open":
        _apply_snapshot(row, snap)
        await db.flush()
    return row


async def close_day(
    db: AsyncSession,
    tenant: TenantContext,
    business_date: date,
    body: DailyClosingClose,
    *,
    correlation_id: str | None = None,
) -> DailyClosing:
    row = await get_or_open_day(db, tenant, business_date)
    if row.status == "closed":
        raise ConflictError("Day is already closed", code="day_already_closed")
    snap = await _snapshot(db, tenant.require_hotel(), business_date)
    _apply_snapshot(row, snap)
    if body.cash_balance is not None:
        row.cash_balance = money(body.cash_balance)
    row.notes = body.notes
    row.status = "closed"
    row.closed_by_id = tenant.user_id
    row.closed_at = _now()
    await db.flush()
    await write_audit(
        db,
        action="ops.day_closed",
        entity_type="daily_closing",
        entity_id=row.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.require_hotel(),
        after={"business_date": str(business_date), "cash": str(row.cash_collected)},
        correlation_id=correlation_id,
    )
    return row


async def reopen_day(
    db: AsyncSession,
    tenant: TenantContext,
    closing_id: UUID,
    body: DailyClosingReopen,
    *,
    correlation_id: str | None = None,
) -> DailyClosing:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(DailyClosing).where(
            DailyClosing.id == closing_id, DailyClosing.hotel_id == hotel_id
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise NotFoundError("Daily closing not found")
    if row.status != "closed":
        raise ConflictError("Day is not closed", code="day_not_closed")
    row.status = "open"
    row.reopened_at = _now()
    row.reopen_reason = body.reason
    await db.flush()
    await write_audit(
        db,
        action="ops.day_reopened",
        entity_type="daily_closing",
        entity_id=row.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"reason": body.reason},
        correlation_id=correlation_id,
    )
    return row


async def list_closings(db: AsyncSession, tenant: TenantContext) -> list[DailyClosing]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(DailyClosing)
        .where(DailyClosing.hotel_id == hotel_id)
        .order_by(DailyClosing.business_date.desc())
        .limit(60)
    )
    return list(result.scalars().all())


async def create_handover(
    db: AsyncSession,
    tenant: TenantContext,
    body: ShiftHandoverCreate,
    *,
    correlation_id: str | None = None,
) -> ShiftHandover:
    hotel_id = tenant.require_hotel()
    snap = await _snapshot(db, hotel_id, date.today())
    row = ShiftHandover(
        hotel_id=hotel_id,
        from_user_id=tenant.user_id,
        to_user_id=body.to_user_id,
        opening_cash=money(body.opening_cash),
        closing_cash=money(body.closing_cash),
        payments_collected=snap["total_revenue"],
        pending_payments=snap["dues_total"],
        notes=body.notes,
        room_issues=body.room_issues,
        pending_issues=body.pending_issues,
        snapshot={k: str(v) if isinstance(v, Decimal) else v for k, v in snap.items()},
    )
    db.add(row)
    await db.flush()
    await write_audit(
        db,
        action="ops.handover_created",
        entity_type="shift_handover",
        entity_id=row.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        correlation_id=correlation_id,
    )
    return row


async def confirm_handover(
    db: AsyncSession,
    tenant: TenantContext,
    handover_id: UUID,
    *,
    correlation_id: str | None = None,
) -> ShiftHandover:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(ShiftHandover).where(
            ShiftHandover.id == handover_id, ShiftHandover.hotel_id == hotel_id
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise NotFoundError("Handover not found")
    row.confirmed = True
    row.confirmed_at = _now()
    if row.to_user_id is None:
        row.to_user_id = tenant.user_id
    await db.flush()
    await write_audit(
        db,
        action="ops.handover_confirmed",
        entity_type="shift_handover",
        entity_id=row.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        correlation_id=correlation_id,
    )
    return row


async def list_handovers(db: AsyncSession, tenant: TenantContext) -> list[ShiftHandover]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(ShiftHandover)
        .where(ShiftHandover.hotel_id == hotel_id)
        .order_by(ShiftHandover.created_at.desc())
        .limit(50)
    )
    return list(result.scalars().all())
