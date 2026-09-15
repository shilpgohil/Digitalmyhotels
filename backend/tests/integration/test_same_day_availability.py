"""Same-day room selection rule (plan §5.2, client 15/09/2026).

A stay starting TODAY must not offer rooms whose current guest has not
checked out yet — even when that guest's booking ends today (no date
overlap). Once the guest checks out, the room becomes selectable again.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def test_same_day_blocks_still_occupied_room(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)

    # Room + guest.
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "SDAY1", "name": "SameDay Type", "base_price": "1500.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "SD-401", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    room_id = room.json()["id"]
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Overstay Guest", "phone": "9899900011"},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text

    # Book today→tomorrow and check the guest in.
    resp = await client.post(
        "/api/v1/checkins/book-and-checkin",
        json={
            "booking": {
                "primary_guest_id": guest.json()["id"],
                "room_ids": [room_id],
                "check_in_date": str(TODAY),
                "check_out_date": str(TOMORROW),
            },
            "terms_acknowledged": True,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    booking_id = resp.json()["booking_id"]

    # Simulate the stay ENDING today (booked yesterday→today, guest still
    # inside): shift the dates in the DB — creation APIs reject past dates.
    await db_session.execute(
        update(Booking)
        .where(Booking.id == booking_id)
        .values(check_in_date=YESTERDAY, check_out_date=TODAY)
    )
    await db_session.commit()

    # Availability for a stay starting TODAY: the room is physically occupied
    # (guest not checked out) → must be UNAVAILABLE with reason "occupied",
    # even though the booking dates no longer overlap.
    avail = await client.get(
        f"/api/v1/rooms/availability?check_in={TODAY}&check_out={TOMORROW}",
        headers=headers,
    )
    assert avail.status_code == 200, avail.text
    body = avail.json()
    available_ids = {r["id"] for r in body["available"]}
    unavailable = {r["id"]: r for r in body["unavailable"]}
    assert room_id not in available_ids, "occupied room must not be selectable today"
    assert room_id in unavailable
    assert unavailable[room_id]["unavailable_reason"] == "occupied"

    # A FUTURE stay (starting tomorrow) may still select the room.
    future = await client.get(
        f"/api/v1/rooms/availability?check_in={TOMORROW}&check_out={TOMORROW + timedelta(days=1)}",
        headers=headers,
    )
    assert future.status_code == 200
    assert room_id in {r["id"] for r in future.json()["available"]}
