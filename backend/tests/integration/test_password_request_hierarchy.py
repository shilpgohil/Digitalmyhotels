"""Hierarchical password-reset requests (client 9-08 item 34).

- Staff request → routed to their hotel administrators (Team page list +
  admin-category notification), resolved by the existing team reset.
- Owner request → routed to the Super Admin, resolved by the platform reset
  (temp password, forced change, sessions revoked).
- The public endpoint never reveals whether an account exists.
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


async def test_staff_request_routes_to_hotel_admin_and_completes_on_reset(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    staff_email, _ = hotel_a.credentials("housekeeping")

    # Public request — same response whether or not the account exists.
    ok = await client.post(
        "/api/v1/auth/password-reset/request-admin",
        json={"identifier": staff_email},
    )
    assert ok.status_code == 200
    ghost = await client.post(
        "/api/v1/auth/password-reset/request-admin",
        json={"identifier": f"ghost-{uuid4().hex[:8]}@example.org"},
    )
    assert ghost.status_code == 200
    assert ok.json() == ghost.json()

    owner_headers = auth_headers(await login(client, *hotel_a.credentials("owner")))
    pending = await client.get("/api/v1/team/password-requests", headers=owner_headers)
    assert pending.status_code == 200, pending.text
    rows = pending.json()
    assert any(r["email"] == staff_email for r in rows)
    target = next(r for r in rows if r["email"] == staff_email)

    # Owner/manager get an admin-category notification about the request.
    notifs = await client.get(
        "/api/v1/notifications?category=admin", headers=owner_headers
    )
    assert notifs.status_code == 200
    assert any(
        n["type"] == "team.password_reset_requested" for n in notifs.json()["items"]
    )

    # Duplicate submissions do not stack.
    await client.post(
        "/api/v1/auth/password-reset/request-admin",
        json={"identifier": staff_email},
    )
    again = await client.get("/api/v1/team/password-requests", headers=owner_headers)
    assert len([r for r in again.json() if r["email"] == staff_email]) == 1

    # The existing team reset resolves the request automatically.
    team = await client.get("/api/v1/team?limit=100", headers=owner_headers)
    membership_id = next(
        m["membership_id"] for m in team.json()["items"] if m["email"] == staff_email
    )
    reset = await client.post(
        f"/api/v1/team/{membership_id}/reset-password",
        json={"new_password": "TempPass123!"},
        headers=owner_headers,
    )
    assert reset.status_code == 200, reset.text
    cleared = await client.get("/api/v1/team/password-requests", headers=owner_headers)
    assert [r for r in cleared.json() if r["user_id"] == target["user_id"]] == []

    # Staff logs in with the temp password and must change it.
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": staff_email, "password": "TempPass123!"},
    )
    assert relogin.status_code == 200, relogin.text
    assert relogin.json()["user"]["must_reset_password"] is True


async def test_owner_request_routes_to_super_admin_and_platform_reset(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    owner_email, _ = hotel_a.credentials("owner")
    resp = await client.post(
        "/api/v1/auth/password-reset/request-admin",
        json={"identifier": owner_email},
    )
    assert resp.status_code == 200

    # NOT visible to the hotel's own team page (it targets the super admin)…
    owner_headers = auth_headers(await login(client, *hotel_a.credentials("owner")))
    hotel_list = await client.get(
        "/api/v1/team/password-requests", headers=owner_headers
    )
    assert [r for r in hotel_list.json() if r["email"] == owner_email] == []

    # …but IS visible on the platform list, labelled with the hotel.
    sa_headers = await _super_admin_headers(client, db_session)
    platform_list = await client.get(
        "/api/v1/super-admin/password-requests", headers=sa_headers
    )
    assert platform_list.status_code == 200, platform_list.text
    row = next(
        (r for r in platform_list.json() if r["email"] == owner_email), None
    )
    assert row is not None
    assert row["hotel_name"] == hotel_a.hotel.name

    # Super admin issues the reset → request resolved, owner forced to change.
    reset = await client.post(
        f"/api/v1/super-admin/users/{row['user_id']}/reset-password",
        json={"new_password": "OwnerTemp123!"},
        headers=sa_headers,
    )
    assert reset.status_code == 200, reset.text

    after = await client.get(
        "/api/v1/super-admin/password-requests", headers=sa_headers
    )
    assert [r for r in after.json() if r["email"] == owner_email] == []

    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": owner_email, "password": "OwnerTemp123!"},
    )
    assert relogin.status_code == 200, relogin.text
    assert relogin.json()["user"]["must_reset_password"] is True
