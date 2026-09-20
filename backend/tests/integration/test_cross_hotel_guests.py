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


async def test_cross_hotel_search_and_import_by_id_last4(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    """Aadhaar last-4 search must ALSO cross hotels (client 20/09/2026), and
    the last-4 is accepted as the import knowledge proof."""
    headers_b = await _headers(client, hotel_b)
    guest = await client.post(
        "/api/v1/guests",
        json={
            "full_name": "Last Four Guest",
            "phone": "9877700022",
            "id_proof_type": "Aadhar Card",
            "id_number": "999988885678",
        },
        headers=headers_b,
    )
    assert guest.status_code == 201, guest.text
    source_id = guest.json()["id"]
    doc = await client.post(
        f"/api/v1/guests/{source_id}/documents",
        data={"side": "front", "document_type": "id_proof"},
        files={"file": ("front.png", io.BytesIO(b"\x89PNG fakedata"), "image/png")},
        headers=headers_b,
    )
    assert doc.status_code == 201, doc.text

    headers_a = await _headers(client, hotel_a)

    # Last-4 search finds the other hotel's guest, masked + flagged.
    res = await client.get("/api/v1/guests/search?id_last4=5678", headers=headers_a)
    assert res.status_code == 200, res.text
    cross = [item for item in res.json()["items"] if item.get("cross_hotel")]
    assert cross, "last-4 search must surface the other hotel's guest"
    assert cross[0]["id"] == source_id
    assert "9877700022" not in cross[0]["phone_masked"]

    # Wrong last-4 proof → rejected (no enumeration).
    bad = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "id_last4": "0000"},
        headers=headers_a,
    )
    assert bad.status_code == 404, bad.text

    # Correct last-4 proof → imported with base data + copied document.
    imported = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "id_last4": "5678"},
        headers=headers_a,
    )
    assert imported.status_code == 201, imported.text
    body = imported.json()
    assert body["id"] != source_id
    assert body["full_name"] == "Last Four Guest"
    docs = await client.get(
        f"/api/v1/guests/{body['id']}/documents", headers=headers_a
    )
    assert docs.status_code == 200
    assert len(docs.json()) == 1


async def test_import_proof_validation(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    """Exactly ONE proof (phone or id_last4) must be provided."""
    headers_b = await _headers(client, hotel_b)
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Proof Validation Guest", "phone": "9877700033"},
        headers=headers_b,
    )
    assert guest.status_code == 201, guest.text
    source_id = guest.json()["id"]

    headers_a = await _headers(client, hotel_a)
    neither = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id},
        headers=headers_a,
    )
    assert neither.status_code == 422, neither.text
    both = await client.post(
        "/api/v1/guests/import",
        json={
            "source_guest_id": source_id,
            "phone": "9877700033",
            "id_last4": "1234",
        },
        headers=headers_a,
    )
    assert both.status_code == 422, both.text


async def test_import_gap_fills_missing_document_sides(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    """When the guest ALREADY exists locally, importing gap-fills only the
    document sides the local record is missing — locally captured photos are
    never overwritten (client 20/09/2026)."""
    phone = "9877700044"

    # Hotel B (source): guest with front + selfie.
    headers_b = await _headers(client, hotel_b)
    src = await client.post(
        "/api/v1/guests",
        json={"full_name": "Gap Fill Guest", "phone": phone},
        headers=headers_b,
    )
    assert src.status_code == 201, src.text
    source_id = src.json()["id"]
    for side, name in (("front", "front.png"), ("selfie", "selfie.png")):
        up = await client.post(
            f"/api/v1/guests/{source_id}/documents",
            data={"side": side, "document_type": "id_proof"},
            files={"file": (name, io.BytesIO(b"\x89PNG source"), "image/png")},
            headers=headers_b,
        )
        assert up.status_code == 201, up.text

    # Hotel A (local): SAME phone registered independently, only a front doc.
    headers_a = await _headers(client, hotel_a)
    local = await client.post(
        "/api/v1/guests",
        json={"full_name": "Gap Fill Guest", "phone": phone},
        headers=headers_a,
    )
    assert local.status_code == 201, local.text
    local_id = local.json()["id"]
    up = await client.post(
        f"/api/v1/guests/{local_id}/documents",
        data={"side": "front", "document_type": "id_proof"},
        files={"file": ("front.png", io.BytesIO(b"\x89PNG local"), "image/png")},
        headers=headers_a,
    )
    assert up.status_code == 201, up.text
    local_front_id = up.json()["id"]

    # Import → returns the EXISTING local guest, selfie gap-filled from B,
    # local front untouched (no duplicate front).
    imported = await client.post(
        "/api/v1/guests/import",
        json={"source_guest_id": source_id, "phone": phone},
        headers=headers_a,
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["id"] == local_id

    docs = await client.get(
        f"/api/v1/guests/{local_id}/documents", headers=headers_a
    )
    assert docs.status_code == 200
    items = docs.json()
    sides = sorted(d["side"] for d in items)
    assert sides == ["front", "selfie"], f"expected gap-filled selfie, got {sides}"
    front = next(d for d in items if d["side"] == "front")
    assert front["id"] == local_front_id, "local front must NOT be replaced"
