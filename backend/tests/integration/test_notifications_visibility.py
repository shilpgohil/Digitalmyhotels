"""Notification role-visibility + per-user read receipts (client 9-08 items 1/2/35).

- Housekeeping only sees housekeeping/operations categories; finance and
  admin content is Owner/Manager only.
- Read state is PER USER: one person reading a hotel-wide alert must not
  mark it read for everyone else.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _seed_notifications(db_session, hotel_id) -> None:
    from app.services.notifications import create_notification

    for category, title in (
        ("finance", "Payment collected"),
        ("front_desk", "Guest arriving today"),
        ("housekeeping", "Room 101 needs cleaning"),
        ("admin", "Team member added"),
    ):
        await create_notification(
            db_session,
            hotel_id=hotel_id,
            user_id=None,
            type=f"test.{category}",
            title=title,
            body=f"{title} body",
            category=category,
        )
    await db_session.commit()


async def test_categories_are_role_filtered(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    await _seed_notifications(db_session, hotel_a.hotel.id)

    owner = await _headers(client, hotel_a, "owner")
    owner_list = await client.get("/api/v1/notifications", headers=owner)
    assert owner_list.status_code == 200, owner_list.text
    owner_cats = {n["category"] for n in owner_list.json()["items"]}
    assert {"finance", "front_desk", "housekeeping", "admin"} <= owner_cats
    assert set(owner_list.json()["allowed_categories"]) >= {
        "finance",
        "front_desk",
        "housekeeping",
        "operations",
        "admin",
        "platform",
    }

    # Reception (admin role): operations yes, finance/admin categories never.
    reception = await _headers(client, hotel_a, "admin")
    reception_list = await client.get("/api/v1/notifications", headers=reception)
    rec_cats = {n["category"] for n in reception_list.json()["items"]}
    assert "finance" not in rec_cats
    assert "admin" not in rec_cats
    assert "front_desk" in rec_cats
    assert set(reception_list.json()["allowed_categories"]) == {
        "front_desk",
        "housekeeping",
        "operations",
    }

    # Housekeeping: housekeeping/operations only.
    hk = await _headers(client, hotel_a, "housekeeping")
    hk_list = await client.get("/api/v1/notifications", headers=hk)
    hk_cats = {n["category"] for n in hk_list.json()["items"]}
    assert hk_cats <= {"housekeeping", "operations"}
    assert "Room 101 needs cleaning" in {n["title"] for n in hk_list.json()["items"]}


async def test_read_state_is_per_user(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    await _seed_notifications(db_session, hotel_a.hotel.id)

    owner = await _headers(client, hotel_a, "owner")
    manager = await _headers(client, hotel_a, "manager")

    owner_before = (await client.get("/api/v1/notifications", headers=owner)).json()
    manager_before = (await client.get("/api/v1/notifications", headers=manager)).json()
    assert owner_before["unread"] >= 4
    assert manager_before["unread"] >= 4

    # Owner reads one specific notification.
    first_id = owner_before["items"][0]["id"]
    marked = await client.post(f"/api/v1/notifications/{first_id}/read", headers=owner)
    assert marked.status_code == 200, marked.text
    assert marked.json()["is_read"] is True

    owner_after_one = (await client.get("/api/v1/notifications", headers=owner)).json()
    assert owner_after_one["unread"] == owner_before["unread"] - 1

    # Manager's unread count is untouched by the owner's receipt.
    manager_after = (await client.get("/api/v1/notifications", headers=manager)).json()
    assert manager_after["unread"] == manager_before["unread"]

    # Owner clears everything — still only affects the owner.
    cleared = await client.post("/api/v1/notifications/mark-all-read", headers=owner)
    assert cleared.status_code == 200
    owner_final = (await client.get("/api/v1/notifications", headers=owner)).json()
    assert owner_final["unread"] == 0
    manager_final = (await client.get("/api/v1/notifications", headers=manager)).json()
    assert manager_final["unread"] == manager_before["unread"]

    # unread_only honours the per-user receipts.
    unread_only = (
        await client.get("/api/v1/notifications?unread_only=true", headers=owner)
    ).json()
    assert unread_only["items"] == []
