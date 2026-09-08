"""Super Admin control plane (client 9-08 items 27, 28, 30).

- Hotel detail + edit (profile fields, owner phone backfill), audited.
- Plan edit / deactivate — hidden from new assignments, never deleted.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _super_admin_headers(client: AsyncClient, db_session) -> dict:
    from app.services.auth import create_user

    email = f"root-{uuid4().hex[:8]}@example.org"
    password = "SuperSecret123!"
    await create_user(
        db_session,
        email=email,
        password=password,
        full_name="Platform Root",
        is_super_admin=True,
    )
    await db_session.commit()
    return auth_headers(await login(client, email, password))


async def test_admin_hotel_detail_edit_and_owner_phone_backfill(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    headers = await _super_admin_headers(client, db_session)
    hotel_id = str(hotel_a.hotel.id)

    detail = await client.get(f"/api/v1/super-admin/hotels/{hotel_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["name"] == hotel_a.hotel.name
    assert body["owner_email"] is not None

    updated = await client.patch(
        f"/api/v1/super-admin/hotels/{hotel_id}",
        json={
            "city": "Pune",
            "state": "Maharashtra",
            "owner_phone": "98220 00111",
        },
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    out = updated.json()
    assert out["city"] == "Pune"
    assert out["state"] == "Maharashtra"
    # Owner phone normalized and stored on the OWNER USER (login by phone).
    assert out["owner_phone"] == "9822000111"

    # Non-super-admin cannot touch these routes.
    owner_headers = auth_headers(
        await login(client, *hotel_a.credentials("owner"))
    )
    denied = await client.patch(
        f"/api/v1/super-admin/hotels/{hotel_id}",
        json={"city": "Nashik"},
        headers=owner_headers,
    )
    assert denied.status_code == 403


async def test_all_customers_masked_list_and_audited_detail(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    """Item 36: cross-hotel list is masked; full profile only via the audited
    detail action; non-super-admins are locked out."""
    owner_headers = auth_headers(await login(client, *hotel_a.credentials("owner")))
    created = await client.post(
        "/api/v1/guests",
        json={
            "full_name": "Directory Guest",
            "phone": "9877700111",
            "city": "Indore",
            "id_number": "888877776666",
        },
        headers=owner_headers,
    )
    assert created.status_code == 201, created.text
    guest_id = created.json()["id"]

    headers = await _super_admin_headers(client, db_session)

    listed = await client.get(
        "/api/v1/super-admin/customers?q=Directory", headers=headers
    )
    assert listed.status_code == 200, listed.text
    rows = listed.json()["items"]
    assert any(r["guest_id"] == guest_id for r in rows)
    row = next(r for r in rows if r["guest_id"] == guest_id)
    # Masked summary: no raw phone, no full ID anywhere in the list payload.
    assert row["phone_masked"].endswith("0111")
    assert "9877700111" not in listed.text
    assert "888877776666" not in listed.text
    assert row["hotel_name"] == hotel_a.hotel.name

    detail = await client.get(
        f"/api/v1/super-admin/customers/{guest_id}", headers=headers
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["phone"] == "9877700111"
    # Full ID number is still never exposed here.
    assert "888877776666" not in detail.text

    # Hotel owners cannot use the cross-hotel directory.
    denied = await client.get("/api/v1/super-admin/customers", headers=owner_headers)
    assert denied.status_code == 403


async def test_plan_edit_and_deactivate_never_deletes(
    client: AsyncClient, db_session
) -> None:
    headers = await _super_admin_headers(client, db_session)

    code = f"six-month-{uuid4().hex[:6]}"
    created = await client.post(
        "/api/v1/super-admin/plans",
        json={
            "code": code,
            "name": "6 Months",
            "price": "5999.00",
            "duration_days": 180,
            "trial_days": 0,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    plan_id = created.json()["id"]

    # Edit price + name.
    edited = await client.patch(
        f"/api/v1/super-admin/plans/{plan_id}",
        json={"name": "Half Yearly", "price": "6499.00"},
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Half Yearly"
    assert float(edited.json()["price"]) == 6499.0

    # Deactivate — still listed (for history), flagged inactive, NOT deleted.
    deactivated = await client.patch(
        f"/api/v1/super-admin/plans/{plan_id}",
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    # Active-only catalogue (renewal dialog) hides it…
    active_only = await client.get("/api/v1/super-admin/plans", headers=headers)
    assert plan_id not in [p["id"] for p in active_only.json()]

    # …but the management view still shows it — deactivated, not deleted.
    all_plans = await client.get(
        "/api/v1/super-admin/plans?include_inactive=true", headers=headers
    )
    row = next((p for p in all_plans.json() if p["id"] == plan_id), None)
    assert row is not None
    assert row["is_active"] is False
