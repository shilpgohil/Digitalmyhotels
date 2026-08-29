"""Booking → check-in → transfer → checkout lifecycle and double-booking rules."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "owner"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _setup_rooms(client: AsyncClient, headers, *, count: int = 2) -> list[str]:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "DLX", "name": "Deluxe", "base_price": "2000.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room_ids = []
    for i in range(count):
        room = await client.post(
            "/api/v1/rooms",
            json={"room_number": f"10{i + 1}", "room_type_id": rt.json()["id"]},
            headers=headers,
        )
        assert room.status_code == 201, room.text
        room_ids.append(room.json()["id"])
    return room_ids


async def _make_guest(client: AsyncClient, headers, phone: str) -> str:
    resp = await client.post(
        "/api/v1/guests",
        json={"full_name": "Test Guest", "phone": phone},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_booking(
    client: AsyncClient, headers, guest_id: str, room_ids: list[str], **overrides
) -> dict:
    payload = {
        "primary_guest_id": guest_id,
        "room_ids": room_ids,
        "check_in_date": str(TODAY),
        "check_out_date": str(TODAY + timedelta(days=2)),
        "adults": 2,
        **overrides,
    }
    resp = await client.post("/api/v1/bookings", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_full_lifecycle_booking_checkin_transfer_checkout(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_ids = await _setup_rooms(client, headers, count=2)
    guest_id = await _make_guest(client, headers, "9811111111")

    booking = await _make_booking(client, headers, guest_id, [room_ids[0]])
    assert booking["status"] == "confirmed"
    assert booking["total_amount"] == "4000.00"  # 2 nights x 2000

    # Room became reserved.
    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[0]] == "reserved"

    # Check in with a co-guest.
    co_guest_id = await _make_guest(client, headers, "9822222222")
    checkin = await client.post(
        "/api/v1/checkins",
        json={
            "booking_id": booking["id"],
            "co_guests": [{"guest_id": co_guest_id}],
            "purpose_of_visit": "Business",
        },
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text
    assert len(checkin.json()["registration_numbers"]) == 2

    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[0]] == "occupied"

    # Current guests shows the stay.
    current = await client.get("/api/v1/current-guests", headers=headers)
    assert current.status_code == 200
    entries = current.json()["items"]
    assert any(e["booking_id"] == booking["id"] for e in entries)
    entry = next(e for e in entries if e["booking_id"] == booking["id"])
    assert entry["guest_count"] == 2
    assert "*" in entry["primary_guest_phone_masked"]

    # Transfer to the second room: old room → cleaning, new room → occupied.
    transfer = await client.post(
        "/api/v1/room-transfers",
        json={
            "booking_id": booking["id"],
            "from_room_id": room_ids[0],
            "to_room_id": room_ids[1],
            "reason": "AC not working",
        },
        headers=headers,
    )
    assert transfer.status_code == 201, transfer.text
    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[0]] == "cleaning_required"
    assert room_status[room_ids[1]] == "occupied"

    # Checkout with dues blocked unless authorized.
    blocked = await client.post(
        "/api/v1/checkouts", json={"booking_id": booking["id"]}, headers=headers
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "balance_due"

    authorized = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "allow_due": True,
            "due_reason": "Corporate billing next week",
        },
        headers=headers,
    )
    assert authorized.status_code == 201, authorized.text
    out = authorized.json()
    assert out["due_amount"] == "4000.00"
    assert out["payment_due_authorized"] is True

    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[1]] == "cleaning_required"

    # Reversal (owner has checkout + corrections) reopens the stay.
    reversal = await client.post(
        f"/api/v1/checkouts/{booking['id']}/reverse",
        json={"reason": "Guest returned, wrong checkout"},
        headers=headers,
    )
    assert reversal.status_code == 200, reversal.text
    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[1]] == "occupied"


async def test_double_booking_is_prevented(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_ids = await _setup_rooms(client, headers, count=1)
    guest1 = await _make_guest(client, headers, "9833333333")
    guest2 = await _make_guest(client, headers, "9844444444")

    await _make_booking(client, headers, guest1, room_ids)

    conflict = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest2,
            "room_ids": room_ids,
            "check_in_date": str(TODAY + timedelta(days=1)),
            "check_out_date": str(TODAY + timedelta(days=3)),
        },
        headers=headers,
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] in {"double_booking", "room_not_allocatable"}

    # Non-overlapping dates are fine.
    ok = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest2,
            "room_ids": room_ids,
            "check_in_date": str(TODAY + timedelta(days=5)),
            "check_out_date": str(TODAY + timedelta(days=7)),
        },
        headers=headers,
    )
    assert ok.status_code == 201, ok.text


async def test_cancel_releases_room(client: AsyncClient, hotel_a: HotelFixture) -> None:
    headers = await _headers(client, hotel_a)
    room_ids = await _setup_rooms(client, headers, count=1)
    guest = await _make_guest(client, headers, "9855555555")
    booking = await _make_booking(client, headers, guest, room_ids)

    cancelled = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel",
        json={"reason": "Guest called to cancel"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    rooms = await client.get("/api/v1/rooms?limit=200", headers=headers)
    room_status = {r["id"]: r["status"] for r in rooms.json()["items"]}
    assert room_status[room_ids[0]] == "available"

    # Cancelled booking cannot be checked in.
    checkin = await client.post(
        "/api/v1/checkins", json={"booking_id": booking["id"]}, headers=headers
    )
    assert checkin.status_code == 422


async def test_housekeeping_cannot_manage_bookings(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    hk_headers = await _headers(client, hotel_a, role="housekeeping")
    resp = await client.get("/api/v1/bookings", headers=hk_headers)
    assert resp.status_code == 403
