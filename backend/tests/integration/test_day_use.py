"""Day-use (same-day, hourly) bookings: pricing, validation and conflicts."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _setup_room(
    client: AsyncClient, headers, *, hourly_rate: str | None, room_number: str = "301"
) -> str:
    body: dict = {
        "code": f"DAY{room_number}",
        "name": "Day Use Type",
        "base_price": "2000.00",
    }
    if hourly_rate is not None:
        body["hourly_rate"] = hourly_rate
    rt = await client.post("/api/v1/rooms/types", json=body, headers=headers)
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": room_number, "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    return room.json()["id"]


async def _make_guest(client: AsyncClient, headers, phone: str) -> str:
    resp = await client.post(
        "/api/v1/guests",
        json={"full_name": "Day Use Guest", "phone": phone},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _day_use_payload(guest_id: str, room_ids: list[str], **overrides) -> dict:
    return {
        "primary_guest_id": guest_id,
        "room_ids": room_ids,
        "check_in_date": str(TODAY),
        "check_out_date": str(TODAY),
        "check_in_time": "10:00",
        "check_out_time": "15:30",
        **overrides,
    }


async def test_day_use_priced_by_hourly_rate(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """5.5 hours → 6 billable hours × ₹300 = ₹1800."""
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate="300.00", room_number="301")
    guest_id = await _make_guest(client, headers, "9822200011")

    resp = await client.post(
        "/api/v1/bookings",
        json=_day_use_payload(guest_id, [room_id]),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert Decimal(body["total_amount"]) == 1800
    assert body["check_in_date"] == body["check_out_date"]


async def test_day_use_falls_back_to_night_rate_without_hourly(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate=None, room_number="302")
    guest_id = await _make_guest(client, headers, "9822200012")

    resp = await client.post(
        "/api/v1/bookings",
        json=_day_use_payload(guest_id, [room_id]),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["total_amount"]) == 2000  # full night base price


async def test_day_use_requires_times(client: AsyncClient, hotel_a: HotelFixture) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate="300.00", room_number="303")
    guest_id = await _make_guest(client, headers, "9822200013")

    payload = _day_use_payload(guest_id, [room_id])
    del payload["check_in_time"]
    del payload["check_out_time"]
    resp = await client.post("/api/v1/bookings", json=payload, headers=headers)
    assert resp.status_code == 422

    # Checkout time not after check-in time → also rejected.
    bad = _day_use_payload(guest_id, [room_id], check_in_time="14:00", check_out_time="12:00")
    resp = await client.post("/api/v1/bookings", json=bad, headers=headers)
    assert resp.status_code == 422


async def test_day_use_blocks_the_calendar_day(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """A day-use booking occupies the whole date at v1 granularity: a second
    day-use OR an overnight booking starting that day must be rejected."""
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate="300.00", room_number="304")
    guest_id = await _make_guest(client, headers, "9822200014")

    first = await client.post(
        "/api/v1/bookings",
        json=_day_use_payload(guest_id, [room_id]),
        headers=headers,
    )
    assert first.status_code == 201, first.text

    # Second day-use, same room, same date (non-overlapping hours — still v1 conflict).
    second = await client.post(
        "/api/v1/bookings",
        json=_day_use_payload(
            guest_id, [room_id], check_in_time="16:00", check_out_time="20:00"
        ),
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "double_booking"

    # Overnight booking starting the same date also conflicts.
    overnight = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest_id,
            "room_ids": [room_id],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    assert overnight.status_code == 409

    # But the NEXT day is free.
    tomorrow = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest_id,
            "room_ids": [room_id],
            "check_in_date": str(TODAY + timedelta(days=1)),
            "check_out_date": str(TODAY + timedelta(days=2)),
        },
        headers=headers,
    )
    assert tomorrow.status_code == 201, tomorrow.text


async def test_overdue_sweep_fires_once(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    """Sweep notifies exactly once for an overdue in-house stay."""
    from datetime import UTC, datetime
    from datetime import timedelta as td

    from sqlalchemy import select

    from app.models.booking import Booking
    from app.models.platform import Notification
    from app.services.overdue import sweep_overdue_checkouts

    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate=None, room_number="306")
    guest_id = await _make_guest(client, headers, "9822200016")

    booked = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest_id,
            "room_ids": [room_id],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    assert booked.status_code == 201, booked.text
    booking_id = booked.json()["id"]
    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking_id, "terms_acknowledged": True},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text

    # Not overdue now → sweep is a no-op for this booking.
    booking = (
        await db_session.execute(select(Booking).where(Booking.id == booking_id))
    ).scalar_one()
    assert booking.overdue_notified_at is None

    # Time-travel: sweep as if it's 2 days from now (checkout long past).
    future = datetime.now(UTC) + td(days=2)
    fired = await sweep_overdue_checkouts(db_session, now_utc=future)
    assert fired >= 1

    await db_session.refresh(booking)
    assert booking.overdue_notified_at is not None

    notif = (
        await db_session.execute(
            select(Notification).where(
                Notification.hotel_id == booking.hotel_id,
                Notification.title == "Checkout overdue",
            )
        )
    ).scalars().all()
    assert len(notif) >= 1
    assert booked.json()["booking_number"] in notif[-1].body

    # Second sweep: durable dedupe — nothing new for this booking.
    before = len(notif)
    await sweep_overdue_checkouts(db_session, now_utc=future)
    notif_after = (
        await db_session.execute(
            select(Notification).where(
                Notification.hotel_id == booking.hotel_id,
                Notification.title == "Checkout overdue",
            )
        )
    ).scalars().all()
    assert len(notif_after) == before


async def test_availability_endpoint_allows_same_day_and_sees_day_use(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    room_id = await _setup_room(client, headers, hourly_rate="300.00", room_number="305")
    guest_id = await _make_guest(client, headers, "9822200015")

    booked = await client.post(
        "/api/v1/bookings",
        json=_day_use_payload(guest_id, [room_id]),
        headers=headers,
    )
    assert booked.status_code == 201, booked.text

    resp = await client.get(
        f"/api/v1/rooms/availability?check_in={TODAY}&check_out={TODAY}",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    unavailable_ids = {r["id"] for r in body["unavailable"]}
    assert room_id in unavailable_ids
