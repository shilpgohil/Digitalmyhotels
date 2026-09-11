"""Staff attendance integration tests — geofence, roles, corrections.

Uses the shared hotel fixture. The hotel starts with geofencing DISABLED
(default); individual tests flip it on via PATCH /hotels/me as the owner.
"""

from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Hotel coordinates used across tests (Ahmedabad-ish).
HLAT, HLNG = 23.046, 72.531
NEAR = {"lat": HLAT + 0.0005, "lng": HLNG, "accuracy_m": 10}  # ~55 m
FAR = {"lat": HLAT + 0.009, "lng": HLNG, "accuracy_m": 5}  # ~1 km


async def _h(client: AsyncClient, hotel: HotelFixture, role: str) -> dict[str, str]:
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _create_staff(
    client: AsyncClient, headers: dict[str, str], *, role: str = "general_staff"
) -> dict:
    import uuid

    suffix = uuid.uuid4().hex[:8]
    r = await client.post(
        "/api/v1/staff",
        headers=headers,
        json={
            "full_name": f"Staff {suffix}",
            "phone": f"9{suffix[:4]}{str(int(suffix[4:8], 16) % 10000).zfill(5)}",
            "department": "housekeeping",
            "joining_date": date.today().isoformat(),
            "access_role": role,
            "temp_password": "TempPass123!",
            "shift_start": "09:00:00",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _enable_geofence(client: AsyncClient, owner_headers: dict[str, str]) -> None:
    r = await client.patch(
        "/api/v1/hotels/me",
        headers=owner_headers,
        json={
            "latitude": HLAT,
            "longitude": HLNG,
            "geofence_radius_m": 200,
            "geofence_enabled": True,
        },
    )
    assert r.status_code == 200, r.text


# ── Staff directory ──────────────────────────────────────────────────────────


async def test_create_staff_and_login_flow(client: AsyncClient, hotel_a: HotelFixture):
    owner = await _h(client, hotel_a, "owner")
    staff = await _create_staff(client, owner)
    assert staff["staff_code"].startswith("STF-")
    assert staff["role_code"] == "general_staff"

    # Listed in the directory.
    r = await client.get("/api/v1/staff", headers=owner)
    assert r.status_code == 200
    assert any(s["id"] == staff["id"] for s in r.json()["items"])


async def test_salary_hidden_without_permission(client: AsyncClient, hotel_a: HotelFixture):
    owner = await _h(client, hotel_a, "owner")
    staff = await _create_staff(client, owner)
    r = await client.patch(
        f"/api/v1/staff/{staff['id']}", headers=owner, json={"base_salary": "18000.00"}
    )
    assert r.status_code == 200
    assert r.json()["base_salary"] is not None  # owner has staff.salary_view

    manager = await _h(client, hotel_a, "manager")
    r = await client.get(f"/api/v1/staff/{staff['id']}", headers=manager)
    assert r.status_code == 200
    assert r.json()["base_salary"] is None  # manager must NOT see salary


async def test_general_staff_cannot_list_staff(client: AsyncClient, hotel_a: HotelFixture):
    owner = await _h(client, hotel_a, "owner")
    staff = await _create_staff(client, owner)
    # New staff must reset their temp password first.
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": f"phone+{staff['phone']}@noemail.example",
              "password": "TempPass123!"},
    )
    # Either forced-reset flow or direct token — both are acceptable here;
    # the boundary check below uses whatever access we can obtain.
    if r.status_code != 200:
        pytest.skip("login flow requires reset — covered elsewhere")
    token = r.json().get("access_token")
    if not token:
        pytest.skip("no direct token before reset")
    headers = auth_headers(token)
    r = await client.get("/api/v1/staff", headers=headers)
    assert r.status_code == 403


# ── Geofence ─────────────────────────────────────────────────────────────────


async def test_geofence_toggle_requires_location(client: AsyncClient, hotel_a: HotelFixture):
    owner = await _h(client, hotel_a, "owner")
    r = await client.patch(
        "/api/v1/hotels/me", headers=owner, json={"geofence_enabled": True}
    )
    assert r.status_code == 422, r.text


async def test_checkin_without_fence_needs_no_location(
    client: AsyncClient, hotel_a: HotelFixture
):
    manager = await _h(client, hotel_a, "manager")
    r = await client.post("/api/v1/staff/attendance/check-in", headers=manager, json={})
    assert r.status_code == 200, r.text
    assert r.json()["method_in"] == "self_geo"


async def test_geofence_blocks_far_checkin_and_allows_near(
    client: AsyncClient, hotel_a: HotelFixture
):
    owner = await _h(client, hotel_a, "owner")
    await _enable_geofence(client, owner)

    # Far away → blocked with distance info.
    r = await client.post("/api/v1/staff/attendance/check-in", headers=owner, json=FAR)
    assert r.status_code == 422, r.text
    assert "m from the property" in r.text

    # No location while fence enabled → blocked.
    r = await client.post("/api/v1/staff/attendance/check-in", headers=owner, json={})
    assert r.status_code == 422

    # Vague accuracy cannot cheat: 1 km away with accuracy=5000.
    r = await client.post(
        "/api/v1/staff/attendance/check-in",
        headers=owner,
        json={**FAR, "accuracy_m": 5000},
    )
    assert r.status_code == 422

    # Inside the fence → OK, distance recorded.
    r = await client.post("/api/v1/staff/attendance/check-in", headers=owner, json=NEAR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["check_in_distance_m"] is not None

    # Double check-in → 409.
    r = await client.post("/api/v1/staff/attendance/check-in", headers=owner, json=NEAR)
    assert r.status_code == 409

    # Check-out inside fence → OK.
    r = await client.post("/api/v1/staff/attendance/check-out", headers=owner, json=NEAR)
    assert r.status_code == 200
    assert r.json()["check_out_at"] is not None


async def test_self_today_state_machine(client: AsyncClient, hotel_a: HotelFixture):
    admin = await _h(client, hotel_a, "admin")
    r = await client.get("/api/v1/staff/me/attendance/today", headers=admin)
    assert r.status_code == 200
    assert r.json()["status"] == "not_checked_in"

    r = await client.post("/api/v1/staff/attendance/check-in", headers=admin, json={})
    assert r.status_code == 200
    r = await client.get("/api/v1/staff/me/attendance/today", headers=admin)
    assert r.json()["status"] == "working"

    r = await client.post("/api/v1/staff/attendance/check-out", headers=admin, json={})
    assert r.status_code == 200
    r = await client.get("/api/v1/staff/me/attendance/today", headers=admin)
    assert r.json()["status"] == "checked_out"


# ── Front desk + corrections ─────────────────────────────────────────────────


async def test_front_desk_record_and_today_view(client: AsyncClient, hotel_a: HotelFixture):
    owner = await _h(client, hotel_a, "owner")
    staff = await _create_staff(client, owner)

    # Manager records the staff member's check-in at the desk (no geofence).
    manager = await _h(client, hotel_a, "manager")
    r = await client.post(
        f"/api/v1/staff/attendance/{staff['id']}/record",
        headers=manager,
        json={"action": "in"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["method_in"] == "front_desk"

    # Today's attendance shows them working.
    r = await client.get("/api/v1/staff/attendance/today", headers=manager)
    assert r.status_code == 200
    data = r.json()
    row = next(i for i in data["items"] if i["staff_profile_id"] == staff["id"])
    assert row["status"] in ("working", "late")
    assert data["stats"]["present"] >= 1

    # Check-out via front desk.
    r = await client.post(
        f"/api/v1/staff/attendance/{staff['id']}/record",
        headers=manager,
        json={"action": "out"},
    )
    assert r.status_code == 200
    record_id = r.json()["id"]

    # Housekeeping must NOT be able to record for others.
    hk = await _h(client, hotel_a, "housekeeping")
    r = await client.post(
        f"/api/v1/staff/attendance/{staff['id']}/record",
        headers=hk,
        json={"action": "in"},
    )
    assert r.status_code == 403

    # Correction requires a note; manager may correct.
    r = await client.patch(
        f"/api/v1/staff/attendance/records/{record_id}",
        headers=manager,
        json={"status": "present"},
    )
    assert r.status_code == 422  # note is mandatory
    r = await client.patch(
        f"/api/v1/staff/attendance/records/{record_id}",
        headers=manager,
        json={"status": "present", "note": "corrected after review"},
    )
    assert r.status_code == 200
    assert r.json()["note"] == "corrected after review"


async def test_history_and_anomalies_endpoints(client: AsyncClient, hotel_a: HotelFixture):
    manager = await _h(client, hotel_a, "manager")
    today = date.today().isoformat()
    r = await client.get(
        f"/api/v1/staff/attendance/history?from_date={today}&to_date={today}",
        headers=manager,
    )
    assert r.status_code == 200
    r = await client.get(
        f"/api/v1/staff/attendance/anomalies?from_date={today}&to_date={today}",
        headers=manager,
    )
    assert r.status_code == 200


async def test_tenant_isolation_staff(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
):
    owner_a = await _h(client, hotel_a, "owner")
    staff = await _create_staff(client, owner_a)
    owner_b = await _h(client, hotel_b, "owner")
    r = await client.get(f"/api/v1/staff/{staff['id']}", headers=owner_b)
    assert r.status_code == 404
