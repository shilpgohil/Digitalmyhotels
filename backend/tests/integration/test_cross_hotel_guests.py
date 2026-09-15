"""Cross-hotel guest search + import (plan §1.7, client 15/09/2026).

The ONE intended cross-hotel data share: a guest of Hotel B is findable from
Hotel A by FULL phone number (masked result), and an explicit phone-proofed
import copies base data + ID documents into Hotel A. Prefix searches stay
hotel-local; wrong phone proof is rejected; import is idempotent.
"""

from __future__ import annotations

import io

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

PHONE = "9877700011"


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    token = await login(client, email, password)
    return {**auth_headers(token), "X-Hotel-Id": str(hotel.hotel.id)}


async def _make_source_guest(client: AsyncClient, headers) -> str:
    guest = await client.post(
        "/api/v1/guests",
        json={
            "full_name": "Cross Hotel Guest",
            "phone": PHONE,
            "address": "12 Test Lane",
            "city": "Ahmedabad",
            "id_proof_type": "Aadhar Card",
            "id_number": "123412341234",
        },
        headers=headers,
    )
    assert guest.status_code == 201, guest.text
    guest_id = guest.json()["id"]
    # Attach a front-side ID document.
    doc = await client.post(
        f"/api/v1/guests/{guest_id}/documents",
        data={"side": "front", "document_type": "id_proof"},
        files={"file": ("front.png", io.BytesIO(b"\x89PNG fakedata"), "image/png")},
        headers=headers,
    )
    assert doc.status_code == 201, doc.text
    return guest_id


async def test_cross_hotel_search_and_import(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers_b = await _headers(client, hotel_b)
    source_id = await _make_source_guest(client, headers_b)

    headers_a = await _headers(client, hotel_a)

    # Prefix search must NOT cross hotels.
    prefix = await client.get(
        f"/api/v1/guests/search?phone={PHONE[:6]}", headers=headers_a
    )
    assert prefix.status_code == 200
    assert all(not item.get("cross_hotel") for item in prefix.json()["items"])

    # FULL phone search finds the other hotel's guest, masked + flagged.
    full = await client.get(f"/api/v1/guests/search?phone={PHONE}", headers=headers_a)
    assert full.status_code == 200, full.text
    cross = [item for item in full.json()["items"] if item.get("cross_hotel")]
    assert cross, "full-phone search must surface the other hotel's guest"
    hit = cross[0]
    assert hit["id"] == source_id
    assert PHONE not in hit["phone_masked"], "phone must be masked in results"

    # Wrong phone proof → rejected (no enumeration).
    bad = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "phone": "9999999999"},
        headers=headers_a,
    )
    assert bad.status_code == 404, bad.text

    # Correct proof → imported with base data; documents copied.
    imported = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "phone": PHONE},
        headers=headers_a,
    )
    assert imported.status_code == 201, imported.text
    body = imported.json()
    assert body["id"] != source_id
    assert body["full_name"] == "Cross Hotel Guest"
    assert body["city"] == "Ahmedabad"
    assert body["id_last4"] == "1234"

    docs = await client.get(
        f"/api/v1/guests/{body['id']}/documents", headers=headers_a
    )
    assert docs.status_code == 200
    assert len(docs.json()) == 1, "ID document must be copied into hotel A"

    # Idempotent: importing again returns the SAME local record.
    again = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "phone": PHONE},
        headers=headers_a,
    )
    assert again.status_code == 201
    assert again.json()["id"] == body["id"]
