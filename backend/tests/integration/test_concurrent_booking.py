"""Verify that two simultaneous booking attempts for the same room on the same
dates result in exactly one success and one conflict.

This exercises the SELECT FOR UPDATE locking path in bookings.create_booking.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "owner"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _setup_shared_room(client: AsyncClient, headers) -> str:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "STD", "name": "Standard", "base_price": "1500.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "SHARED-1", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    return room.json()["id"]


async def _make_guest(client: AsyncClient, headers, phone: str) -> str:
    resp = await client.post(
        "/api/v1/guests",
        json={"full_name": "Concurrent Guest", "phone": phone},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_concurrent_same_room_only_one_wins(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Two concurrent booking requests for the same room on overlapping dates:
    exactly one must succeed (201) and the other must be rejected (409)."""
    headers = await _headers(client, hotel_a)
    room_id = await _setup_shared_room(client, headers)
    guest_1 = await _make_guest(client, headers, "9870000001")
    guest_2 = await _make_guest(client, headers, "9870000002")

    check_in = str(TODAY + timedelta(days=7))
    check_out = str(TODAY + timedelta(days=9))

    async def attempt_booking(guest_id: str):
        return await client.post(
            "/api/v1/bookings",
            json={
                "primary_guest_id": guest_id,
                "room_ids": [room_id],
                "check_in_date": check_in,
                "check_out_date": check_out,
                "adults": 1,
            },
            headers=headers,
        )

    # Fire both requests at the exact same time.
    r1, r2 = await asyncio.gather(
        attempt_booking(guest_1),
        attempt_booking(guest_2),
    )

    statuses = sorted([r1.status_code, r2.status_code])
    # One succeeds, one is rejected with double_booking or room_not_allocatable.
    assert statuses == [201, 409], (
        f"Expected [201, 409] but got {statuses}. "
        f"r1={r1.status_code} {r1.text[:200]}, r2={r2.status_code} {r2.text[:200]}"
    )

    conflict = r1 if r1.status_code == 409 else r2
    assert conflict.json()["error"]["code"] in {
        "double_booking",
        "room_not_allocatable",
    }, conflict.text


async def test_concurrent_registration_numbers_are_unique(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Two simultaneous check-ins at the same hotel must produce unique
    registration numbers (regression for the old COUNT-based generator)."""
    headers = await _headers(client, hotel_a)

    # Set up two separate bookings (different rooms).
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "REG-TYPE", "name": "Reg Test", "base_price": "1000.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room_ids = []
    for i in range(2):
        r = await client.post(
            "/api/v1/rooms",
            json={"room_number": f"REG-{i + 1}", "room_type_id": rt.json()["id"]},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        room_ids.append(r.json()["id"])

    guests = []
    for i in range(2):
        g = await client.post(
            "/api/v1/guests",
            json={"full_name": f"Reg Guest {i}", "phone": f"987000100{i}"},
            headers=headers,
        )
        assert g.status_code == 201, g.text
        guests.append(g.json()["id"])

    bookings = []
    for i in range(2):
        b = await client.post(
            "/api/v1/bookings",
            json={
                "primary_guest_id": guests[i],
                "room_ids": [room_ids[i]],
                "check_in_date": str(TODAY),
                "check_out_date": str(TODAY + timedelta(days=1)),
                "adults": 1,
            },
            headers=headers,
        )
        assert b.status_code == 201, b.text
        bookings.append(b.json()["id"])

    async def do_checkin(booking_id: str):
        return await client.post(
            "/api/v1/checkins",
            json={"booking_id": booking_id},
            headers=headers,
        )

    # Fire both check-ins simultaneously.
    c1, c2 = await asyncio.gather(
        do_checkin(bookings[0]),
        do_checkin(bookings[1]),
    )
    assert c1.status_code == 201, c1.text
    assert c2.status_code == 201, c2.text

    regs_1 = c1.json()["registration_numbers"]
    regs_2 = c2.json()["registration_numbers"]

    # All registration numbers across both check-ins must be distinct.
    all_regs = regs_1 + regs_2
    assert len(all_regs) == len(set(all_regs)), (
        f"Duplicate registration numbers detected: {all_regs}"
    )
