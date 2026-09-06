"""Proactive reminder sweeps.

Fired from background loops (similar to overdue.py):
1. arrival_today_sweep   — Notifies front-desk once per confirmed booking
   whose check_in_date is today in the hotel's timezone.
2. checkout_reminder_sweep — Notifies once per in-house stay that will check
   out within the next 2 hours.
3. low_availability_sweep  — Notifies once per day per hotel when available
   rooms drop below 20% of total capacity.

All three sweeps commit their own work and return the number of notifications
fired.  They are designed to be run on short intervals (every 15–30 min) and
use dedup columns (arrival_notified_at / checkout_reminded_at) or daily
timestamps to avoid repeated pings.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 15 * 60
_CHECKOUT_REMIND_BEFORE_MINUTES = 120  # fire when ≤ 2 hours before checkout


# ── Arrival today ────────────────────────────────────────────────────────────

async def sweep_arrival_today(
    db: AsyncSession,
    *,
    now_utc: datetime | None = None,
) -> int:
    """Fire once per confirmed booking whose check-in day is today (hotel tz)."""
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.room import Room
    from app.services.notification_events import NE, fire

    now = now_utc or datetime.now(UTC)

    result = await db.execute(
        select(Booking, Hotel.timezone, Hotel.name)
        .join(Hotel, Hotel.id == Booking.hotel_id)
        .where(
            Booking.status == "confirmed",
            Booking.arrival_notified_at.is_(None),
        )
    )
    rows = result.all()
    fired = 0
    for booking, hotel_tz, _hotel_name in rows:
        try:
            tz = ZoneInfo(hotel_tz)
        except (KeyError, ValueError):
            tz = ZoneInfo("Asia/Kolkata")
        hotel_today = now.astimezone(tz).date()
        if booking.check_in_date != hotel_today:
            continue  # not arriving today in this hotel's tz

        guest = (
            await db.get(Guest, booking.primary_guest_id)
            if booking.primary_guest_id
            else None
        )
        rooms_result = await db.execute(
            select(Room.room_number)
            .join(BookingRoom, BookingRoom.room_id == Room.id)
            .where(
                BookingRoom.booking_id == booking.id,
                BookingRoom.is_current.is_(True),
            )
        )
        room_numbers = ", ".join(rooms_result.scalars()) or "—"
        check_in_time = (booking.check_in_time or "").strip() or "—"

        await fire(
            db,
            hotel_id=booking.hotel_id,
            event=NE.ARRIVAL_TODAY,
            data={
                "booking_number": booking.booking_number,
                "guest_name": guest.full_name if guest else "Guest",
                "check_in_time": check_in_time,
                "rooms": room_numbers,
                "booking_id": str(booking.id),
            },
        )
        booking.arrival_notified_at = now
        fired += 1

    if fired:
        await db.commit()
    return fired


# ── Checkout reminder ─────────────────────────────────────────────────────────

async def sweep_checkout_reminders(
    db: AsyncSession,
    *,
    now_utc: datetime | None = None,
) -> int:
    """Fire once per in-house stay whose checkout is within the next 2 hours."""
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.room import Room
    from app.services.notification_events import NE, fire

    now = now_utc or datetime.now(UTC)
    remind_cutoff = now + timedelta(minutes=_CHECKOUT_REMIND_BEFORE_MINUTES)

    result = await db.execute(
        select(Booking, Hotel.timezone)
        .join(Hotel, Hotel.id == Booking.hotel_id)
        .where(
            Booking.status == "checked_in",
            Booking.checkout_reminded_at.is_(None),
        )
    )
    rows = result.all()
    fired = 0

    for booking, hotel_tz in rows:
        try:
            tz = ZoneInfo(hotel_tz)
        except (KeyError, ValueError):
            tz = ZoneInfo("Asia/Kolkata")
        raw_time = (booking.check_out_time or "").strip() or "23:59"
        try:
            hour, minute = (int(p) for p in raw_time.split(":")[:2])
        except ValueError:
            hour, minute = 23, 59

        from datetime import datetime as _dt
        checkout_dt = _dt(
            booking.check_out_date.year,
            booking.check_out_date.month,
            booking.check_out_date.day,
            hour,
            minute,
            tzinfo=tz,
        ).astimezone(UTC)

        # Fire only if checkout is in the future but within the reminder window.
        if not (now < checkout_dt <= remind_cutoff):
            continue

        guest = (
            await db.get(Guest, booking.primary_guest_id)
            if booking.primary_guest_id
            else None
        )
        rooms_result = await db.execute(
            select(Room.room_number)
            .join(BookingRoom, BookingRoom.room_id == Room.id)
            .where(
                BookingRoom.booking_id == booking.id,
                BookingRoom.is_current.is_(True),
            )
        )
        room_numbers = ", ".join(rooms_result.scalars()) or "—"

        await fire(
            db,
            hotel_id=booking.hotel_id,
            event=NE.CHECKOUT_REMINDER,
            data={
                "guest_name": guest.full_name if guest else "Guest",
                "rooms": room_numbers,
                "check_out_time": raw_time,
                "booking_number": booking.booking_number,
                "booking_id": str(booking.id),
            },
        )
        booking.checkout_reminded_at = now
        fired += 1

    if fired:
        await db.commit()
    return fired


# ── Low room availability ─────────────────────────────────────────────────────

async def sweep_low_availability(
    db: AsyncSession,
    *,
    now_utc: datetime | None = None,
) -> int:
    """Fire once per hotel per day when available rooms drop below 20%."""
    from app.models.hotel import Hotel
    from app.models.room import Room
    from app.services.notifications import create_notification
    from app.services.notification_events import NE, fire

    now = now_utc or datetime.now(UTC)

    hotels = (
        await db.execute(select(Hotel).where(Hotel.status == "active"))
    ).scalars().all()
    fired = 0

    for hotel in hotels:
        # Count rooms by status
        rooms = (
            await db.execute(
                select(Room.status)
                .where(Room.hotel_id == hotel.id, Room.is_active.is_(True))
            )
        ).scalars().all()

        total = len(rooms)
        if total == 0:
            continue

        available = sum(1 for s in rooms if s == "available")
        occupied = sum(1 for s in rooms if s == "occupied")
        reserved = sum(1 for s in rooms if s == "reserved")
        pct = Decimal(available) / Decimal(total) * 100

        if pct >= 20:
            continue  # no alert needed

        # Check if we already fired today for this hotel.
        # Notification is in app.models.platform (same module as Subscription etc.)
        from app.models.platform import Notification as _Notif  # noqa: PLC0415
        from datetime import timezone as _tz_mod  # noqa: PLC0415

        day_start = now.astimezone(_tz_mod.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        notif_check = await db.execute(
            select(func.count())
            .select_from(_Notif)
            .where(
                _Notif.hotel_id == hotel.id,
                _Notif.type == NE.LOW_ROOM_AVAILABILITY.value,
                _Notif.created_at >= day_start,
            )
        )
        if (notif_check.scalar() or 0) > 0:
            continue  # already fired today

        await fire(
            db,
            hotel_id=hotel.id,
            event=NE.LOW_ROOM_AVAILABILITY,
            data={
                "available": available,
                "total": total,
                "occupied": occupied,
                "reserved": reserved,
            },
        )
        fired += 1

    if fired:
        await db.commit()
    return fired


# ── Background loop ───────────────────────────────────────────────────────────

async def reminders_loop() -> None:
    """Background loop: arrival + checkout reminder sweeps every 15 min."""
    from app.db.session import AsyncSessionLocal

    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        for sweep_fn in (sweep_arrival_today, sweep_checkout_reminders):
            try:
                async with AsyncSessionLocal() as session:
                    fired = await sweep_fn(session)
                    if fired:
                        logger.info(
                            "%s: %d notification(s) fired",
                            sweep_fn.__name__,
                            fired,
                        )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("%s failed; will retry next cycle", sweep_fn.__name__)


async def low_availability_loop() -> None:
    """Background loop: low-room-availability alert once per 30 min."""
    from app.db.session import AsyncSessionLocal

    while True:
        await asyncio.sleep(30 * 60)
        try:
            async with AsyncSessionLocal() as session:
                fired = await sweep_low_availability(session)
                if fired:
                    logger.info("low_availability: %d notification(s) fired", fired)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("low_availability sweep failed; will retry")
