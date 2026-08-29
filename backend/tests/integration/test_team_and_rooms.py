from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str) -> dict[str, str]:
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


class TestTeamRules:
    async def test_owner_creates_member_and_manager_cannot(
        self, client: AsyncClient, hotel_a: HotelFixture
    ) -> None:
        owner = await _headers(client, hotel_a, "owner")
        created = await client.post(
            "/api/v1/team",
            json={
                "full_name": "New Receptionist",
                "email": f"reception-{hotel_a.hotel.slug}@example.org",
                "role_code": "admin",
                "password": "Password123!",
            },
            headers=owner,
        )
        assert created.status_code == 201, created.text
        assert created.json()["role_code"] == "admin"

        manager = await _headers(client, hotel_a, "manager")
        denied = await client.post(
            "/api/v1/team",
            json={
                "full_name": "Sneaky",
                "email": f"sneaky-{hotel_a.hotel.slug}@example.org",
                "role_code": "admin",
                "password": "Password123!",
            },
            headers=manager,
        )
        assert denied.status_code == 403

    async def test_owner_cannot_create_another_owner(
        self, client: AsyncClient, hotel_a: HotelFixture
    ) -> None:
        owner = await _headers(client, hotel_a, "owner")
        resp = await client.post(
            "/api/v1/team",
            json={
                "full_name": "Second Owner",
                "email": f"owner2-{hotel_a.hotel.slug}@example.org",
                "role_code": "owner",
                "password": "Password123!",
            },
            headers=owner,
        )
        assert resp.status_code == 422

    async def test_disable_member_blocks_login(
        self, client: AsyncClient, hotel_a: HotelFixture
    ) -> None:
        owner = await _headers(client, hotel_a, "owner")
        team = await client.get("/api/v1/team", headers=owner)
        hk = next(
            m for m in team.json()["items"] if m["role_code"] == "housekeeping"
        )
        resp = await client.put(
            f"/api/v1/team/{hk['membership_id']}/status",
            json={"enabled": False},
            headers=owner,
        )
        assert resp.status_code == 200
        email, password = hotel_a.credentials("housekeeping")
        blocked = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "account_disabled"


class TestRoomWorkflow:
    async def test_room_type_and_room_crud_with_status_flow(
        self, client: AsyncClient, hotel_a: HotelFixture
    ) -> None:
        owner = await _headers(client, hotel_a, "owner")
        rt = await client.post(
            "/api/v1/rooms/types",
            json={
                "code": "STD",
                "name": "Standard",
                "base_price": "1800.00",
                "extra_guest_price": "300.00",
                "max_occupancy": 3,
            },
            headers=owner,
        )
        assert rt.status_code == 201, rt.text

        room = await client.post(
            "/api/v1/rooms",
            json={
                "room_number": "204",
                "floor": "2",
                "room_type_id": rt.json()["id"],
                "amenities": ["AC", "WiFi", "TV"],
            },
            headers=owner,
        )
        assert room.status_code == 201, room.text
        body = room.json()
        assert body["status"] == "available"
        assert set(body["amenities"]) == {"AC", "WiFi", "TV"}
        room_id = body["id"]

        dup = await client.post(
            "/api/v1/rooms",
            json={"room_number": "204", "room_type_id": rt.json()["id"]},
            headers=owner,
        )
        assert dup.status_code == 409

        # Housekeeping can move a room through the cleaning flow but the
        # state machine blocks invalid jumps.
        hk = await _headers(client, hotel_a, "housekeeping")
        invalid = await client.put(
            f"/api/v1/rooms/{room_id}/status",
            json={"status": "cleaning_in_progress"},
            headers=hk,
        )
        assert invalid.status_code == 409

        to_maintenance = await client.put(
            f"/api/v1/rooms/{room_id}/status",
            json={"status": "maintenance", "reason": "AC repair"},
            headers=hk,
        )
        assert to_maintenance.status_code == 200
        assert to_maintenance.json()["status"] == "maintenance"

        manual_occupy = await client.put(
            f"/api/v1/rooms/{room_id}/status",
            json={"status": "occupied"},
            headers=hk,
        )
        assert manual_occupy.status_code == 422

        summary = await client.get("/api/v1/rooms/status-summary", headers=owner)
        assert summary.status_code == 200
        assert summary.json()["counts"].get("maintenance", 0) >= 1

    async def test_housekeeping_cannot_manage_rooms(
        self, client: AsyncClient, hotel_a: HotelFixture
    ) -> None:
        hk = await _headers(client, hotel_a, "housekeeping")
        resp = await client.post(
            "/api/v1/rooms/types",
            json={"code": "X", "name": "X", "base_price": "1.00"},
            headers=hk,
        )
        assert resp.status_code == 403
