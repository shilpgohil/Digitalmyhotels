"""Cross-role authorization boundary tests.

Each test tries an action with a role that should NOT be allowed and asserts
403. Then confirms the same action works for an allowed role.

Covers every issue found in the security audit:
- Housekeeping cannot access financial, booking, or team endpoints.
- Admin cannot manage team, approve expenses, or process refunds/corrections.
- Super-admin-only endpoints return 403 for all hotel roles.
- Tenant isolation: a user from hotel_b cannot reach hotel_a data.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = date.today()


async def _h(client: AsyncClient, hotel: HotelFixture, role: str) -> dict[str, str]:
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


# ---------------------------------------------------------------------------
# Housekeeping role boundaries
# ---------------------------------------------------------------------------


async def test_housekeeping_cannot_access_bookings(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/bookings", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_payments(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/payments", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_invoices(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/invoices", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_expenses(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/expenses", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_team(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/team", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_reports(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get(
        f"/api/v1/reports/occupancy?from_date={TODAY - timedelta(days=7)}&to_date={TODAY}",
        headers=headers,
    )
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_financial_reports(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get(
        f"/api/v1/reports/revenue?from_date={TODAY - timedelta(days=7)}&to_date={TODAY}",
        headers=headers,
    )
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_audit_logs(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/audit-logs", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_guests(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/guests", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_daily_closing(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/ops/daily-closing/today", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_can_access_housekeeping_tasks(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Housekeeping must be able to do its own job."""
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/housekeeping/tasks", headers=headers)
    assert r.status_code == 200, r.text


async def test_housekeeping_can_view_rooms(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/rooms", headers=headers)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Admin role boundaries
# ---------------------------------------------------------------------------


async def test_admin_cannot_manage_team(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "admin")
    r = await client.get("/api/v1/team", headers=headers)
    assert r.status_code == 403, r.text


async def test_admin_cannot_approve_expenses(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner_h = await _h(client, hotel_a, "owner")
    exp = await client.post(
        "/api/v1/expenses",
        json={"amount": "100.00", "expense_date": str(TODAY), "submit": True},
        headers=owner_h,
    )
    assert exp.status_code == 201
    exp_id = exp.json()["id"]

    headers = await _h(client, hotel_a, "admin")
    r = await client.post(f"/api/v1/expenses/{exp_id}/approve", headers=headers)
    assert r.status_code == 403, r.text


async def test_admin_cannot_refund_payments(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner_h = await _h(client, hotel_a, "owner")
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "RBND", "name": "Refund Boundary", "base_price": "1000.00"},
        headers=owner_h,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "901", "room_type_id": rt.json()["id"]},
        headers=owner_h,
    )
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Boundary Test", "phone": "9833300001"},
        headers=owner_h,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=owner_h,
    )
    assert booking.status_code == 201
    booking_id = booking.json()["id"]

    payment = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking_id, "amount": "500.00", "method": "cash"},
        headers=owner_h,
    )
    assert payment.status_code == 201

    admin_h = await _h(client, hotel_a, "admin")
    r = await client.post(
        "/api/v1/payments/refunds",
        json={"booking_id": booking_id, "amount": "200.00", "method": "cash", "reason": "test"},
        headers=admin_h,
    )
    assert r.status_code == 403, r.text


async def test_admin_cannot_access_daily_closing(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "admin")
    r = await client.get("/api/v1/ops/daily-closing/today", headers=headers)
    assert r.status_code == 403, r.text


async def test_admin_can_view_expenses(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """After the permission fix, admin must be able to list expenses."""
    headers = await _h(client, hotel_a, "admin")
    r = await client.get("/api/v1/expenses", headers=headers)
    assert r.status_code == 200, r.text


async def test_admin_can_create_expense(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "admin")
    r = await client.post(
        "/api/v1/expenses",
        json={"amount": "75.00", "expense_date": str(TODAY)},
        headers=headers,
    )
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------
# Super-admin-only endpoints blocked for hotel roles
# ---------------------------------------------------------------------------


async def test_owner_cannot_access_super_admin_dashboard(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "owner")
    r = await client.get("/api/v1/super-admin/dashboard", headers=headers)
    assert r.status_code == 403, r.text


async def test_manager_cannot_access_super_admin_hotels(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "manager")
    r = await client.get("/api/v1/super-admin/hotels", headers=headers)
    assert r.status_code == 403, r.text


async def test_housekeeping_cannot_access_super_admin(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "housekeeping")
    r = await client.get("/api/v1/super-admin/dashboard", headers=headers)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Tenant isolation — cross-hotel attempts
# ---------------------------------------------------------------------------


async def test_hotel_a_owner_cannot_access_hotel_b_bookings(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "owner")
    # Point the hotel header at hotel_b — the server must reject this.
    headers["X-Hotel-Id"] = str(hotel_b.hotel.id)
    r = await client.get("/api/v1/bookings", headers=headers)
    assert r.status_code == 403, r.text


async def test_hotel_a_owner_cannot_access_hotel_b_payments(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "owner")
    headers["X-Hotel-Id"] = str(hotel_b.hotel.id)
    r = await client.get("/api/v1/payments", headers=headers)
    assert r.status_code == 403, r.text


async def test_hotel_a_owner_cannot_access_hotel_b_expenses(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "owner")
    headers["X-Hotel-Id"] = str(hotel_b.hotel.id)
    r = await client.get("/api/v1/expenses", headers=headers)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Manager role — correct scope
# ---------------------------------------------------------------------------


async def test_manager_cannot_manage_team(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "manager")
    r = await client.get("/api/v1/team", headers=headers)
    assert r.status_code == 403, r.text


async def test_manager_can_access_financial_reports(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "manager")
    r = await client.get(
        f"/api/v1/reports/revenue?from_date={TODAY - timedelta(days=7)}&to_date={TODAY}",
        headers=headers,
    )
    assert r.status_code == 200, r.text


async def test_manager_can_access_daily_closing(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _h(client, hotel_a, "manager")
    r = await client.get("/api/v1/ops/daily-closing/today", headers=headers)
    assert r.status_code == 200, r.text
