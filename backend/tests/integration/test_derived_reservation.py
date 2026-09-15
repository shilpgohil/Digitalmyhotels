"""Room-status redesign (plan 15/09): reservation state is DERIVED, not stored.

Covers:
- A far-future confirmed booking leaves the room physically 'available' and
  surfaces as next_booking_* on the rooms list (the ribbon data).
- B2 regression: a same-day walk-in booking on that room SUCCEEDS (the old
  stored-RESERVED flag made the picker offer a room the booking API then
  rejected with 409 room_not_allocatable).
- The availability picker reports the upcoming booking via next_booking_date
  for rooms free in the requested window.
- Cancelling one of two future bookings keeps the other visible (no drift).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _setup_room(client: AsyncClient, headers, number: str, code: str) -> str:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": code, "name": f"Derived {code}", "base_price": "1800.00"},
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


async def _make_guest(client: AsyncClient, headers, phone: str) -> str:
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Derived Guest", "phone": phone},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text
    return guest.json()["id"]


async def _book(
    client: AsyncClient,
    headers,
    guest_id: str,
    room_id: str,
    check_in: date,
    nights: int = 2,
    check_in_time: str | None = None,
) -> dict:
    body: dict = {
        "primary_guest_id": guest_id,
        "room_ids": [room_id],
        "check_in_date": str(check_in),
        "check_out_date": str(check_in + timedelta(days=nights)),
    }
    if check_in_time:
        body["check_in_time"] = check_in_time
    resp = await client.post("/api/v1/bookings", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_future_booking_leaves_room_available_with_ribbon(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "DR-701", "DRV1")
    guest_id = await _make_guest(client, headers, "9899911001")

    future = TODAY + timedelta(days=9)
    await _book(client, headers, guest_id, room_id, future, check_in_time="14:00")

    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    item = {r["id"]: r for r in rooms.json()["items"]}[room_id]
    # Physically available NOW — no stored 'reserved' paint for 9 days.
    assert item["status"] == "available"
    assert item["arriving_today"] is False
    # Ribbon facts, hour-accurate.
    assert item["next_booking_date"] == str(future)
    assert item["next_booking_time"] == "14:00"


async def test_walk_in_succeeds_on_room_with_future_booking(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """B2 regression: picker offers it → booking must accept it."""
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "DR-702", "DRV2")
    guest_id = await _make_guest(client, headers, "9899911002")

    # Far-future booking on the room.
    await _book(client, headers, guest_id, room_id, TODAY + timedelta(days=9))

    # Availability for TONIGHT offers the room, with the upcoming booking fact.
    avail = await client.get(
        f"/api/v1/rooms/availability?check_in={TODAY}&check_out={TODAY + timedelta(days=1)}",
        headers=headers,
    )
    assert avail.status_code == 200, avail.text
    offered = {r["id"]: r for r in avail.json()["available"]}
    assert room_id in offered
    assert offered[room_id]["next_booking_date"] == str(TODAY + timedelta(days=9))

    # Same-day walk-in booking SUCCEEDS (was 409 room_not_allocatable when
    # the future booking stored 'reserved' on the room).
    walkin_guest = await _make_guest(client, headers, "9899911003")
    booking = await _book(client, headers, walkin_guest, room_id, TODAY, nights=1)
    assert booking["status"] == "confirmed"


async def test_cancel_one_of_two_future_bookings_keeps_other_visible(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Drift regression (B3): derived state always reflects remaining bookings."""
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, "DR-703", "DRV3")
    g1 = await _make_guest(client, headers, "9899911004")
    g2 = await _make_guest(client, headers, "9899911005")

    near = TODAY + timedelta(days=5)
    far = TODAY + timedelta(days=20)
    b_near = await _book(client, headers, g1, room_id, near)
    await _book(client, headers, g2, room_id, far)

    # Cancel the NEAR booking — the ribbon must fall back to the FAR one
    # (the old stored flag would have flipped the room to plain available).
    cancel = await client.post(
        f"/api/v1/bookings/{b_near['id']}/cancel",
        json={"reason": "Guest changed plans"},
        headers=headers,
    )
    assert cancel.status_code == 200, cancel.text

    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    item = {r["id"]: r for r in rooms.json()["items"]}[room_id]
    assert item["status"] == "available"
    assert item["next_booking_date"] == str(far)
