"""Team member cap (plan §7.1, client 15/09/2026): default 5 active members
(excluding the owner); adding beyond the cap is rejected; disabling a member
frees a seat; super admin can raise the limit per hotel."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hotel import Hotel
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _owner(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


def _member_body(n: int) -> dict:
    return {
        "full_name": f"Cap Member {n}",
        "phone": f"98111000{n:02d}",
        "role_code": "housekeeping",
        "password": "TempPass123!",
    }


async def test_team_limit_enforced_and_adjustable(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _owner(client, hotel_a)

    # The fixture already seeds some staff — set the cap to current + 1 so the
    # test is independent of the seed count.
    listing = (await client.get("/api/v1/team?limit=100", headers=headers)).json()
    current_active = listing["active_members"]
    await db_session.execute(
        update(Hotel)
        .where(Hotel.id == hotel_a.hotel.id)
        .values(max_team_members=current_active + 1)
    )
    await db_session.commit()

    # One more member fits…
    ok = await client.post("/api/v1/team", json=_member_body(1), headers=headers)
    assert ok.status_code == 201, ok.text

    # …the next one hits the cap.
    blocked = await client.post("/api/v1/team", json=_member_body(2), headers=headers)
    assert blocked.status_code == 422, blocked.text
    assert "team_limit_reached" in blocked.text

    # The list reports the quota for the "X of Y" display.
    listing = (await client.get("/api/v1/team?limit=100", headers=headers)).json()
    assert listing["member_limit"] == current_active + 1
    assert listing["active_members"] == current_active + 1

    # SUPER ADMIN EXEMPTION (client 15/09 clarification): the cap binds the
    # hotel side only — the platform admin can grant a member BEYOND the cap.
    from uuid import uuid4

    from app.services.auth import create_user

    sa_email = f"root-{uuid4().hex[:8]}@example.org"
    await create_user(
        db_session,
        email=sa_email,
        password="SuperSecret123!",
        full_name="Platform Root",
        is_super_admin=True,
    )
    await db_session.commit()
    sa_headers = {
        **auth_headers(await login(client, sa_email, "SuperSecret123!")),
        "X-Hotel-Id": str(hotel_a.hotel.id),
    }
    granted = await client.post(
        "/api/v1/team", json=_member_body(3), headers=sa_headers
    )
    assert granted.status_code == 201, granted.text

    # The hotel itself is STILL capped after the grant.
    still_blocked = await client.post(
        "/api/v1/team", json=_member_body(4), headers=headers
    )
    assert still_blocked.status_code == 422
    assert "team_limit_reached" in still_blocked.text

    # Raising the limit (super admin action) lets the hotel add again.
    await db_session.execute(
        update(Hotel)
        .where(Hotel.id == hotel_a.hotel.id)
        .values(max_team_members=current_active + 3)
    )
    await db_session.commit()
    ok2 = await client.post("/api/v1/team", json=_member_body(2), headers=headers)
    assert ok2.status_code == 201, ok2.text
