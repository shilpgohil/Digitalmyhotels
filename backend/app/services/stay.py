"""Check-in, current guests, room transfer, checkout and checkout reversal.

All room-state mutations here go through the room status state machine and
run inside the request transaction (rooms are locked with FOR UPDATE).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.domain.room_status import RoomStatus, assert_transition
from app.models.booking import Booking, BookingRoom, CheckIn, CheckOut, RoomTransfer
from app.models.guest import Guest, GuestRegistration
from app.models.hotel import HotelSettings
from app.models.room import Room
from app.schemas.stay import (
    CheckInOut,
    CheckInRequest,
    CheckOutOut,
    CheckOutRequest,
    CurrentGuestOut,
    RoomTransferOut,
    RoomTransferRequest,
)
from app.services.audit import write_audit
from app.services.bookings import get_booking

REGISTRATION_SEQ_PAD = 4


def _now() -> datetime:
    return datetime.now(UTC)


async def _current_rooms_locked(db: AsyncSession, booking: Booking) -> list[Room]:
    room_ids = [br.room_id for br in booking.rooms if br.is_current]
    result = await db.execute(
        select(Room).where(Room.id.in_(room_ids)).order_by(Room.id).with_for_update()
    )
    return list(result.scalars().all())


async def _next_registration_number(db: AsyncSession, hotel_id: UUID) -> str:
    """Allocate the next registration number under a row lock — same pattern as booking numbers."""
    result = await db.execute(
        select(HotelSettings).where(HotelSettings.hotel_id == hotel_id).with_for_update()
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = HotelSettings(hotel_id=hotel_id)
        db.add(settings)
        await db.flush()
    number = f"REG-{settings.registration_next_number:0{REGISTRATION_SEQ_PAD}d}"
    settings.registration_next_number += 1
    return number


async def check_in(
    db: AsyncSession,
    tenant: TenantContext,
    body: CheckInRequest,
    *,
    correlation_id: str | None = None,
) -> CheckInOut:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, body.booking_id)

    if booking.status == "checked_in":
        raise ConflictError("Booking is already checked in", code="already_checked_in")
    if booking.status not in ("pending", "confirmed"):
        raise ValidationAppError(
            f"Booking in status '{booking.status}' cannot be checked in",
            code="booking_not_checkinable",
        )
    if booking.primary_guest_id is None:
        raise ValidationAppError("Booking has no primary guest", code="no_primary_guest")

    if body.is_early and body.early_fee > 0 and not tenant.can(Permission.CHECKOUT):
        # Early check-in with a fee needs a role that can approve charges.
        raise ValidationAppError(
            "Early check-in fee requires an authorized role", code="early_fee_unauthorized"
        )

    rooms = await _current_rooms_locked(db, booking)
    for room in rooms:
        # Reserved (normal flow) or allocatable (walk-in confirmed today).
        assert_transition(room.status, RoomStatus.OCCUPIED)
        room.status = RoomStatus.OCCUPIED.value

    checkin = CheckIn(
        hotel_id=hotel_id,
        booking_id=booking.id,
        checked_in_at=body.checked_in_at or _now(),
        expected_checkout_at=body.expected_checkout_at,
        is_early=body.is_early,
        early_fee=body.early_fee,
        performed_by_id=tenant.user_id,
        notes=body.notes,
    )
    db.add(checkin)

    # Guest registrations: primary + co-guests, each with a registration number.
    registration_numbers: list[str] = []
    guest_entries: list[tuple[UUID, bool, str | None, str | None]] = [
        (booking.primary_guest_id, True, body.purpose_of_visit, body.company_name)
    ]
    seen = {booking.primary_guest_id}
    for co_guest in body.co_guests:
        if co_guest.guest_id in seen:
            continue
        # Validates hotel scope of every co-guest.
        result = await db.execute(
            select(Guest).where(Guest.id == co_guest.guest_id, Guest.hotel_id == hotel_id)
        )
        if result.scalar_one_or_none() is None:
            raise NotFoundError("Co-guest not found")
        guest_entries.append(
            (co_guest.guest_id, False, co_guest.purpose_of_visit, co_guest.company_name)
        )
        seen.add(co_guest.guest_id)

    for guest_id, is_primary, purpose, company in guest_entries:
        reg_number = await _next_registration_number(db, hotel_id)
        db.add(
            GuestRegistration(
                hotel_id=hotel_id,
                booking_id=booking.id,
                guest_id=guest_id,
                registration_number=reg_number,
                is_primary=is_primary,
                purpose_of_visit=purpose,
                company_name=company,
                acknowledged_at=_now() if body.terms_acknowledged else None,
            )
        )
        registration_numbers.append(reg_number)
        await db.flush()

    if body.early_fee > 0:
        booking.total_amount += body.early_fee
        booking.due_amount += body.early_fee
        from app.services.ledger import append_entry

        await append_entry(
            db,
            hotel_id=hotel_id,
            booking_id=booking.id,
            entry_type="debit",
            amount=body.early_fee,
            description="Early check-in fee",
            reference_type="checkin_fee",
            created_by_id=tenant.user_id,
        )

    booking.status = "checked_in"
    await db.flush()
    await write_audit(
        db,
        action="stay.checked_in",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking_number": booking.booking_number,
            "guests": len(guest_entries),
            "is_early": body.is_early,
        },
        correlation_id=correlation_id,
    )
    from app.models.guest import Guest as _Guest
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    _g = await db.get(_Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    gname = _g.full_name if _g else "Guest"
    room_numbers = ", ".join(r.room_number for r in (await db.execute(
        select(Room).join(BookingRoom, BookingRoom.room_id == Room.id).where(
            BookingRoom.booking_id == booking.id, BookingRoom.is_current.is_(True)
        )
    )).scalars().all())
    await _fire(db, hotel_id=hotel_id, event=NE.CHECKIN_COMPLETED, data={
        "guest_name": gname,
        "rooms": room_numbers,
        "booking_number": booking.booking_number,
    })
    return CheckInOut(
        id=checkin.id,
        booking_id=booking.id,
        booking_number=booking.booking_number,
        checked_in_at=checkin.checked_in_at,
        expected_checkout_at=checkin.expected_checkout_at,
        is_early=checkin.is_early,
        early_fee=checkin.early_fee,
        registration_numbers=registration_numbers,
    )


def _mask(phone: str) -> str:
    return ("*" * max(len(phone) - 4, 0)) + phone[-4:] if phone else ""


async def list_current_guests(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    query: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[CurrentGuestOut], int]:
    hotel_id = tenant.require_hotel()
    from sqlalchemy import or_
    from sqlalchemy.orm import selectinload

    stmt = (
        select(Booking)
        .where(Booking.hotel_id == hotel_id, Booking.status == "checked_in")
        .order_by(Booking.check_out_date)
    )
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
        stmt.options(selectinload(Booking.rooms)).limit(limit).offset(offset)
    )
    bookings = list(result.scalars().all())
    if not bookings:
        return [], total

    booking_ids = [b.id for b in bookings]

    # Batch 1: check-ins for all current bookings.
    ci_rows = (await db.execute(
        select(CheckIn).where(CheckIn.booking_id.in_(booking_ids))
    )).scalars().all()
    checkins_by_booking: dict[UUID, CheckIn] = {ci.booking_id: ci for ci in ci_rows}

    # Batch 2: primary guests.
    guest_ids_set = {b.primary_guest_id for b in bookings if b.primary_guest_id}
    guests_by_id: dict[UUID, Guest] = {}
    if guest_ids_set:
        g_rows = (await db.execute(
            select(Guest).where(Guest.id.in_(guest_ids_set))
        )).scalars().all()
        guests_by_id = {g.id: g for g in g_rows}

    # Batch 3: room numbers for all current allocations.
    all_room_ids: set[UUID] = set()
    for b in bookings:
        for br in b.rooms:
            if br.is_current:
                all_room_ids.add(br.room_id)
    room_numbers_by_id: dict[UUID, str] = {}
    if all_room_ids:
        r_rows = (await db.execute(
            select(Room.id, Room.room_number).where(Room.id.in_(all_room_ids))
        )).all()
        room_numbers_by_id = {row.id: row.room_number for row in r_rows}

    # Batch 4: registration counts per booking.
    reg_count_rows = (await db.execute(
        select(GuestRegistration.booking_id, func.count().label("cnt"))
        .where(GuestRegistration.booking_id.in_(booking_ids))
        .group_by(GuestRegistration.booking_id)
    )).all()
    reg_counts: dict[UUID, int] = {row.booking_id: row.cnt for row in reg_count_rows}

    items: list[CurrentGuestOut] = []
    for booking in bookings:
        checkin = checkins_by_booking.get(booking.id)
        guest = guests_by_id.get(booking.primary_guest_id) if booking.primary_guest_id else None
        room_nums = [
            room_numbers_by_id[br.room_id]
            for br in booking.rooms
            if br.is_current and br.room_id in room_numbers_by_id
        ]
        items.append(
            CurrentGuestOut(
                booking_id=booking.id,
                booking_number=booking.booking_number,
                primary_guest_name=guest.full_name if guest else "—",
                primary_guest_phone_masked=_mask(guest.normalized_phone) if guest else "",
                rooms=room_nums,
                checked_in_at=checkin.checked_in_at if checkin else booking.created_at,
                expected_checkout_at=checkin.expected_checkout_at if checkin else None,
                check_out_date=booking.check_out_date,
                payment_status=booking.payment_status,
                due_amount=booking.due_amount,
                guest_count=max(reg_counts.get(booking.id, 0), 1),
            )
        )
    return items, total


async def transfer_room(
    db: AsyncSession,
    tenant: TenantContext,
    body: RoomTransferRequest,
    *,
    correlation_id: str | None = None,
) -> RoomTransferOut:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, body.booking_id)
    if booking.status != "checked_in":
        raise ValidationAppError(
            "Room transfer requires an active (checked-in) stay", code="not_checked_in"
        )

    current = next(
        (br for br in booking.rooms if br.is_current and br.room_id == body.from_room_id),
        None,
    )
    if current is None:
        raise ValidationAppError(
            "The source room is not part of this stay", code="room_not_in_stay"
        )
    if body.from_room_id == body.to_room_id:
        raise ValidationAppError("Source and target rooms are the same", code="same_room")

    result = await db.execute(
        select(Room)
        .where(Room.hotel_id == hotel_id, Room.id.in_([body.from_room_id, body.to_room_id]))
        .order_by(Room.id)
        .with_for_update()
    )
    rooms = {room.id: room for room in result.scalars().all()}
    if len(rooms) != 2:
        raise NotFoundError("Room not found")
    from_room, to_room = rooms[body.from_room_id], rooms[body.to_room_id]

    from app.domain.room_status import is_allocatable

    if not is_allocatable(to_room.status):
        raise ConflictError(
            f"Target room is not available (status: {to_room.status})",
            code="room_not_allocatable",
        )

    # History-preserving: old allocation flagged non-current, new row inserted.
    current.is_current = False
    db.add(
        BookingRoom(
            hotel_id=hotel_id,
            booking_id=booking.id,
            room_id=to_room.id,
            room_type_id=to_room.room_type_id,
            rate=current.rate,
            is_current=True,
        )
    )
    from app.services.housekeeping import ensure_task_for_room

    assert_transition(from_room.status, RoomStatus.CLEANING_REQUIRED)
    from_room.status = RoomStatus.CLEANING_REQUIRED.value
    await ensure_task_for_room(
        db, hotel_id=hotel_id, room_id=from_room.id, booking_id=booking.id
    )
    assert_transition(to_room.status, RoomStatus.OCCUPIED)
    to_room.status = RoomStatus.OCCUPIED.value

    transfer = RoomTransfer(
        hotel_id=hotel_id,
        booking_id=booking.id,
        from_room_id=from_room.id,
        to_room_id=to_room.id,
        transferred_at=_now(),
        reason=body.reason,
        performed_by_id=tenant.user_id,
    )
    db.add(transfer)
    await db.flush()
    await write_audit(
        db,
        action="stay.room_transferred",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "from": from_room.room_number,
            "to": to_room.room_number,
            "reason": body.reason,
        },
        correlation_id=correlation_id,
    )
    return RoomTransferOut(
        id=transfer.id,
        booking_id=booking.id,
        from_room_number=from_room.room_number,
        to_room_number=to_room.room_number,
        transferred_at=transfer.transferred_at,
        reason=transfer.reason,
    )


async def check_out(
    db: AsyncSession,
    tenant: TenantContext,
    body: CheckOutRequest,
    *,
    correlation_id: str | None = None,
) -> CheckOutOut:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, body.booking_id)
    if booking.status != "checked_in":
        raise ValidationAppError(
            "Only checked-in bookings can be checked out", code="not_checked_in"
        )

    nights = max((booking.check_out_date - booking.check_in_date).days, 1)
    final_total = booking.total_amount + body.late_fee
    paid = booking.advance_amount
    # Security deposit is applied against the final bill.
    effective_paid = paid + booking.security_deposit
    due = max(final_total - effective_paid, Decimal("0.00"))
    refund = max(effective_paid - final_total, Decimal("0.00"))

    if due > 0 and not body.allow_due:
        raise ConflictError(
            f"Outstanding balance of {due} must be collected or explicitly "
            "authorized as payment-due",
            code="balance_due",
        )
    if due > 0 and body.allow_due and not body.due_reason:
        raise ValidationAppError(
            "A reason is required to authorize checkout with dues", code="due_reason_required"
        )

    rooms = await _current_rooms_locked(db, booking)
    from app.services.housekeeping import ensure_task_for_room

    for room in rooms:
        assert_transition(room.status, RoomStatus.CLEANING_REQUIRED)
        room.status = RoomStatus.CLEANING_REQUIRED.value
        await ensure_task_for_room(
            db, hotel_id=hotel_id, room_id=room.id, booking_id=booking.id
        )

    if body.late_fee > 0:
        from app.services.ledger import append_entry

        await append_entry(
            db,
            hotel_id=hotel_id,
            booking_id=booking.id,
            entry_type="debit",
            amount=body.late_fee,
            description="Late checkout fee",
            reference_type="checkout_fee",
            created_by_id=tenant.user_id,
        )

    checkout = CheckOut(
        hotel_id=hotel_id,
        booking_id=booking.id,
        checked_out_at=body.checked_out_at or _now(),
        is_late=body.is_late,
        late_fee=body.late_fee,
        nights=nights,
        final_total=final_total,
        paid_amount=paid,
        due_amount=due,
        refund_amount=refund,
        payment_due_authorized=due > 0,
        payment_due_reason=body.due_reason if due > 0 else None,
        authorized_by_id=tenant.user_id if due > 0 else None,
        performed_by_id=tenant.user_id,
    )
    db.add(checkout)
    booking.status = "checked_out"
    booking.total_amount = final_total
    booking.due_amount = due
    if due == 0 and refund == 0:
        booking.payment_status = "paid"
    elif paid > 0:
        booking.payment_status = "partial"
    await db.flush()
    await write_audit(
        db,
        action="stay.checked_out",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking_number": booking.booking_number,
            "final_total": str(final_total),
            "due": str(due),
            "refund": str(refund),
        },
        correlation_id=correlation_id,
    )
    from app.models.guest import Guest as _Guest
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    _g = await db.get(_Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    gname = _g.full_name if _g else "Guest"
    # Use actual room numbers from the already-locked rooms list.
    room_strs = ", ".join(r.room_number for r in rooms)
    event = NE.DUE_ON_CHECKOUT if due > 0 else NE.CHECKOUT_COMPLETED
    await _fire(db, hotel_id=hotel_id, event=event, data={
        "guest_name": gname,
        "booking_number": booking.booking_number,
        "rooms": room_strs,
        "due_amount": str(due),
    })
    return CheckOutOut(
        id=checkout.id,
        booking_id=booking.id,
        booking_number=booking.booking_number,
        checked_out_at=checkout.checked_out_at,
        nights=nights,
        final_total=final_total,
        paid_amount=paid,
        due_amount=due,
        refund_amount=refund,
        is_late=body.is_late,
        late_fee=body.late_fee,
        payment_due_authorized=checkout.payment_due_authorized,
    )


async def reverse_checkout(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    reason: str,
    *,
    correlation_id: str | None = None,
) -> CheckOutOut:
    """Reopen a completed checkout — restricted to roles with CHECKOUT + audit."""
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, booking_id)
    if booking.status != "checked_out":
        raise ValidationAppError("Booking is not checked out", code="not_checked_out")

    result = await db.execute(
        select(CheckOut)
        .where(CheckOut.booking_id == booking.id, CheckOut.is_reversed.is_(False))
        .order_by(CheckOut.created_at.desc())
    )
    checkout = result.scalars().first()
    if checkout is None:
        raise NotFoundError("Checkout record not found")

    rooms = await _current_rooms_locked(db, booking)
    for room in rooms:
        # The room may already be under cleaning; reversal reclaims it.
        if room.status not in (
            RoomStatus.CLEANING_REQUIRED.value,
            RoomStatus.CLEANING_IN_PROGRESS.value,
            RoomStatus.CLEAN_READY.value,
            RoomStatus.AVAILABLE.value,
        ):
            raise ConflictError(
                f"Room {room.room_number} can no longer be reclaimed "
                f"(status: {room.status})",
                code="room_not_reclaimable",
            )
        room.status = RoomStatus.OCCUPIED.value

    checkout.is_reversed = True
    checkout.reversed_at = _now()
    checkout.reverse_reason = reason
    booking.status = "checked_in"
    await write_audit(
        db,
        action="stay.checkout_reversed",
        entity_type="booking",
        entity_id=booking.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"reason": reason},
        correlation_id=correlation_id,
    )
    return CheckOutOut(
        id=checkout.id,
        booking_id=booking.id,
        booking_number=booking.booking_number,
        checked_out_at=checkout.checked_out_at,
        nights=checkout.nights,
        final_total=checkout.final_total,
        paid_amount=checkout.paid_amount,
        due_amount=checkout.due_amount,
        refund_amount=checkout.refund_amount,
        is_late=checkout.is_late,
        late_fee=checkout.late_fee,
        payment_due_authorized=checkout.payment_due_authorized,
    )
