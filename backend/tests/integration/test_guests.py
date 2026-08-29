from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "admin"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


GUEST = {
    "full_name": "Arjun Mehta",
    "phone": "+91 98765 43210",
    "email": "arjun@example.org",
    "city": "Mumbai",
    "id_proof_type": "aadhaar",
    "id_number": "123412341234",
}


async def test_create_guest_and_duplicate_phone_conflict(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    created = await client.post("/api/v1/guests", json=GUEST, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["normalized_phone"] == "9876543210"
    assert body["id_last4"] == "1234"
    # Full ID number never appears in list/detail payloads.
    assert "123412341234" not in created.text

    dup = await client.post("/api/v1/guests", json=GUEST, headers=headers)
    assert dup.status_code == 409


async def test_search_by_phone_and_last4_then_autofill(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await client.post(
        "/api/v1/guests",
        json={**GUEST, "phone": "9812345678", "id_number": "999988887777"},
        headers=headers,
    )

    by_phone = await client.get(
        "/api/v1/guests/search?phone=9812345678", headers=headers
    )
    assert by_phone.status_code == 200
    hits = by_phone.json()["items"]
    assert len(hits) == 1
    # Search hits are masked and minimal.
    assert hits[0]["phone_masked"].endswith("5678")
    assert "*" in hits[0]["phone_masked"]

    by_last4 = await client.get("/api/v1/guests/search?id_last4=7777", headers=headers)
    assert by_last4.status_code == 200
    assert len(by_last4.json()["items"]) == 1

    guest_id = hits[0]["id"]
    autofill = await client.post(f"/api/v1/guests/{guest_id}/autofill", headers=headers)
    assert autofill.status_code == 200
    data = autofill.json()
    assert data["full_name"] == GUEST["full_name"]
    assert data["phone"] == "9812345678"
    # The non-negotiable rule: no booking history in the autofill payload.
    assert "booking" not in autofill.text.lower()
    assert "stay" not in autofill.text.lower()


async def test_guests_are_tenant_scoped(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers_a = await _headers(client, hotel_a)
    created = await client.post(
        "/api/v1/guests", json={**GUEST, "phone": "9700000001"}, headers=headers_a
    )
    guest_id = created.json()["id"]

    headers_b = await _headers(client, hotel_b)
    stolen = await client.get(f"/api/v1/guests/{guest_id}", headers=headers_b)
    assert stolen.status_code == 404
    search = await client.get("/api/v1/guests/search?phone=9700000001", headers=headers_b)
    assert search.json()["items"] == []
