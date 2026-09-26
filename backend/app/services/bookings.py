from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import money
from app.domain.room_status import RoomStatus
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

# Same-day bookings: physical states a room must NOT be in right now. This set
# MIRRORS check_availability's same-day rules so the picker and the booking
# API can never disagree (the old is_allocatable check rejected
# cleaning_required / inspection_required rooms the picker had offered).
#   bookable — available, clean_ready, cleaning_required (cleaned before
#              arrival), inspection_required, reserved (legacy rows only,
#              until the redesign migration converts them to available).
_SAME_DAY_BLOCKED = frozenset(
    {
        RoomStatus.OCCUPIED.value,
        RoomStatus.CLEANING_IN_PROGRESS.value,
        RoomStatus.MAINTENANCE.value,
        RoomStatus.OUT_OF_SERVICE.value,
    }
)


def _assert_same_day_bookable(room: Room) -> None:
    """409 if the room's physical state blocks an immediate (same-day) stay."""
    if room.status in _SAME_DAY_BLOCKED:
        from app.domain.room_status import status_label

        raise ConflictError(
            f"Room {room.room_number} is not available right now "
            f"(status: {status_label(room.status)})",
            code="room_not_allocatable",
        )


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
    check_in_time: str | None = None,
    check_out_time: str | None = None,
    exclude_booking_id: UUID | None = None,
) -> None:
    """Re-check availability inside the transaction (after locking rooms)."""
    settings = await db.scalar(
        select(HotelSettings).where(HotelSettings.hotel_id == hotel_id)
    )
    default_ci_str = (
        settings.check_in_time.strftime("%H:%M")
        if settings and settings.check_in_time
        else "14:00"
    )
    default_co_str = (
        settings.check_out_time.strftime("%H:%M")
        if settings and settings.check_out_time
        else "11:00"
    )
    effective_ci_time = check_in_time[:5] if check_in_time else default_ci_str
    effective_co_time = check_out_time[:5] if check_out_time else default_co_str

    starts_before_req_ends = or_(
        Booking.check_in_date < check_out,
        and_(
            Booking.check_in_date == check_out,
            func.coalesce(Booking.check_in_time, default_ci_str) < effective_co_time,
        ),
    )
    ends_after_req_starts = or_(
        Booking.check_out_date > check_in,
        and_(
            Booking.check_out_date == check_in,
            func.coalesce(Booking.check_out_time, default_co_str) > effective_ci_time,
        ),
    )

    stmt = (
        select(BookingRoom.room_id)
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.room_id.in_(room_ids),
            BookingRoom.is_current.is_(True),
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            starts_before_req_ends,
            ends_after_req_starts,
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


async def _room_gst(db: AsyncSession, hotel_id: UUID, room_taxable: Decimal):
    """Room GST breakup using THE shared engine (plan §3.1).

    Same math as the checkout quote, compute_settlement and the invoice —
    booking totals must never disagree with them. Mode-aware: no_gst → zero
    tax; included_by_hotel → tax inside the price (total unchanged);
    included_by_customer → tax added on top.
    """
    from app.domain.gst import GstRates, calculate_gst
    from app.repositories.hotels import get_gst_context

    gst, registered, inclusive = await get_gst_context(db, hotel_id)
    rates = GstRates(
        cgst=gst.default_cgst_rate,
        sgst=gst.default_sgst_rate,
        igst=gst.default_igst_rate,
        version=gst.version,
    )
    return calculate_gst(
        room_taxable, rates, is_registered=registered, inclusive=inclusive
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

    # HOTEL-LOCAL today (redesign B4 fix): the server runs UTC, so date.today()
    # would mis-classify same-day bookings made 00:00–05:30 IST as "future"
    # (skipping the physical allocatable check) and reject valid bookings for
    # "today" as past dates. Same pattern as check_availability.
    from app.services.rooms import hotel_today

    today_local = await hotel_today(db, hotel_id)

    # Prevent bookings for dates already in the past.
    if body.check_in_date < today_local:
        raise ValidationAppError(
            "Check-in date cannot be in the past", code="checkin_date_past"
        )

    guest = await get_guest(db, tenant, body.primary_guest_id)

    rooms = await _lock_rooms(db, hotel_id, body.room_ids)
    await _assert_no_overlap(
        db,
        hotel_id,
        [r.id for r in rooms],
        body.check_in_date,
        body.check_out_date,
        check_in_time=body.check_in_time,
        check_out_time=body.check_out_time,
    )

    # For today's bookings the room must be physically usable NOW. This set
    # MIRRORS check_availability's same-day rules so the picker and the
    # booking API can never disagree (the old is_allocatable check rejected
    # cleaning_required/inspection_required rooms the picker had offered):
    #   blocked  — occupied, cleaning_in_progress, maintenance, out_of_service
    #   bookable — available, clean_ready, cleaning_required (cleaned before
    #              arrival), inspection_required, reserved (legacy rows only,
    #              until the redesign migration converts them to available).
    # For future bookings physical state is irrelevant — the overlap check
    # above is the sole double-booking guard.
    is_same_day = body.check_in_date == today_local
    if is_same_day:
        for room in rooms:
            _assert_same_day_bookable(room)

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

    # Staff-edited rates take precedence over room-type pricing (client
    # requirement: front desk can adjust room rent at booking time). The
    # override is per-night for overnight stays, whole-stay for day use.
    overrides = {o.room_id: money(o.rate) for o in body.rate_overrides}

    def _stay_rate(room: Room) -> Decimal:
        """Rate stored on BookingRoom = full price of the stay for that room.

        Night stays: per-night base price (multiplied by nights for totals).
        Day use: ceil(hours) × hourly_rate, or the full-night base price when
        the room type has no hourly rate configured (nights == 1 for day use,
        so the stored rate IS the stay total in that case).
        """
        if room.id in overrides:
            return overrides[room.id]
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
    # UNIFIED PRICING (plan §3.1): booking totals are GST-AWARE from creation,
    # using the SAME engine as the checkout quote and the invoice. Previously
    # totals excluded room GST while checkout/invoice included it, so "due"
    # disagreed across screens (client: "incorrect payment due amount").
    room_breakup = await _room_gst(db, hotel_id, money(subtotal))
    total = money(
        max(room_breakup.total_amount - body.discount_amount, Decimal("0.00"))
    )

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
        tax_amount=room_breakup.total_tax,
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
        # ROOM-STATUS REDESIGN (plan 15/09): "Reserved" is NO LONGER stored in
        # room.status — a reservation is a calendar fact derived from bookings
        # at read time (list_rooms / availability enrich each room with
        # arriving_today + next_booking).  Storing it painted rooms "Reserved"
        # for far-future bookings, drifted with multi-booking/cancel flows, and
        # broke same-day walk-ins (picker offered a room booking then 409'd).
        # Double-booking safety lives entirely in _assert_no_overlap above.

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
            **(
                {
                    "rate_overrides": {
                        r.room_number: str(overrides[r.id])
                        for r in rooms_with_types
                        if r.id in overrides
                    }
                }
                if overrides
                else {}
            ),
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
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        allowed = {
            "pending",
            "confirmed",
            "checked_in",
            "checked_out",
            "cancelled",
            "no_show",
        }
        statuses = [s for s in statuses if s in allowed]
        if len(statuses) == 1:
            stmt = stmt.where(Booking.status == statuses[0])
        elif statuses:
            stmt = stmt.where(Booking.status.in_(statuses))
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
    changes = body.model_dump(exclude_unset=True)

    # In-house stays CAN be edited (client: Edit Stay on Current Guests) — but
    # only forward-looking fields. The check-in side is history once the guest
    # is in the room.
    _CHECKED_IN_EDITABLE = {
        "check_out_date",
        "check_out_time",
        "adults",
        "children",
        "guest_type",
        "special_requests",
        "emergency_contact_name",
        "emergency_contact_relation",
        "emergency_contact_phone",
        "vehicle_number",
        "vehicle_type",
        "parking_slot",
    }
    if booking.status == "checked_in":
        blocked = set(changes) - _CHECKED_IN_EDITABLE
        if blocked:
            raise ValidationAppError(
                f"These fields cannot be changed after check-in: {', '.join(sorted(blocked))}",
                code="booking_locked_fields",
            )
    elif booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            "Completed/cancelled bookings cannot be modified", code="booking_locked"
        )

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
            db,
            booking.hotel_id,
            room_ids,
            new_in,
            new_out,
            check_in_time=body.check_in_time or booking.check_in_time,
            check_out_time=body.check_out_time or booking.check_out_time,
            exclude_booking_id=booking.id,
        )
        # Recalculate room total for the new night count — INCLUDING existing
        # charges (they were previously dropped here, silently shrinking the
        # total for stays with restaurant/service charges).
        from app.models.payment import HotelCharge

        charges_result = await db.execute(
            select(func.coalesce(func.sum(HotelCharge.total_amount), 0)).where(
                HotelCharge.booking_id == booking.id,
                HotelCharge.hotel_id == booking.hotel_id,
                HotelCharge.voided_at.is_(None),
            )
        )
        charges_total = Decimal(str(charges_result.scalar_one()))
        nights = _nights(new_in, new_out)
        room_subtotal = sum(
            (br.rate * nights for br in booking.rooms if br.is_current), Decimal("0.00")
        )
        # GST-aware (plan §3.1) — same engine as checkout/invoice.
        room_bk = await _room_gst(db, booking.hotel_id, money(room_subtotal))
        booking.total_amount = money(
            max(
                room_bk.total_amount
                + charges_total
                - (changes.get("discount_amount", booking.discount_amount)),
                Decimal("0.00"),
            )
        )
        settle_booking_amounts(booking)

    # Extending/correcting the checkout moment resets the overdue-notification
    # dedupe so a future overdue on the new schedule alerts again.
    if "check_out_date" in changes or "check_out_time" in changes:
        booking.overdue_notified_at = None

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


async def replace_booking_room(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    *,
    from_room_id: UUID,
    to_room_id: UUID,
    reason: str | None = None,
    correlation_id: str | None = None,
) -> Booking:
    """Swap one allocated room on a NOT-yet-checked-in booking (client 9-08
    item 22 — room replacement during advance-booking check-in).

    Atomic within the request transaction: locks both rooms, re-checks
    availability for the booking's dates, keeps allocation history
    (is_current=False + new row), reprices the booking and adjusts the
    ledger. After check-in the separate room-transfer flow applies.
    """
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, booking_id)

    if booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            "Rooms can only be replaced before check-in — use room transfer "
            "for in-house stays",
            code="booking_not_replaceable",
        )
    if from_room_id == to_room_id:
        raise ValidationAppError("Choose a different room", code="same_room")

    current = next(
        (br for br in booking.rooms if br.is_current and br.room_id == from_room_id),
        None,
    )
    if current is None:
        raise NotFoundError("That room is not allocated to this booking")
    if any(br.is_current and br.room_id == to_room_id for br in booking.rooms):
        raise ValidationAppError(
            "That room is already part of this booking", code="room_already_allocated"
        )

    locked = await _lock_rooms(db, hotel_id, [from_room_id, to_room_id])
    by_id = {r.id: r for r in locked}
    from_room, to_room = by_id[from_room_id], by_id[to_room_id]

    # Availability re-check inside the lock — the atomic double-booking guard.
    await _assert_no_overlap(
        db,
        hotel_id,
        [to_room_id],
        booking.check_in_date,
        booking.check_out_date,
        check_in_time=booking.check_in_time,
        check_out_time=booking.check_out_time,
        exclude_booking_id=booking.id,
    )
    from app.services.rooms import hotel_today as _hotel_today

    if booking.check_in_date <= await _hotel_today(db, hotel_id):
        _assert_same_day_bookable(to_room)

    # ── Repricing ──────────────────────────────────────────────────────────
    # Same room type: keep the stored rate (preserves staff overrides).
    # Different type: price from the new room type, same rules as creation.
    to_room_typed = (
        await db.execute(
            select(Room)
            .options(selectinload(Room.room_type))
            .where(Room.id == to_room_id)
        )
    ).scalar_one()
    if to_room.room_type_id == current.room_type_id:
        new_rate = current.rate
    else:
        rt = to_room_typed.room_type
        is_day_use = booking.check_in_date == booking.check_out_date
        if is_day_use and rt.hourly_rate and rt.hourly_rate > 0:
            hours = _day_use_hours(booking.check_in_time, booking.check_out_time)
            new_rate = money(rt.hourly_rate * hours)
        else:
            new_rate = money(rt.base_price)

    # ── History-preserving swap ────────────────────────────────────────────
    current.is_current = False
    db.add(
        BookingRoom(
            hotel_id=hotel_id,
            booking_id=booking.id,
            room_id=to_room.id,
            room_type_id=to_room.room_type_id,
            rate=new_rate,
            is_current=True,
        )
    )

    # Reservation state is derived from bookings at read time (redesign 15/09).
    # Legacy self-heal only: release a pre-migration stored 'reserved' flag.
    if from_room.status == RoomStatus.RESERVED.value:
        from_room.status = RoomStatus.AVAILABLE.value

    # ── Reprice booking total (room subtotal + charges − discount) ─────────
    from app.models.payment import HotelCharge

    charges_result = await db.execute(
        select(func.coalesce(func.sum(HotelCharge.total_amount), 0)).where(
            HotelCharge.booking_id == booking.id,
            HotelCharge.hotel_id == hotel_id,
            HotelCharge.voided_at.is_(None),
        )
    )
    charges_total = Decimal(str(charges_result.scalar_one()))
    nights = _nights(booking.check_in_date, booking.check_out_date)
    room_subtotal = (
        sum(
            (
                br.rate
                for br in booking.rooms
                if br.is_current and br.room_id != from_room_id
            ),
            Decimal("0.00"),
        )
        + new_rate
    ) * nights

    old_total = booking.total_amount
    # GST-aware (plan §3.1) — same engine as checkout/invoice.
    room_bk = await _room_gst(db, hotel_id, money(room_subtotal))
    booking.total_amount = money(
        max(room_bk.total_amount + charges_total - booking.discount_amount, Decimal("0.00"))
    )
    settle_booking_amounts(booking)

    delta = booking.total_amount - old_total
    if delta != 0:
        from app.services.ledger import append_entry

        await append_entry(
            db,
            hotel_id=hotel_id,
            booking_id=booking.id,
            entry_type="debit" if delta > 0 else "credit",
            amount=abs(delta),
            description=(
                f"Room replacement {from_room.room_number} → {to_room.room_number}"
            ),
            reference_type="booking_room_replacement",
            reference_id=booking.id,
            created_by_id=tenant.user_id,
        )

    await db.flush()
    await write_audit(
        db,
        action="bookings.room_replaced",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        before={"room": from_room.room_number, "rate": str(current.rate)},
        after={
            "room": to_room.room_number,
            "rate": str(new_rate),
            "total": str(booking.total_amount),
            "reason": reason,
        },
        correlation_id=correlation_id,
    )
    # Reload with fresh room allocations for the response.
    return await get_booking(db, tenant, booking_id)


async def add_room_to_booking(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    *,
    new_room_id: UUID,
    correlation_id: str | None = None,
) -> Booking:
    """Add an extra room to a confirmed (advance) booking before check-in.

    Allows the arriving guest to take more rooms than originally reserved —
    the additional room is appended to the booking, priced at the room type's
    base rate, and the booking total is updated with a debit ledger entry.
    """
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, booking_id)

    if booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            "Extra rooms can only be added before check-in.",
            code="booking_not_modifiable",
        )
    if any(br.is_current and br.room_id == new_room_id for br in booking.rooms):
        raise ValidationAppError(
            "That room is already allocated to this booking.", code="room_already_allocated"
        )

    await _lock_rooms(db, hotel_id, [new_room_id])
    new_room_typed = (
        await db.execute(
            select(Room)
            .options(selectinload(Room.room_type))
            .where(Room.id == new_room_id)
        )
    ).scalar_one()

    # Availability re-check inside the lock — double-booking guard.
    await _assert_no_overlap(
        db,
        hotel_id,
        [new_room_id],
        booking.check_in_date,
        booking.check_out_date,
        check_in_time=booking.check_in_time,
        check_out_time=booking.check_out_time,
        exclude_booking_id=booking.id,
    )
    from app.services.rooms import hotel_today as _hotel_today

    if booking.check_in_date <= await _hotel_today(db, hotel_id):
        _assert_same_day_bookable(new_room_typed)

    # Rate: use the room type's default base rate (staff can override later).
    new_rate = new_room_typed.room_type.base_price if new_room_typed.room_type else Decimal("0.00")

    db.add(
        BookingRoom(
            hotel_id=hotel_id,
            booking_id=booking.id,
            room_id=new_room_id,
            room_type_id=new_room_typed.room_type_id,
            rate=new_rate,
            is_current=True,
        )
    )

    # Reservation state is derived at read time (redesign 15/09) — no status
    # write here; the overlap check above already guards double booking.

    # Reprice booking total.
    from app.models.payment import HotelCharge

    charges_result = await db.execute(
        select(func.coalesce(func.sum(HotelCharge.total_amount), 0)).where(
            HotelCharge.booking_id == booking.id,
            HotelCharge.hotel_id == hotel_id,
            HotelCharge.voided_at.is_(None),
        )
    )
    charges_total = Decimal(str(charges_result.scalar_one()))
    nights = _nights(booking.check_in_date, booking.check_out_date)
    room_subtotal = (
        sum(
            (br.rate for br in booking.rooms if br.is_current),
            Decimal("0.00"),
        )
        + new_rate
    ) * nights

    old_total = booking.total_amount
    # GST-aware (plan §3.1) — same engine as checkout/invoice.
    room_bk = await _room_gst(db, hotel_id, money(room_subtotal))
    booking.total_amount = money(
        max(room_bk.total_amount + charges_total - booking.discount_amount, Decimal("0.00"))
    )
    settle_booking_amounts(booking)

    delta = booking.total_amount - old_total
    if delta > 0:
        from app.services.ledger import append_entry

        await append_entry(
            db,
            hotel_id=hotel_id,
            booking_id=booking.id,
            entry_type="debit",
            amount=delta,
            description=f"Extra room added: {new_room_typed.room_number}",
            reference_type="booking_room_added",
            reference_id=booking.id,
            created_by_id=tenant.user_id,
        )

    await db.flush()
    await write_audit(
        db,
        action="bookings.room_added",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "room": new_room_typed.room_number,
            "rate": str(new_rate),
            "new_total": str(booking.total_amount),
        },
        correlation_id=correlation_id,
    )
    return await get_booking(db, tenant, booking_id)


async def _release_rooms(db: AsyncSession, booking: Booking) -> None:
    """Legacy self-heal: clear pre-migration stored 'reserved' flags.

    Reservation state is derived from bookings at read time (redesign 15/09);
    nothing writes RESERVED anymore, so this only heals rows created before
    the migration. Safe to remove once all environments are migrated.
    """
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
