"""Checkout-overdue detection.

The Current Guests screen shows a red "Overdue" badge computed client-side.
This module is the server-side counterpart: a periodic sweep that fires ONE
notification per overdue stay so the team is alerted even when nobody has the
page open.

Rules (kept identical to the frontend badge so they can never disagree):
- A stay is overdue when `check_out_date` + `check_out_time` (falling back to
  23:59 when no time is set — never alert early) has passed in the HOTEL's
  timezone.
- Alert-only: no auto-checkout (explicit client decision).
- Durable dedupe via `Booking.overdue_notified_at` — one alert per stay, ever.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_FALLBACK_TIME = "23:59"
SWEEP_INTERVAL_SECONDS = 15 * 60


def is_checkout_overdue(
    check_out_date,  # datetime.date
    check_out_time: str | None,
    hotel_tz: str,
    *,
    now_utc: datetime | None = None,
) -> bool:
    """Pure rule: has the expected checkout moment passed in the hotel's tz?

    Mirrors the frontend badge exactly: missing/blank time falls back to 23:59
    so a guest is never flagged before their day is actually over.
    """
    try:
        tz = ZoneInfo(hotel_tz)
    except (KeyError, ValueError):
        try:
            tz = ZoneInfo("Asia/Kolkata")
        except (KeyError, ValueError):  # no tz database at all — fixed IST
            from datetime import timedelta, timezone

            tz = timezone(timedelta(hours=5, minutes=30))  # type: ignore[assignment]
    raw_time = (check_out_time or "").strip() or _FALLBACK_TIME
    try:
        hour, minute = (int(p) for p in raw_time.split(":")[:2])
    except ValueError:
        hour, minute = 23, 59
    due = datetime(
        check_out_date.year,
        check_out_date.month,
        check_out_date.day,
        hour,
        minute,
        tzinfo=tz,
    )
    now = (now_utc or datetime.now(UTC)).astimezone(tz)
    return now > due


async def sweep_overdue_checkouts(
    db: AsyncSession, *, now_utc: datetime | None = None
) -> int:
    """Notify (once) for every checked-in stay whose checkout moment passed.

    Returns the number of notifications fired. Commits its own work.
    """
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.room import Room
    from app.services.notification_events import NE, fire

    now = now_utc or datetime.now(UTC)

    # Candidates: in-house, not yet notified, checkout date not in the future
    # (anywhere on earth "not in the future" ≈ date <= max local date; a one-day
    # buffer keeps the query cheap while the tz-exact check happens in Python).
    result = await db.execute(
        select(Booking, Hotel.timezone, Hotel.name)
        .join(Hotel, Hotel.id == Booking.hotel_id)
        .where(
            Booking.status == "checked_in",
            Booking.overdue_notified_at.is_(None),
            Booking.check_out_date <= now.date(),
        )
    )
    rows = result.all()
    fired = 0
    for booking, hotel_tz, _hotel_name in rows:
        if not is_checkout_overdue(
            booking.check_out_date, booking.check_out_time, hotel_tz, now_utc=now
        ):
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
        expected_time = (booking.check_out_time or "").strip() or _FALLBACK_TIME
        expected = (
            f"{booking.check_out_date.strftime('%d/%m/%Y')}, {expected_time}"
        )

        await fire(
            db,
            hotel_id=booking.hotel_id,
            event=NE.CHECKOUT_OVERDUE,
            data={
                "guest_name": guest.full_name if guest else "Guest",
                "rooms": room_numbers,
                "expected": expected,
                "booking_number": booking.booking_number,
            },
        )
        booking.overdue_notified_at = now
        fired += 1

    if fired:
        await db.commit()
    return fired


async def overdue_sweep_loop() -> None:
    """Background loop started from the app lifespan.

    Sleeps FIRST so short-lived processes (tests, migrations, health checks)
    never execute a sweep; each cycle uses a fresh session and swallows errors
    so a transient DB failure can't kill the loop.
    """
    from app.db.session import AsyncSessionLocal

    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        try:
            async with AsyncSessionLocal() as session:
                fired = await sweep_overdue_checkouts(session)
                if fired:
                    logger.info("overdue sweep: %d notification(s) fired", fired)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("overdue sweep failed; will retry next cycle")
