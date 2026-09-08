"""Booking/room lifecycle guards (client 9-08 items 22, 23, 24).

- Room replacement before check-in: availability-aware, atomic, repriced.
- Missed-arrival alert: fires once after scheduled arrival + 2 h grace;
  rooms are released only by the manual no-show/cancel actions.
- Timestamp guards: future actual check-in and unscheduled early arrivals
  are rejected instead of silently stored.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "owner"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _room(
    client: AsyncClient,
    headers,
    *,
    number: str,
    type_code: str,
    base_price: str = "2000.00",
) -> dict:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": type_code, "name": f"Type {type_code}", "base_price": base_price},
        headers=headers,
    )
    assert rt.status_code in (201, 409), rt.text
    if rt.status_code == 409:
        types = await client.get("/api/v1/rooms/types", headers=headers)
        rt_id = next(t["id"] for t in types.json() if t["code"] == type_code)
    else:
        rt_id = rt.json()["id"]
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": number, "room_type_id": rt_id},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    return room.json()


async def _booking(
    client: AsyncClient,
    headers,
    *,
    room_id: str,
    phone: str,
    check_in: date = TODAY,
    nights: int = 1,
    check_in_time: str | None = None,
) -> dict:
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Lifecycle Guest", "phone": phone},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text
    body: dict = {
        "primary_guest_id": guest.json()["id"],
        "room_ids": [room_id],
        "check_in_date": str(check_in),
        "check_out_date": str(check_in + timedelta(days=nights)),
    }
    if check_in_time:
        body["check_in_time"] = check_in_time
    booking = await client.post("/api/v1/bookings", json=body, headers=headers)
    assert booking.status_code == 201, booking.text
    return booking.json()


# ── (22) room replacement before check-in ──────────────────────────────────


async def test_replace_room_reprices_and_swaps_reservation(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_a = await _room(client, headers, number="501", type_code="LC1")
    room_b = await _room(
        client, headers, number="502", type_code="LC2", base_price="3500.00"
    )
    booking = await _booking(
        client, headers, room_id=room_a["id"], phone="9861000001"
    )
    assert Decimal(booking["total_amount"]) == 2000

    replaced = await client.post(
        f"/api/v1/bookings/{booking['id']}/replace-room",
        json={
            "from_room_id": room_a["id"],
            "to_room_id": room_b["id"],
            "reason": "Guest asked for a larger room",
        },
        headers=headers,
    )
    assert replaced.status_code == 200, replaced.text
    out = replaced.json()
    # Repriced to the new room type's base price.
    assert Decimal(out["total_amount"]) == 3500

    # Old room released, new room reserved.
    rooms = await client.get("/api/v1/rooms?limit=100", headers=headers)
    by_number = {r["room_number"]: r["status"] for r in rooms.json()["items"]}
    assert by_number["501"] == "available"
    assert by_number["502"] == "reserved"

    # Check-in proceeds on the replacement room.
    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking["id"], "terms_acknowledged": True},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text


async def test_replace_room_blocks_double_booking_and_checked_in(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_a = await _room(client, headers, number="503", type_code="LC3")
    room_b = await _room(client, headers, number="504", type_code="LC3B")
    booking = await _booking(client, headers, room_id=room_a["id"], phone="9861000002")
    # Competing booking already holds room B for the same dates.
    await _booking(client, headers, room_id=room_b["id"], phone="9861000003")

    conflict = await client.post(
        f"/api/v1/bookings/{booking['id']}/replace-room",
        json={"from_room_id": room_a["id"], "to_room_id": room_b["id"]},
        headers=headers,
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] in ("double_booking", "room_not_allocatable")

    # After check-in, replacement is closed (room transfer applies instead).
    await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking["id"], "terms_acknowledged": True},
        headers=headers,
    )
    room_c = await _room(client, headers, number="505", type_code="LC3C")
    late = await client.post(
        f"/api/v1/bookings/{booking['id']}/replace-room",
        json={"from_room_id": room_a["id"], "to_room_id": room_c["id"]},
        headers=headers,
    )
    assert late.status_code == 422
    assert late.json()["error"]["code"] == "booking_not_replaceable"


# ── (24) timestamp guards ──────────────────────────────────────────────────


async def test_future_actual_checkin_time_is_rejected(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room = await _room(client, headers, number="506", type_code="LC4")
    booking = await _booking(client, headers, room_id=room["id"], phone="9861000004")

    future = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    resp = await client.post(
        "/api/v1/checkins",
        json={
            "booking_id": booking["id"],
            "checked_in_at": future,
            "terms_acknowledged": True,
        },
        headers=headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "checkin_time_future"


async def test_checkin_before_scheduled_date_requires_early_flag(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room = await _room(client, headers, number="507", type_code="LC5")
    booking = await _booking(
        client,
        headers,
        room_id=room["id"],
        phone="9861000005",
        check_in=TODAY + timedelta(days=2),
    )

    blocked = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking["id"], "terms_acknowledged": True},
        headers=headers,
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "early_checkin_required"

    early = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking["id"], "is_early": True, "terms_acknowledged": True},
        headers=headers,
    )
    assert early.status_code == 201, early.text


# ── (23) missed-arrival alert ──────────────────────────────────────────────


async def test_missed_arrival_fires_once_and_keeps_room_reserved(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    from app.services.reminders import sweep_missed_arrivals

    headers = await _headers(client, hotel_a)
    room = await _room(client, headers, number="508", type_code="LC6")
    booking = await _booking(
        client,
        headers,
        room_id=room["id"],
        phone="9861000006",
        check_in_time="10:00",
    )

    ist = ZoneInfo("Asia/Kolkata")
    scheduled = datetime(TODAY.year, TODAY.month, TODAY.day, 10, 0, tzinfo=ist)

    # 1 h after schedule — still inside the 2 h grace: nothing fires.
    assert (
        await sweep_missed_arrivals(
            db_session, now_utc=(scheduled + timedelta(hours=1)).astimezone(UTC)
        )
        == 0
    )

    # 3 h after schedule — grace passed: exactly one alert, then dedup.
    late_now = (scheduled + timedelta(hours=3)).astimezone(UTC)
    assert await sweep_missed_arrivals(db_session, now_utc=late_now) == 1
    assert await sweep_missed_arrivals(db_session, now_utc=late_now) == 0

    # The room is NOT auto-released; manual no-show does that.
    rooms = await client.get("/api/v1/rooms?limit=100", headers=headers)
    by_number = {r["room_number"]: r["status"] for r in rooms.json()["items"]}
    assert by_number["508"] == "reserved"

    no_show = await client.post(
        f"/api/v1/bookings/{booking['id']}/no-show", headers=headers
    )
    assert no_show.status_code == 200, no_show.text
    rooms = await client.get("/api/v1/rooms?limit=100", headers=headers)
    by_number = {r["room_number"]: r["status"] for r in rooms.json()["items"]}
    assert by_number["508"] == "available"
