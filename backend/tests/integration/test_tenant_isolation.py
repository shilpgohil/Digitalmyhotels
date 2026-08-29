"""Tenant escape attempts — hotel A staff must never touch hotel B data."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_hotel_header_cannot_switch_to_foreign_hotel(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    email, password = hotel_a.credentials("owner")
    token = await login(client, email, password)
    headers = {**auth_headers(token), "X-Hotel-Id": str(hotel_b.hotel.id)}

    resp = await client.get("/api/v1/hotels/me", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] in {"no_membership", "hotel_forbidden"}


async def test_rooms_are_scoped_to_own_hotel(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    # Owner A creates a room type + room.
    email_a, pw_a = hotel_a.credentials("owner")
    headers_a = auth_headers(await login(client, email_a, pw_a))
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "DLX", "name": "Deluxe", "base_price": "2500.00"},
        headers=headers_a,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "101", "room_type_id": rt.json()["id"]},
        headers=headers_a,
    )
    assert room.status_code == 201, room.text
    room_id = room.json()["id"]

    # Owner B cannot see or mutate A's room.
    email_b, pw_b = hotel_b.credentials("owner")
    headers_b = auth_headers(await login(client, email_b, pw_b))

    listing = await client.get("/api/v1/rooms", headers=headers_b)
    assert listing.status_code == 200
    assert all(r["id"] != room_id for r in listing.json()["items"])

    mutate = await client.patch(
        f"/api/v1/rooms/{room_id}", json={"notes": "hacked"}, headers=headers_b
    )
    assert mutate.status_code == 404

    status_change = await client.put(
        f"/api/v1/rooms/{room_id}/status",
        json={"status": "maintenance"},
        headers=headers_b,
    )
    assert status_change.status_code == 404


async def test_team_listing_is_scoped(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    email_a, pw_a = hotel_a.credentials("owner")
    headers_a = auth_headers(await login(client, email_a, pw_a))
    resp = await client.get("/api/v1/team", headers=headers_a)
    assert resp.status_code == 200
    emails = {m["email"] for m in resp.json()["items"]}
    assert hotel_a.credentials("manager")[0] in emails
    assert hotel_b.credentials("manager")[0] not in emails
