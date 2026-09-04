from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import money
from app.domain.room_status import RoomStatus, is_allocatable
from app.models.booking import Booking, BookingRoom
from app.models.guest import Guest
from app.models.hotel import HotelSettings
from app.models.room import Room
from app.schemas.booking import (
    BookingCreate,
    BookingOut,
    BookingRoomOut,
    BookingUpdate,
)
from app.services.audit import write_audit
from app.services.guests import get_guest

ACTIVE_BOOKING_STATUSES = ("pending", "confirmed", "checked_in")


async def next_booking_number(db: AsyncSession, hotel_id: UUID) -> str:
    """Allocate the next booking number under a row lock on hotel settings."""
    result = await db.execute(
        select(HotelSettings).where(HotelSettings.hotel_id == hotel_id).with_for_update()
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = HotelSettings(hotel_id=hotel_id)
        db.add(settings)
        await db.flush()
    number = f"{settings.booking_prefix}-{settings.booking_next_number:04d}"
    settings.booking_next_number += 1
    return number


async def _lock_rooms(db: AsyncSession, hotel_id: UUID, room_ids: list[UUID]) -> list[Room]:
    """Lock room rows (ordered to avoid deadlocks) and verify hotel scope."""
    ordered = sorted(set(room_ids), key=str)
    result = await db.execute(
        select(Room)
        .where(Room.hotel_id == hotel_id, Room.id.in_(ordered), Room.is_active.is_(True))
        .order_by(Room.id)
        .with_for_update()
    )
    rooms = list(result.scalars().all())
    if len(rooms) != len(ordered):
        raise NotFoundError("One or more rooms were not found")
    return rooms


async def _assert_no_overlap(
    db: AsyncSession,
    hotel_id: UUID,
    room_ids: list[UUID],
    check_in: date,
    check_out: date,
    *,
    exclude_booking_id: UUID | None = None,
) -> None:
    """Re-check availability inside the transaction (after locking rooms)."""
    from sqlalchemy import func, literal

    # Day-use bookings are stored with check_in_date == check_out_date but
    # still occupy the room for that calendar day, so overlap comparisons use
    # an EFFECTIVE checkout of at least check_in + 1 day on both sides.
    effective_out = check_out if check_out > check_in else check_in + timedelta(days=1)
    stored_effective_out = func.greatest(
        Booking.check_out_date,
        Booking.check_in_date + literal(1),
    )
    stmt = (
        select(BookingRoom.room_id)
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.room_id.in_(room_ids),
            BookingRoom.is_current.is_(True),
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            # date-range overlap: [check_in, effective_out)
            Booking.check_in_date < effective_out,
            stored_effective_out > check_in,
        )
    )
    if exclude_booking_id:
        stmt = stmt.where(Booking.id != exclude_booking_id)
    result = await db.execute(stmt)
    conflicting = set(result.scalars().all())
    if conflicting:
        raise ConflictError(
            "One or more rooms are already booked for these dates",
            code="double_booking",
        )


def _nights(check_in: date, check_out: date) -> int:
    return max((check_out - check_in).days, 1)


def _day_use_hours(check_in_time: str | None, check_out_time: str | None) -> int:
    """Billable hours for a same-day (day-use) stay — ceil to the next hour."""
    if not (check_in_time and check_out_time):
        return 0
    in_h, in_m = (int(p) for p in check_in_time.split(":"))
    out_h, out_m = (int(p) for p in check_out_time.split(":"))
    minutes = (out_h * 60 + out_m) - (in_h * 60 + in_m)
    return max(-(-minutes // 60), 1)  # ceil division


def settle_booking_amounts(booking: Booking) -> None:
    """Recompute due_amount and payment_status from the booking's totals.

    Single source of truth used by payments, charges and check-in fee paths so
    the security deposit is ALWAYS counted against the due amount and the
    payment badge can never say "paid" while money is still owed.
    """
    booking.due_amount = money(
        max(
            booking.total_amount - booking.advance_amount - booking.security_deposit,
            Decimal("0.00"),
        )
    )
    if booking.due_amount <= Decimal("0.00") and (
        booking.advance_amount > 0 or booking.security_deposit > 0
    ):
        booking.payment_status = "paid"
    elif booking.advance_amount > 0 or booking.security_deposit > 0:
        booking.payment_status = "partial"
    else:
        booking.payment_status = "unpaid"


async def create_booking(
    db: AsyncSession,
    tenant: TenantContext,
    body: BookingCreate,
    *,
    correlation_id: str | None = None,
) -> Booking:
    hotel_id = tenant.require_hotel()
    from app.services.subscriptions import assert_transactions_allowed

    await assert_transactions_allowed(db, hotel_id)

    # Prevent bookings for dates already in the past.
    if body.check_in_date < date.today():
        raise ValidationAppError(
            "Check-in date cannot be in the past", code="checkin_date_past"
        )

    guest = await get_guest(db, tenant, body.primary_guest_id)

    rooms = await _lock_rooms(db, hotel_id, body.room_ids)
    await _assert_no_overlap(
        db, hotel_id, [r.id for r in rooms], body.check_in_date, body.check_out_date
    )

    # For today's bookings check the room is currently allocatable.
    # For future bookings the room may still be Available (the overlap check
    # prevents double-booking). We reserve the room below for all confirmed bookings.
    is_same_day = body.check_in_date == date.today()
    for room in rooms:
        if is_same_day and not is_allocatable(room.status):
            raise ConflictError(
                f"Room {room.room_number} is not available (status: {room.status})",
                code="room_not_allocatable",
            )

    nights = _nights(body.check_in_date, body.check_out_date)
    is_day_use = body.check_in_date == body.check_out_date
    day_use_hours = (
        _day_use_hours(body.check_in_time, body.check_out_time) if is_day_use else 0
    )
    room_result = await db.execute(
        select(Room)
        .options(selectinload(Room.room_type))
        .where(Room.id.in_([r.id for r in rooms]))
    )
    rooms_with_types = list(room_result.scalars().all())

    def _stay_rate(room: Room) -> Decimal:
        """Rate stored on BookingRoom = full price of the stay for that room.

        Night stays: per-night base price (multiplied by nights for totals).
        Day use: ceil(hours) × hourly_rate, or the full-night base price when
        the room type has no hourly rate configured (nights == 1 for day use,
        so the stored rate IS the stay total in that case).
        """
        if is_day_use:
            rt = room.room_type
            if rt.hourly_rate and rt.hourly_rate > 0:
                return money(rt.hourly_rate * day_use_hours)
            return money(rt.base_price)
        return room.room_type.base_price

    subtotal = sum(
        (_stay_rate(room) * nights for room in rooms_with_types),
        Decimal("0.00"),
    )
    total = money(max(subtotal - body.discount_amount, Decimal("0.00")))

    booking = Booking(
        hotel_id=hotel_id,
        booking_number=await next_booking_number(db, hotel_id),
        primary_guest_id=guest.id,
        source=body.source,
        guest_type=body.guest_type,
        status="confirmed" if body.confirm else "pending",
        payment_status="unpaid",
        check_in_date=body.check_in_date,
        check_out_date=body.check_out_date,
        check_in_time=body.check_in_time,
        check_out_time=body.check_out_time,
        adults=body.adults,
        children=body.children,
        room_count=len(rooms),
        discount_amount=body.discount_amount,
        total_amount=total,
        security_deposit=body.security_deposit,
        due_amount=total,
        special_requests=body.special_requests,
        emergency_contact_name=body.emergency_contact_name,
        emergency_contact_relation=body.emergency_contact_relation,
        emergency_contact_phone=body.emergency_contact_phone,
        vehicle_number=body.vehicle_number,
        vehicle_type=body.vehicle_type,
        parking_slot=body.parking_slot,
        created_by_id=tenant.user_id,
    )
    db.add(booking)
    await db.flush()

    for room in rooms_with_types:
        db.add(
            BookingRoom(
                hotel_id=hotel_id,
                booking_id=booking.id,
                room_id=room.id,
                room_type_id=room.room_type_id,
                rate=_stay_rate(room),
                is_current=True,
            )
        )
        # Per SRS §6: "Confirmed booking → Reserved."
        # Reserve for all confirmed bookings (not just same-day) so room
        # status correctly shows as Reserved on the property grid.
        if booking.status == "confirmed":
            if room.status in (RoomStatus.AVAILABLE.value, RoomStatus.CLEAN_READY.value):
                room.status = RoomStatus.RESERVED.value

    await db.flush()

    from app.services.ledger import append_entry

    await append_entry(
        db,
        hotel_id=hotel_id,
        booking_id=booking.id,
        entry_type="debit",
        amount=total,
        description=(
            f"Room charges (day use, {day_use_hours} hr(s), {len(rooms)} room(s))"
            if is_day_use
            else f"Room charges ({nights} night(s), {len(rooms)} room(s))"
        ),
        reference_type="booking",
        reference_id=booking.id,
        created_by_id=tenant.user_id,
    )
    await write_audit(
        db,
        action="bookings.created",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking_number": booking.booking_number,
            "status": booking.status,
            "rooms": [r.room_number for r in rooms_with_types],
            "check_in": str(body.check_in_date),
            "check_out": str(body.check_out_date),
        },
        correlation_id=correlation_id,
    )
    from app.models.guest import Guest as _Guest
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    _g = await db.get(_Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    gname = _g.full_name if _g else "Guest"
    await _fire(db, hotel_id=hotel_id, event=NE.BOOKING_CREATED, data={
        "booking_number": booking.booking_number,
        "guest_name": gname,
        "check_in_date": str(body.check_in_date),
        "check_out_date": str(body.check_out_date),
    })
    return booking


BOOKING_LOAD = (selectinload(Booking.rooms),)


async def get_booking(db: AsyncSession, tenant: TenantContext, booking_id: UUID) -> Booking:
    result = await db.execute(
        select(Booking)
        .options(*BOOKING_LOAD)
        .where(Booking.id == booking_id, Booking.hotel_id == tenant.require_hotel())
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise NotFoundError("Booking not found")
    return booking


async def list_bookings(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    status: str | None = None,
    query: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Booking], int]:
    hotel_id = tenant.require_hotel()
    stmt = select(Booking).where(Booking.hotel_id == hotel_id)
    if status:
        stmt = stmt.where(Booking.status == status)
    if from_date:
        stmt = stmt.where(Booking.check_in_date >= from_date)
    if to_date:
        stmt = stmt.where(Booking.check_in_date <= to_date)
    if query:
        guest_ids = select(Guest.id).where(
            Guest.hotel_id == hotel_id, Guest.full_name.ilike(f"%{query}%")
        )
        stmt = stmt.where(
            or_(
                Booking.booking_number.ilike(f"%{query}%"),
                Booking.primary_guest_id.in_(guest_ids),
            )
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.options(*BOOKING_LOAD)
        .order_by(Booking.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total


async def update_booking(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    body: BookingUpdate,
    *,
    correlation_id: str | None = None,
) -> Booking:
    booking = await get_booking(db, tenant, booking_id)
    if booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            "Only pending/confirmed bookings can be modified", code="booking_locked"
        )
    changes = body.model_dump(exclude_unset=True)
    new_in = changes.get("check_in_date", booking.check_in_date)
    new_out = changes.get("check_out_date", booking.check_out_date)
    is_day_use = booking.check_in_date == booking.check_out_date
    if new_out < new_in or (new_out == new_in and not is_day_use):
        # Same-day dates are only valid for bookings created as day-use
        # (which carry check-in/out times and hourly pricing on the rate).
        raise ValidationAppError("Check-out date must be after check-in date")

    old_total = booking.total_amount
    if "check_in_date" in changes or "check_out_date" in changes:
        room_ids = [br.room_id for br in booking.rooms if br.is_current]
        await _lock_rooms(db, booking.hotel_id, room_ids)
        await _assert_no_overlap(
            db, booking.hotel_id, room_ids, new_in, new_out, exclude_booking_id=booking.id
        )
        # Recalculate room total for the new night count.
        nights = _nights(new_in, new_out)
        room_subtotal = sum(
            (br.rate * nights for br in booking.rooms if br.is_current), Decimal("0.00")
        )
        booking.total_amount = money(
            max(
                room_subtotal - (changes.get("discount_amount", booking.discount_amount)),
                Decimal("0.00"),
            )
        )
        settle_booking_amounts(booking)

    before = {k: str(getattr(booking, k)) for k in changes}
    for key, value in changes.items():
        setattr(booking, key, value)

    # If the room charge total changed, record a compensating ledger entry.
    new_total = booking.total_amount
    if new_total != old_total:
        from app.services.ledger import append_entry

        delta = new_total - old_total
        if delta > 0:
            await append_entry(
                db,
                hotel_id=booking.hotel_id,
                booking_id=booking.id,
                entry_type="debit",
                amount=delta,
                description="Booking date adjustment (increase)",
                reference_type="booking_update",
                reference_id=booking.id,
                created_by_id=tenant.user_id,
            )
        else:
            await append_entry(
                db,
                hotel_id=booking.hotel_id,
                booking_id=booking.id,
                entry_type="credit",
                amount=abs(delta),
                description="Booking date adjustment (decrease)",
                reference_type="booking_update",
                reference_id=booking.id,
                created_by_id=tenant.user_id,
            )

    await write_audit(
        db,
        action="bookings.updated",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before=before,
        after={k: str(v) for k, v in changes.items()},
        correlation_id=correlation_id,
    )
    return booking


async def _release_rooms(db: AsyncSession, booking: Booking) -> None:
    room_ids = [br.room_id for br in booking.rooms if br.is_current]
    if not room_ids:
        return
    result = await db.execute(
        select(Room)
        .where(Room.id.in_(room_ids), Room.hotel_id == booking.hotel_id)
        .with_for_update()
    )
    for room in result.scalars().all():
        if room.status == RoomStatus.RESERVED.value:
            room.status = RoomStatus.AVAILABLE.value


async def cancel_booking(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    reason: str,
    *,
    correlation_id: str | None = None,
) -> Booking:
    booking = await get_booking(db, tenant, booking_id)
    if booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            "Only pending/confirmed bookings can be cancelled", code="booking_locked"
        )
    old_status = booking.status
    booking.status = "cancelled"
    booking.cancelled_at = datetime.now(UTC)
    booking.cancel_reason = reason
    await _release_rooms(db, booking)
    await write_audit(
        db,
        action="bookings.cancelled",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"status": old_status},
        after={"status": "cancelled", "reason": reason},
        correlation_id=correlation_id,
    )
    from app.models.guest import Guest as _Guest
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    _g = await db.get(_Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    gname = _g.full_name if _g else "Guest"
    await _fire(db, hotel_id=tenant.require_hotel(), event=NE.BOOKING_CANCELLED, data={
        "booking_number": booking.booking_number,
        "guest_name": gname,
        "reason": reason,
    })
    return booking


async def mark_no_show(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    *,
    correlation_id: str | None = None,
) -> Booking:
    booking = await get_booking(db, tenant, booking_id)
    if booking.status != "confirmed":
        raise ValidationAppError(
            "Only confirmed bookings can be marked no-show", code="booking_locked"
        )
    booking.status = "no_show"
    await _release_rooms(db, booking)
    await write_audit(
        db,
        action="bookings.no_show",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        correlation_id=correlation_id,
    )
    from app.models.guest import Guest as _Guest
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    _g = await db.get(_Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    gname = _g.full_name if _g else "Guest"
    await _fire(db, hotel_id=tenant.require_hotel(), event=NE.BOOKING_NOSHOW, data={
        "booking_number": booking.booking_number,
        "guest_name": gname,
    })
    return booking


_BOOKING_SCALAR_FIELDS = (
    "id",
    "booking_number",
    "status",
    "payment_status",
    "source",
    "guest_type",
    "check_in_date",
    "check_out_date",
    "check_in_time",
    "check_out_time",
    "adults",
    "children",
    "room_count",
    "discount_amount",
    "tax_amount",
    "total_amount",
    "advance_amount",
    "security_deposit",
    "due_amount",
    "special_requests",
    "emergency_contact_name",
    "emergency_contact_relation",
    "emergency_contact_phone",
    "vehicle_number",
    "vehicle_type",
    "parking_slot",
    "primary_guest_id",
    "created_at",
)


async def to_out_many(db: AsyncSession, bookings: list[Booking]) -> list[BookingOut]:
    """Convert bookings to API payloads with a fixed number of queries.

    Three batched lookups (booking rooms, rooms+types, guests) regardless of
    list size — never per-booking queries.
    """
    if not bookings:
        return []
    booking_ids = [b.id for b in bookings]

    br_result = await db.execute(
        select(BookingRoom).where(BookingRoom.booking_id.in_(booking_ids))
    )
    booking_rooms: dict[UUID, list[BookingRoom]] = {}
    room_ids: set[UUID] = set()
    for br in br_result.scalars().all():
        booking_rooms.setdefault(br.booking_id, []).append(br)
        room_ids.add(br.room_id)

    rooms_by_id: dict[UUID, Room] = {}
    if room_ids:
        room_result = await db.execute(
            select(Room).options(selectinload(Room.room_type)).where(Room.id.in_(room_ids))
        )
        rooms_by_id = {room.id: room for room in room_result.scalars().all()}

    guest_ids = {b.primary_guest_id for b in bookings if b.primary_guest_id}
    guests_by_id: dict[UUID, Guest] = {}
    if guest_ids:
        guest_result = await db.execute(select(Guest).where(Guest.id.in_(guest_ids)))
        guests_by_id = {g.id: g for g in guest_result.scalars().all()}

    outs: list[BookingOut] = []
    for booking in bookings:
        guest = guests_by_id.get(booking.primary_guest_id) if booking.primary_guest_id else None
        rooms_out = [
            BookingRoomOut(
                room_id=br.room_id,
                room_number=rooms_by_id[br.room_id].room_number,
                room_type_name=rooms_by_id[br.room_id].room_type.name,
                rate=br.rate,
                is_current=br.is_current,
            )
            for br in booking_rooms.get(booking.id, [])
            if br.room_id in rooms_by_id
        ]
        data = {field: getattr(booking, field) for field in _BOOKING_SCALAR_FIELDS}
        outs.append(
            BookingOut(
                **data,
                primary_guest_name=guest.full_name if guest else None,
                primary_guest_phone=guest.normalized_phone if guest else None,
                rooms=rooms_out,
            )
        )
    return outs


async def to_out(db: AsyncSession, booking: Booking) -> BookingOut:
    return (await to_out_many(db, [booking]))[0]
