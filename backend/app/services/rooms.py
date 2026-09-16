from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.room_status import RoomStatus, assert_transition
from app.models.booking import Booking, BookingRoom
from app.models.room import Room, RoomAmenity, RoomType
from app.schemas.room import (
    RoomAvailabilityOut,
    RoomAvailableItem,
    RoomCreate,
    RoomOut,
    RoomStatusUpdate,
    RoomTypeCreate,
    RoomTypeUpdate,
    RoomUnavailableItem,
    RoomUpdate,
)
from app.services.audit import write_audit

_ACTIVE_BOOKING_STATUSES = ("pending", "confirmed", "checked_in")

# Statuses that would make a room look vacant / bookable.
_FREEING_STATUSES = frozenset(
    {
        RoomStatus.AVAILABLE.value,
        RoomStatus.CLEAN_READY.value,
    }
)


async def hotel_today(db: AsyncSession, hotel_id: UUID) -> date:
    """Today's date in the HOTEL's timezone (server runs UTC; a same-day
    decision made between 00:00–05:30 IST would otherwise use yesterday)."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _Zi

    from app.models.hotel import Hotel as _Hotel

    tz_name = await db.scalar(select(_Hotel.timezone).where(_Hotel.id == hotel_id))
    return _dt.now(_Zi(tz_name or "Asia/Kolkata")).date()


class _BookingContext:
    """Per-room derived reservation facts (room-status redesign, plan 15/09)."""

    __slots__ = (
        "arriving_today",
        "arrival_time",
        "next_booking_date",
        "next_booking_time",
        "departing_today",
        "departure_time",
    )

    def __init__(self) -> None:
        self.arriving_today = False
        self.arrival_time: str | None = None
        self.next_booking_date: date | None = None
        self.next_booking_time: str | None = None
        self.departing_today = False
        self.departure_time: str | None = None


async def _booking_context(
    db: AsyncSession, hotel_id: UUID, today: date
) -> dict[UUID, _BookingContext]:
    """One batched query: derive per-room reservation context from bookings.

    - arriving_today: a CONFIRMED booking whose stay window includes today
      (check_in <= today < effective checkout — covers late arrivals too).
    - next_booking: the earliest confirmed booking starting AFTER today.
    - departing_today: the current CHECKED-IN guest checks out today.
    Reservation state is always derived — never stored on the room — so it
    can never drift (multiple bookings, cancellations, edits all re-derive).
    """
    rows = await db.execute(
        select(
            BookingRoom.room_id,
            Booking.status,
            Booking.check_in_date,
            Booking.check_in_time,
            Booking.check_out_date,
            Booking.check_out_time,
        )
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.is_current.is_(True),
            Booking.status.in_(("confirmed", "checked_in")),
            # Anything already fully in the past is irrelevant.
            Booking.check_out_date >= today,
        )
    )
    ctx: dict[UUID, _BookingContext] = {}
    for room_id, status, ci_date, ci_time, co_date, co_time in rows.all():
        c = ctx.setdefault(room_id, _BookingContext())
        if status == "checked_in":
            if co_date == today:
                c.departing_today = True
                c.departure_time = co_time
            continue
        # status == "confirmed" (not yet checked in)
        # Day-use bookings have check_out == check_in; they still hold today.
        effective_out = max(co_date, ci_date)
        if ci_date <= today <= effective_out:
            c.arriving_today = True
            # Earliest arrival wins if several bookings arrive today.
            if c.arrival_time is None or (ci_time or "99:99") < (c.arrival_time or "99:99"):
                c.arrival_time = ci_time
        elif ci_date > today and (
            c.next_booking_date is None or ci_date < c.next_booking_date
        ):
            c.next_booking_date = ci_date
            c.next_booking_time = ci_time
    return ctx


async def has_in_house_guest(
    db: AsyncSession, hotel_id: UUID, room_id: UUID
) -> bool:
    """True if a checked-in booking currently occupies this room.

    Occupancy is defined by the booking workflow, not by the room.status
    column — staff can walk an occupied room through cleaning, but the
    guest is still in-house until checkout.
    """
    result = await db.execute(
        select(Booking.id)
        .join(BookingRoom, BookingRoom.booking_id == Booking.id)
        .where(
            Booking.hotel_id == hotel_id,
            Booking.status == "checked_in",
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.room_id == room_id,
            BookingRoom.is_current.is_(True),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


def _room_out(room: Room, ctx: _BookingContext | None = None) -> RoomOut:
    return RoomOut(
        id=room.id,
        room_number=room.room_number,
        floor=room.floor,
        bed_type=room.bed_type,
        max_adults=room.max_adults,
        max_children=room.max_children,
        status=room.status,
        is_active=room.is_active,
        notes=room.notes,
        room_type_id=room.room_type_id,
        room_type_name=room.room_type.name if room.room_type else None,
        amenities=[a.name for a in room.amenities],
        arriving_today=ctx.arriving_today if ctx else False,
        arrival_time=ctx.arrival_time if ctx else None,
        next_booking_date=ctx.next_booking_date if ctx else None,
        next_booking_time=ctx.next_booking_time if ctx else None,
        departing_today=ctx.departing_today if ctx else False,
        departure_time=ctx.departure_time if ctx else None,
    )


# --- Room types -----------------------------------------------------------------


async def list_room_types(
    db: AsyncSession, tenant: TenantContext, *, include_inactive: bool = False
) -> tuple[list[RoomType], int]:
    hotel_id = tenant.require_hotel()
    query = select(RoomType).where(RoomType.hotel_id == hotel_id)
    if not include_inactive:
        query = query.where(RoomType.is_active.is_(True))
    result = await db.execute(query.order_by(RoomType.name))
    items = list(result.scalars().all())
    return items, len(items)


async def get_room_type(db: AsyncSession, tenant: TenantContext, type_id: UUID) -> RoomType:
    result = await db.execute(
        select(RoomType).where(
            RoomType.id == type_id, RoomType.hotel_id == tenant.require_hotel()
        )
    )
    room_type = result.scalar_one_or_none()
    if room_type is None:
        raise NotFoundError("Room type not found")
    return room_type


async def create_room_type(
    db: AsyncSession,
    tenant: TenantContext,
    body: RoomTypeCreate,
    *,
    correlation_id: str | None = None,
) -> RoomType:
    hotel_id = tenant.require_hotel()
    existing = await db.execute(
        select(RoomType).where(
            RoomType.hotel_id == hotel_id, RoomType.code == body.code
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictError("A room type with this code already exists", code="duplicate_code")
    room_type = RoomType(hotel_id=hotel_id, **body.model_dump())
    db.add(room_type)
    await db.flush()
    await write_audit(
        db,
        action="rooms.type_created",
        entity_type="room_type",
        entity_id=room_type.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"code": body.code, "name": body.name, "base_price": str(body.base_price)},
        correlation_id=correlation_id,
    )
    return room_type


async def update_room_type(
    db: AsyncSession,
    tenant: TenantContext,
    type_id: UUID,
    body: RoomTypeUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomType:
    room_type = await get_room_type(db, tenant, type_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: str(getattr(room_type, k)) for k in changes}
    for key, value in changes.items():
        setattr(room_type, key, value)
    if changes:
        await write_audit(
            db,
            action="rooms.type_updated",
            entity_type="room_type",
            entity_id=room_type.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=correlation_id,
        )
    return room_type


async def delete_room_type(
    db: AsyncSession,
    tenant: TenantContext,
    type_id: UUID,
    *,
    correlation_id: str | None = None,
) -> None:
    """Soft-delete a room type (client 16/09: 'Missing delete icon').

    SOFT delete (is_active=False): historical bookings reference the type via
    BookingRoom.room_type_id, so a hard DELETE would break invoices/reports.
    Blocked while any ACTIVE room still uses the type — staff must delete or
    re-type those rooms first, otherwise they would silently lose pricing.
    """
    room_type = await get_room_type(db, tenant, type_id)
    in_use = (
        await db.execute(
            select(func.count())
            .select_from(Room)
            .where(
                Room.hotel_id == tenant.require_hotel(),
                Room.room_type_id == type_id,
                Room.is_active.is_(True),
            )
        )
    ).scalar_one()
    if in_use:
        raise ConflictError(
            f"'{room_type.name}' is used by {in_use} room(s). "
            "Delete or re-assign those rooms first.",
            code="room_type_in_use",
        )
    room_type.is_active = False
    await write_audit(
        db,
        action="rooms.type_deleted",
        entity_type="room_type",
        entity_id=room_type.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"name": room_type.name, "is_active": "True"},
        after={"is_active": "False"},
        correlation_id=correlation_id,
    )


# --- Rooms ----------------------------------------------------------------------


ROOM_LOAD_OPTIONS = (selectinload(Room.room_type), selectinload(Room.amenities))


async def list_rooms(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    status: str | None = None,
    room_type_id: UUID | None = None,
    include_inactive: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RoomOut], int]:
    hotel_id = tenant.require_hotel()
    query = select(Room).where(Room.hotel_id == hotel_id)
    if status:
        query = query.where(Room.status == status)
    if room_type_id:
        query = query.where(Room.room_type_id == room_type_id)
    if not include_inactive:
        query = query.where(Room.is_active.is_(True))
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    result = await db.execute(
        query.options(*ROOM_LOAD_OPTIONS)
        .order_by(Room.room_number)
        .limit(limit)
        .offset(offset)
    )
    rooms = list(result.scalars().all())

    # Derived reservation context (arriving today / next booking / departing) —
    # one batched query, hotel-local today (plan 15/09 room-status redesign).
    today = await hotel_today(db, hotel_id)
    ctx = await _booking_context(db, hotel_id, today)
    return [_room_out(r, ctx.get(r.id)) for r in rooms], total


async def get_room(db: AsyncSession, tenant: TenantContext, room_id: UUID) -> Room:
    result = await db.execute(
        select(Room)
        .options(*ROOM_LOAD_OPTIONS)
        .where(Room.id == room_id, Room.hotel_id == tenant.require_hotel())
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room not found")
    return room


async def create_room(
    db: AsyncSession,
    tenant: TenantContext,
    body: RoomCreate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    hotel_id = tenant.require_hotel()
    room_type = await get_room_type(db, tenant, body.room_type_id)
    existing = await db.execute(
        select(Room).where(Room.hotel_id == hotel_id, Room.room_number == body.room_number)
    )
    if existing.scalar_one_or_none():
        raise ConflictError("A room with this number already exists", code="duplicate_room")
    room = Room(
        hotel_id=hotel_id,
        room_type_id=room_type.id,
        room_number=body.room_number,
        floor=body.floor,
        bed_type=body.bed_type,
        max_adults=body.max_adults,
        max_children=body.max_children,
        notes=body.notes,
        status=RoomStatus.AVAILABLE.value,
    )
    db.add(room)
    await db.flush()
    for name in dict.fromkeys(body.amenities):
        db.add(RoomAmenity(hotel_id=hotel_id, room_id=room.id, name=name))
    await db.flush()
    await write_audit(
        db,
        action="rooms.created",
        entity_type="room",
        entity_id=room.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"room_number": body.room_number, "room_type": room_type.code},
        correlation_id=correlation_id,
    )
    return _room_out(await get_room(db, tenant, room.id))


async def update_room(
    db: AsyncSession,
    tenant: TenantContext,
    room_id: UUID,
    body: RoomUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    room = await get_room(db, tenant, room_id)
    changes = body.model_dump(exclude_unset=True)
    amenities = changes.pop("amenities", None)

    if "room_number" in changes and changes["room_number"] != room.room_number:
        dup = await db.execute(
            select(Room).where(
                Room.hotel_id == room.hotel_id,
                Room.room_number == changes["room_number"],
                Room.id != room.id,
            )
        )
        if dup.scalar_one_or_none():
            raise ConflictError("A room with this number already exists", code="duplicate_room")

    if "room_type_id" in changes:
        await get_room_type(db, tenant, changes["room_type_id"])

    before = {k: str(getattr(room, k)) for k in changes}
    for key, value in changes.items():
        setattr(room, key, value)

    if amenities is not None:
        for amenity in list(room.amenities):
            await db.delete(amenity)
        await db.flush()
        for name in dict.fromkeys(amenities):
            db.add(RoomAmenity(hotel_id=room.hotel_id, room_id=room.id, name=name))
        await db.flush()

    if changes or amenities is not None:
        await write_audit(
            db,
            action="rooms.updated",
            entity_type="room",
            entity_id=room.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=correlation_id,
        )
    return _room_out(await get_room(db, tenant, room.id))


async def delete_room(
    db: AsyncSession,
    tenant: TenantContext,
    room_id: UUID,
    *,
    correlation_id: str | None = None,
) -> None:
    """Hard-delete a room. Refused if any booking ever referenced it."""
    room = await get_room(db, tenant, room_id)

    booked = await db.execute(
        select(func.count())
        .select_from(BookingRoom)
        .where(BookingRoom.room_id == room.id)
    )
    if booked.scalar_one() > 0:
        raise ConflictError(
            "Room has bookings and cannot be deleted. Mark it inactive instead.",
            code="room_has_bookings",
        )

    room_number = room.room_number
    try:
        await db.delete(room)
        await db.flush()
    except Exception as exc:  # FK from housekeeping/payment history etc.
        from sqlalchemy.exc import IntegrityError

        if isinstance(exc, IntegrityError):
            raise ConflictError(
                "Room is referenced by other records and cannot be deleted. "
                "Mark it inactive instead.",
                code="room_in_use",
            ) from exc
        raise

    await write_audit(
        db,
        action="rooms.deleted",
        entity_type="room",
        entity_id=room_id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"room_number": room_number},
        correlation_id=correlation_id,
    )


async def update_room_status(
    db: AsyncSession,
    tenant: TenantContext,
    room_id: UUID,
    body: RoomStatusUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    room = await get_room(db, tenant, room_id)
    if not room.is_active:
        raise ValidationAppError("Room is inactive", code="room_inactive")
    old_status = room.status
    # Manual status changes must respect the state machine; booking/checkout
    # services perform their own transitions with the same rules.
    if RoomStatus(body.status) in {RoomStatus.OCCUPIED, RoomStatus.RESERVED}:
        raise ValidationAppError(
            "Occupied/Reserved are set by the booking workflow, not manually",
            code="workflow_status",
        )
    assert_transition(old_status, body.status)
    hotel_id = tenant.require_hotel()
    if body.status in _FREEING_STATUSES and await has_in_house_guest(
        db, hotel_id, room.id
    ):
        raise ValidationAppError(
            "A guest is still checked in to this room. It cannot be marked "
            "available until they check out.",
            code="room_has_in_house_guest",
        )
    room.status = body.status

    # Manual "needs cleaning" (including stayover) opens a housekeeping task
    # so staff can Start → Complete without a second create step.
    if body.status == RoomStatus.CLEANING_REQUIRED.value:
        from app.services.housekeeping import ensure_task_for_room

        await ensure_task_for_room(db, hotel_id=hotel_id, room_id=room.id)

    # Manual move to Available/Clean & Ready makes any open cleaning task
    # stale ("Start cleaning" shown for an already-ready room). Auto-cancel
    # open tasks so housekeeping reflects reality (client-reported bug).
    if body.status in (RoomStatus.AVAILABLE.value, RoomStatus.CLEAN_READY.value):
        from datetime import UTC as _UTC
        from datetime import datetime as _dt

        from app.models.ops import HousekeepingTask

        open_tasks = await db.execute(
            select(HousekeepingTask).where(
                HousekeepingTask.hotel_id == tenant.hotel_id,
                HousekeepingTask.room_id == room.id,
                HousekeepingTask.status.in_(
                    ("cleaning_required", "cleaning_in_progress", "inspection_required")
                ),
            )
        )
        for task in open_tasks.scalars():
            task.status = "cancelled"
            task.completed_at = _dt.now(_UTC)
            task.notes = (
                f"{task.notes} | " if task.notes else ""
            ) + "Auto-cancelled: room manually marked ready"

    await write_audit(
        db,
        action="rooms.status_changed",
        entity_type="room",
        entity_id=room.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"status": old_status},
        after={"status": body.status, "reason": body.reason},
        correlation_id=correlation_id,
    )
    return _room_out(room)


async def status_summary(db: AsyncSession, tenant: TenantContext) -> dict[str, int]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(Room.status, func.count())
        .where(Room.hotel_id == hotel_id, Room.is_active.is_(True))
        .group_by(Room.status)
    )
    return {row[0]: row[1] for row in result.all()}


# ── Date-aware availability ───────────────────────────────────────────────────


async def check_availability(
    db: AsyncSession,
    tenant: TenantContext,
    check_in: date,
    check_out: date,
) -> RoomAvailabilityOut:
    """Return all rooms split into available vs unavailable for the date window.

    Uses a single JOIN query to detect overlapping bookings in bulk — no N+1.
    Unavailable rooms are sorted by earliest free date so the UI can show
    'Room 102 free on Aug 8' before 'Room 101 free on Aug 12'.
    """
    hotel_id = tenant.require_hotel()

    # "Today" in the HOTEL's timezone (plan §5.2 / scenario S5): the server
    # runs on UTC, so date.today() would mis-classify same-day stays between
    # midnight and 05:30 IST. Same pattern as the attendance module.
    today_local = await hotel_today(db, hotel_id)

    # Step 1: all active rooms (eager-load type + amenities in one go)
    rooms_result = await db.execute(
        select(Room)
        .options(selectinload(Room.room_type), selectinload(Room.amenities))
        .where(Room.hotel_id == hotel_id, Room.is_active.is_(True))
        .order_by(Room.room_number)
    )
    all_rooms = list(rooms_result.scalars().all())

    # Step 1b: Batch query for currently checked-in guests per room.
    # Used to show "Free at HH:MM" on occupied rooms so staff can plan.
    # Only fetches rooms with status='checked_in' — O(1) extra query, no N+1.
    checkedin_result = await db.execute(
        select(
            BookingRoom.room_id,
            Booking.check_out_date,
            Booking.check_out_time,
        )
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.is_current.is_(True),
            Booking.status == "checked_in",
        )
    )
    # Map room_id → (checkout_date, checkout_time)
    current_checkout: dict[UUID, tuple[date, str | None]] = {
        row.room_id: (row.check_out_date, row.check_out_time)
        for row in checkedin_result.all()
    }

    # Step 2: single batch query — for every room, find overlapping bookings
    # and record the latest checkout date (= when the room will be free).
    # Day-use bookings (check_in == check_out) still block that calendar day,
    # so both sides of the comparison use an effective checkout ≥ in + 1 day.
    from datetime import timedelta as _td

    from sqlalchemy import literal as _lit

    effective_out = check_out if check_out > check_in else check_in + _td(days=1)
    stored_effective_out = func.greatest(
        Booking.check_out_date, Booking.check_in_date + _lit(1)
    )
    overlap_stmt = (
        select(
            BookingRoom.room_id,
            func.max(stored_effective_out).label("free_from"),
            func.count().label("booking_count"),
        )
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.is_current.is_(True),
            Booking.status.in_(_ACTIVE_BOOKING_STATUSES),
            # Overlap condition: [check_in, effective_out) intersects stored range
            Booking.check_in_date < effective_out,
            stored_effective_out > check_in,
        )
        .group_by(BookingRoom.room_id)
    )
    overlap_rows = (await db.execute(overlap_stmt)).all()
    overlaps: dict[UUID, tuple[date, int]] = {
        row.room_id: (row.free_from, row.booking_count) for row in overlap_rows
    }

    # Step 2b: for rooms free for the requested window, find the NEXT confirmed
    # booking starting on/after the requested checkout so the picker can show
    # "Booked from Sep 24, 14:00 — free for your dates" (redesign plan §4.3).
    next_stmt = (
        select(
            BookingRoom.room_id,
            func.min(Booking.check_in_date).label("next_ci"),
        )
        .join(Booking, Booking.id == BookingRoom.booking_id)
        .where(
            BookingRoom.hotel_id == hotel_id,
            BookingRoom.is_current.is_(True),
            Booking.status == "confirmed",
            Booking.check_in_date >= effective_out,
        )
        .group_by(BookingRoom.room_id)
    )
    next_dates: dict[UUID, date] = {
        row.room_id: row.next_ci for row in (await db.execute(next_stmt)).all()
    }
    # Fetch the check-in TIME of those next bookings (hour accuracy) in one go.
    next_times: dict[UUID, str | None] = {}
    if next_dates:
        time_rows = await db.execute(
            select(
                BookingRoom.room_id,
                Booking.check_in_date,
                Booking.check_in_time,
            )
            .join(Booking, Booking.id == BookingRoom.booking_id)
            .where(
                BookingRoom.hotel_id == hotel_id,
                BookingRoom.is_current.is_(True),
                Booking.status == "confirmed",
                Booking.check_in_date >= effective_out,
            )
        )
        for room_id, ci_date, ci_time in time_rows.all():
            if next_dates.get(room_id) == ci_date:
                # Earliest time wins when several bookings start that day.
                cur = next_times.get(room_id)
                if cur is None or (ci_time or "99:99") < (cur or "99:99"):
                    next_times[room_id] = ci_time

    available: list[RoomAvailableItem] = []
    unavailable: list[RoomUnavailableItem] = []

    for room in all_rooms:
        base_price = room.room_type.base_price if room.room_type else 0
        item_data = {
            "id": room.id,
            "room_number": room.room_number,
            "floor": room.floor,
            "bed_type": room.bed_type,
            "status": room.status,
            "is_active": room.is_active,
            "room_type_id": room.room_type_id,
            "room_type_name": room.room_type.name if room.room_type else None,
            "room_type_base_price": base_price,
            "room_type_hourly_rate": room.room_type.hourly_rate if room.room_type else None,
            "max_occupancy": room.room_type.max_occupancy if room.room_type else 2,
            "amenities": [a.name for a in room.amenities],
        }

        if room.id in overlaps:
            # Room has an active booking that overlaps the requested date window.
            # This is the only reliable signal for date-based unavailability.
            free_from, booking_count = overlaps[room.id]
            # Also surface the checkout TIME so UI can show "Free on Aug 8 at 11:00"
            co_date, co_time = current_checkout.get(room.id, (None, None))
            unavailable.append(
                RoomUnavailableItem(
                    **item_data,
                    unavailable_reason="booked",
                    occupied_until=free_from,
                    occupied_until_time=co_time,
                    overlapping_booking_count=booking_count,
                )
            )
        elif room.status in (RoomStatus.MAINTENANCE.value, RoomStatus.OUT_OF_SERVICE.value):
            # Physically broken — unavailable for ALL dates regardless of bookings.
            unavailable.append(
                RoomUnavailableItem(
                    **item_data,
                    unavailable_reason=room.status,
                    occupied_until=None,
                    occupied_until_time=None,
                    overlapping_booking_count=0,
                )
            )
        elif check_in <= today_local and room.id in current_checkout:
            # SAME-DAY rule (plan §5.2, client 15/09): the stay starts TODAY but
            # the room's current guest has NOT checked out yet — physically
            # occupied rooms must not be selectable for an immediate check-in.
            # (Their booking ends today, so the overlap query above misses it.)
            # Once the guest checks out, the room returns to the available list.
            co_date, co_time = current_checkout[room.id]
            unavailable.append(
                RoomUnavailableItem(
                    **item_data,
                    unavailable_reason="occupied",
                    occupied_until=co_date,
                    occupied_until_time=co_time,
                    overlapping_booking_count=1,
                )
            )
        elif check_in <= today_local and room.status == RoomStatus.CLEANING_IN_PROGRESS.value:
            # Same-day + housekeeping mid-clean → offered once cleaning is done
            # ("cleaning_required" stays selectable: it will be cleaned before
            # the guest arrives — that is the normal desk workflow).
            unavailable.append(
                RoomUnavailableItem(
                    **item_data,
                    unavailable_reason="cleaning",
                    occupied_until=None,
                    occupied_until_time=None,
                    overlapping_booking_count=0,
                )
            )
        else:
            # No overlapping booking + not physically broken = available.
            #
            # Rooms that are currently occupied, reserved, cleaning, or inspection
            # are shown as available when there is NO booking conflict for the
            # requested dates — a future booking can be created and the room will
            # be ready by the requested check-in.  The current physical status is
            # surfaced as `status` on the chip so staff can see it, but it does
            # NOT prevent the booking from being created.
            #
            # For currently-occupied available rooms, also surface the checkout
            # date+time so staff can tell the new guest "Room will be ready at X".
            co_date, co_time = current_checkout.get(room.id, (None, None))
            available.append(RoomAvailableItem(
                **item_data,
                current_checkout_date=co_date,
                current_checkout_time=co_time,
                next_booking_date=next_dates.get(room.id),
                next_booking_time=next_times.get(room.id),
            ))

    # Sort unavailable: "booked" rooms by earliest free date first
    # (best suggestions show at the top), then maintenance/oos last.
    def _sort_key(r: RoomUnavailableItem) -> tuple[int, date]:
        if r.occupied_until:
            return (0, r.occupied_until)
        return (1, date(9999, 12, 31))

    unavailable.sort(key=_sort_key)

    return RoomAvailabilityOut(
        check_in_date=check_in,
        check_out_date=check_out,
        available=available,
        unavailable=unavailable,
        total_rooms=len(all_rooms),
    )
