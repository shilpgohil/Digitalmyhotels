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


async def test_hotel_lifecycle_create_assign_suspend_activate(
    client: AsyncClient, db_session
) -> None:
    """Full super-admin hotel lifecycle exactly as the console drives it:
    create → Total list (trial) → assign plan (trial→active, Active list)
    → suspend → activate. Catches the 'activate/deactivate does not work'
    class of bugs across route, service and list-filter semantics."""
    headers = await _super_admin_headers(client, db_session)
    name = f"Lifecycle Hotel {uuid4().hex[:6]}"

    created = await client.post(
        "/api/v1/super-admin/hotels",
        json={
            "name": name,
            "city": "Bhopal",
            "owner_full_name": "Life Cycle",
            "owner_email": f"life-{uuid4().hex[:8]}@example.org",
            "owner_password": "OwnerPass123!",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    hotel_id = created.json()["id"]

    async def _row(list_status: str | None) -> dict | None:
        params = f"?q={name.split(' ')[0]}&limit=50" + (
            f"&status={list_status}" if list_status else ""
        )
        resp = await client.get(f"/api/v1/super-admin/hotels{params}", headers=headers)
        assert resp.status_code == 200, resp.text
        return next((h for h in resp.json()["items"] if h["id"] == hotel_id), None)

    # New hotel: shows in Total, NOT in Active (it is trial, no plan yet).
    assert (await _row(None)) is not None
    total_row = await _row(None)
    assert total_row is not None and total_row["status"] == "trial"
    assert (await _row("active")) is None

    # Assign a plan → hotel flips to active and enters the Active list.
    plan = await client.post(
        "/api/v1/super-admin/plans",
        json={
            "code": f"life-{uuid4().hex[:6]}",
            "name": "Lifecycle Plan",
            "price": "999.00",
            "duration_days": 30,
            "trial_days": 0,
        },
        headers=headers,
    )
    assert plan.status_code == 201, plan.text
    assigned = await client.post(
        f"/api/v1/super-admin/hotels/{hotel_id}/subscription",
        json={"plan_id": plan.json()["id"]},
        headers=headers,
    )
    assert assigned.status_code == 200, assigned.text
    active_row = await _row("active")
    assert active_row is not None, "hotel missing from Active list after plan assignment"
    assert active_row["status"] == "active"
    assert active_row["subscription_status"] == "active"

    # Deactivate (suspend) — exactly the frontend call, ?status= query param.
    suspended = await client.post(
        f"/api/v1/super-admin/hotels/{hotel_id}/status?status=suspended",
        headers=headers,
    )
    assert suspended.status_code == 200, suspended.text
    assert (await _row("active")) is None
    total_after_suspend = await _row(None)
    assert total_after_suspend is not None
    assert total_after_suspend["status"] == "suspended"

    # Activate again.
    activated = await client.post(
        f"/api/v1/super-admin/hotels/{hotel_id}/status?status=active",
        headers=headers,
    )
    assert activated.status_code == 200, activated.text
    reactivated = await _row("active")
    assert reactivated is not None
    assert reactivated["status"] == "active"


async def test_suspended_hotel_locks_out_staff_until_reactivated(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    """Client report: staff could keep operating a deactivated hotel.
    Suspension must block EVERY hotel-scoped call (owner included); the
    super admin keeps access; reactivation restores the hotel."""
    owner_headers = auth_headers(await login(client, *hotel_a.credentials("owner")))
    hotel_id = str(hotel_a.hotel.id)

    # Working before suspension.
    before = await client.get("/api/v1/rooms?limit=5", headers=owner_headers)
    assert before.status_code == 200, before.text

    sa_headers = await _super_admin_headers(client, db_session)
    suspended = await client.post(
        f"/api/v1/super-admin/hotels/{hotel_id}/status?status=suspended",
        headers=sa_headers,
    )
    assert suspended.status_code == 200, suspended.text

    # Owner AND staff are locked out of every hotel-scoped endpoint.
    for role in ("owner", "admin", "housekeeping"):
        headers = auth_headers(await login(client, *hotel_a.credentials(role)))
        blocked = await client.get("/api/v1/rooms?limit=5", headers=headers)
        assert blocked.status_code == 403, f"{role}: {blocked.text}"
        assert blocked.json()["error"]["code"] == "hotel_suspended"
    # Transactions likewise.
    tx = await client.post(
        "/api/v1/guests",
        json={"full_name": "Blocked Guest", "phone": "9855500001"},
        headers=owner_headers,
    )
    assert tx.status_code == 403

    # The super admin can still inspect the hotel.
    detail = await client.get(
        f"/api/v1/super-admin/hotels/{hotel_id}", headers=sa_headers
    )
    assert detail.status_code == 200

    # Reactivation restores staff access.
    reactivated = await client.post(
        f"/api/v1/super-admin/hotels/{hotel_id}/status?status=active",
        headers=sa_headers,
    )
    assert reactivated.status_code == 200, reactivated.text
    after = await client.get("/api/v1/rooms?limit=5", headers=owner_headers)
    assert after.status_code == 200, after.text


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
