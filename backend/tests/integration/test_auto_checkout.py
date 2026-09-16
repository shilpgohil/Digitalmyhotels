"""Next-day auto-checkout sweep (client 16/09).

Rules under test:
- A checked-in stay whose checkout DATE has fully passed (hotel-local) and
  which is FULLY PAID gets automatically checked out by the sweep — via the
  real check_out service (room → cleaning_required, invoice generated).
- A stay with outstanding dues is NEVER auto-checked-out.
- A same-day overstay (checkout date == today) is left alone.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.services.overdue import sweep_auto_checkouts
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _setup_room(client: AsyncClient, headers, number: str, code: str) -> str:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": code, "name": f"AC {code}", "base_price": "1000.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": number, "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    return room.json()["id"]


async def _checked_in_booking(
    client: AsyncClient, headers, room_id: str, phone: str, *, advance: str
) -> str:
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Auto Checkout Guest", "phone": phone},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text
    body: dict = {
        "booking": {
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room_id],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        "terms_acknowledged": True,
    }
    if float(advance) > 0:
        body["advance_payment"] = {"amount": advance, "method": "cash"}
    resp = await client.post("/api/v1/checkins/book-and-checkin", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["booking_id"]


async def _backdate(db: AsyncSession, booking_id: str, days: int) -> None:
    """Shift the stay into the past so the sweep sees a full day overstay."""
    await db.execute(
        update(Booking)
        .where(Booking.id == booking_id)
        .values(
            check_in_date=TODAY - timedelta(days=days + 1),
            check_out_date=TODAY - timedelta(days=days),
        )
    )
    await db.commit()


async def test_fully_paid_overdue_stay_auto_checks_out(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "AC-801", "AC1")
    # 1 night x 1000 fully paid up front.
    booking_id = await _checked_in_booking(
        client, headers, room_id, "9899922001", advance="1000.00"
    )
    await _backdate(db_session, booking_id, days=1)

    done = await sweep_auto_checkouts(db_session)
    assert done >= 1

    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["status"] == "checked_out"

    # Room released into the cleaning flow, like any manual checkout.
    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room = {r["id"]: r for r in rooms.json()["items"]}[room_id]
    assert room["status"] == "cleaning_required"


async def test_stay_with_dues_is_not_auto_checked_out(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "AC-802", "AC2")
    # Nothing paid — full amount outstanding.
    booking_id = await _checked_in_booking(
        client, headers, room_id, "9899922002", advance="0"
    )
    await _backdate(db_session, booking_id, days=1)

    await sweep_auto_checkouts(db_session)

    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.json()["status"] == "checked_in"  # humans collect money


async def test_same_day_overstay_left_alone(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "AC-803", "AC3")
    booking_id = await _checked_in_booking(
        client, headers, room_id, "9899922003", advance="1000.00"
    )
    # Checkout date == today (time may have passed) — alert only, no action.
    await db_session.execute(
        update(Booking)
        .where(Booking.id == booking_id)
        .values(check_in_date=TODAY - timedelta(days=1), check_out_date=TODAY)
    )
    await db_session.commit()

    await sweep_auto_checkouts(db_session)

    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.json()["status"] == "checked_in"
