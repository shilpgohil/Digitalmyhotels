"""Housekeeping, daily closing, reports, super-admin isolation."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = date.today()


async def _owner_headers(client: AsyncClient, hotel: HotelFixture) -> dict[str, str]:
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _stay(client: AsyncClient, headers: dict[str, str]) -> dict:
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "OPS", "name": "Ops", "base_price": "1500.00"},
        headers=headers,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "401", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Ops Guest", "phone": "9811111111"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking.json()["id"]},
        headers=headers,
    )
    checkout = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking.json()["id"], "allow_due": True, "due_reason": "ops test"},
        headers=headers,
    )
    assert checkout.status_code == 201, checkout.text
    return {"room": room.json(), "booking": booking.json(), "headers": headers}


async def test_housekeeping_completes_to_available(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _owner_headers(client, hotel_a)
    stay = await _stay(client, headers)
    tasks = await client.get("/api/v1/housekeeping/tasks", headers=headers)
    assert tasks.status_code == 200, tasks.text
    open_tasks = [t for t in tasks.json() if t["status"] != "completed"]
    assert open_tasks
    task_id = open_tasks[0]["id"]
    start = await client.post(
        f"/api/v1/housekeeping/tasks/{task_id}/start", json={}, headers=headers
    )
    assert start.status_code == 200, start.text
    done = await client.post(
        f"/api/v1/housekeeping/tasks/{task_id}/complete", headers=headers
    )
    assert done.status_code == 200, done.text
    rooms = await client.get("/api/v1/rooms", headers=headers)
    room = next(r for r in rooms.json()["items"] if r["id"] == stay["room"]["id"])
    assert room["status"] == "available"


async def test_daily_closing_and_reports(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _owner_headers(client, hotel_a)
    today = await client.get("/api/v1/ops/daily-closing/today", headers=headers)
    assert today.status_code == 200, today.text
    closed = await client.post(
        "/api/v1/ops/daily-closing/close", json={"notes": "ok"}, headers=headers
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    again = await client.post(
        "/api/v1/ops/daily-closing/close", json={"notes": "dup"}, headers=headers
    )
    assert again.status_code == 409
    occ = await client.get(
        f"/api/v1/reports/occupancy?from_date={TODAY}&to_date={TODAY + timedelta(days=1)}",
        headers=headers,
    )
    assert occ.status_code == 200, occ.text


async def test_housekeeping_cannot_see_payments(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    email, password = hotel_a.credentials("housekeeping")
    headers = auth_headers(await login(client, email, password))
    resp = await client.get("/api/v1/payments", headers=headers)
    assert resp.status_code == 403


async def test_super_admin_required(client: AsyncClient, hotel_a: HotelFixture) -> None:
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get("/api/v1/super-admin/dashboard", headers=headers)
    assert resp.status_code == 403
