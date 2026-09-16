"""Checkout-overdue detection.

The Current Guests screen shows a red "Overdue" badge computed client-side.
This module is the server-side counterpart: a periodic sweep that fires ONE
notification per overdue stay so the team is alerted even when nobody has the
page open.

Rules (kept identical to the frontend badge so they can never disagree):
- A stay is overdue when `check_out_date` + `check_out_time` (falling back to
  23:59 when no time is set — never alert early) has passed in the HOTEL's
  timezone.
- Same-day overstays: alert-only. NEXT-DAY + fully paid: auto-checkout
  (client 16/09 — reversed the earlier alert-only decision; see
  sweep_auto_checkouts below).
- Durable dedupe via `Booking.overdue_notified_at` — one alert per stay, ever.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
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


async def sweep_auto_checkouts(
    db: AsyncSession, *, now_utc: datetime | None = None
) -> int:
    """NEXT-DAY AUTO-CHECKOUT (client 15-16/09: "as per our discussion next
    day automatically checkout" — reverses the earlier alert-only decision).

    Conservative money-safe rules:
    - Only stays whose expected checkout DATE is before hotel-local *today*
      (a full calendar day has passed — same-day overstays only get the
      overdue alert, staff may still be settling them at the desk).
    - Only FULLY-PAID stays: settlement due (excluding any late fee) must be
      zero. Stays with outstanding dues are never auto-checked-out — money
      must be collected by a human.
    - Uses the REAL check_out service, so invoices, housekeeping tasks, room
      statuses, ledger and audit all behave exactly like a manual checkout.
      allow_due=True covers a late-fee-only residue, recorded and audited as
      system-authorized.
    """
    from decimal import Decimal

    from app.core.tenant import TenantContext
    from app.models.booking import Booking
    from app.models.hotel import Hotel
    from app.schemas.stay import CheckOutRequest
    from app.services.stay import check_out, compute_settlement

    now = now_utc or datetime.now(UTC)
    # Plain COLUMNS (not ORM entities): the per-booking commit below expires
    # loaded entities, and touching an expired instance in async SQLAlchemy
    # raises MissingGreenlet. Each iteration re-fetches its Booking fresh.
    result = await db.execute(
        select(
            Booking.id,
            Booking.booking_number,
            Booking.check_out_date,
            Booking.created_by_id,
            Booking.hotel_id,
            Hotel.timezone,
        )
        .join(Hotel, Hotel.id == Booking.hotel_id)
        .where(
            Booking.status == "checked_in",
            # Cheap pre-filter; the exact hotel-local "full day past" check
            # happens below (UTC date is at most 1 day behind any local date).
            Booking.check_out_date < now.date() + timedelta(days=1),
        )
    )
    rows = result.all()
    done = 0
    for booking_id, number, co_date, created_by_id, hotel_id, hotel_tz in rows:
        try:
            tz = ZoneInfo(hotel_tz)
        except (KeyError, ValueError):
            tz = ZoneInfo("Asia/Kolkata")
        today_local = now.astimezone(tz).date()
        if co_date >= today_local:
            continue  # not a full day past yet

        if created_by_id is None:
            continue  # no actor to attribute the system action to (rare)

        try:
            from sqlalchemy.orm import selectinload

            booking = (
                await db.execute(
                    select(Booking)
                    .options(selectinload(Booking.rooms))  # compute_settlement reads them
                    .where(Booking.id == booking_id)
                )
            ).scalar_one_or_none()
            if booking is None or booking.status != "checked_in":
                continue
            settlement = await compute_settlement(db, booking, late_fee=Decimal("0.00"))
            if settlement["due"] > 0:
                continue  # outstanding dues — humans collect money, not cron
            tenant = TenantContext(
                user_id=created_by_id,
                hotel_id=hotel_id,
                role=None,
                is_super_admin=True,  # system action — bypass role checks
            )
            await check_out(
                db,
                tenant,
                CheckOutRequest(
                    booking_id=booking_id,
                    allow_due=True,
                    due_reason="Automatic next-day checkout (stay ended, fully paid)",
                ),
                correlation_id="auto-checkout-sweep",
            )
            await db.commit()
            done += 1
            logger.info(
                "auto-checkout: booking %s checked out (expected %s)", number, co_date
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            await db.rollback()
            logger.exception(
                "auto-checkout failed for booking %s; will retry next cycle",
                booking_id,
            )
    return done


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
        # Next-day auto-checkout (client 16/09) — runs on the same cadence,
        # its own session so a failure here never blocks the alert sweep.
        try:
            async with AsyncSessionLocal() as session:
                done = await sweep_auto_checkouts(session)
                if done:
                    logger.info("auto-checkout sweep: %d stay(s) checked out", done)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("auto-checkout sweep failed; will retry next cycle")
