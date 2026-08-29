"""Service items, guest documents, payment summary, GST by booking, renewal request."""

from __future__ import annotations

import io
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = date.today()

PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\x00\x00\x00\x03\x00\x01\x9a\x9e\xcc\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "owner"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def test_service_items_crud_and_permissions(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner = await _headers(client, hotel_a, "owner")
    created = await client.post(
        "/api/v1/hotels/me/services",
        json={"name": "Airport Pickup", "price": "600.00"},
        headers=owner,
    )
    assert created.status_code == 201, created.text
    service_id = created.json()["id"]

    # Housekeeping can view active services but not manage them.
    hk = await _headers(client, hotel_a, "housekeeping")
    listing = await client.get("/api/v1/hotels/me/services", headers=hk)
    assert listing.status_code == 200
    assert any(s["id"] == service_id for s in listing.json())
    forbidden = await client.post(
        "/api/v1/hotels/me/services",
        json={"name": "Nope", "price": "1.00"},
        headers=hk,
    )
    assert forbidden.status_code == 403

    deactivated = await client.patch(
        f"/api/v1/hotels/me/services/{service_id}",
        json={"is_active": False},
        headers=owner,
    )
    assert deactivated.status_code == 200
    active_only = await client.get("/api/v1/hotels/me/services", headers=owner)
    assert all(s["id"] != service_id for s in active_only.json())


async def test_guest_document_upload_and_download(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a, "admin")
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Doc Guest", "phone": "9877700001"},
        headers=headers,
    )
    guest_id = guest.json()["id"]

    upload = await client.post(
        f"/api/v1/guests/{guest_id}/documents",
        data={"side": "front", "document_type": "aadhaar"},
        files={"file": ("front.png", io.BytesIO(PNG_1PX), "image/png")},
        headers=headers,
    )
    assert upload.status_code == 201, upload.text
    doc_id = upload.json()["id"]

    docs = await client.get(f"/api/v1/guests/{guest_id}/documents", headers=headers)
    assert docs.status_code == 200
    assert docs.json()[0]["side"] == "front"

    file_resp = await client.get(
        f"/api/v1/guests/{guest_id}/documents/{doc_id}/file", headers=headers
    )
    assert file_resp.status_code == 200
    assert file_resp.headers["content-type"] == "image/png"

    bad_side = await client.post(
        f"/api/v1/guests/{guest_id}/documents",
        data={"side": "sideways"},
        files={"file": ("x.png", io.BytesIO(PNG_1PX), "image/png")},
        headers=headers,
    )
    assert bad_side.status_code == 422


async def test_booking_carries_contact_vehicle_and_terms(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a, "owner")
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "GAP", "name": "Gap", "base_price": "900.00"},
        headers=headers,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={
            "room_number": "701",
            "room_type_id": rt.json()["id"],
            "bed_type": "King Size",
        },
        headers=headers,
    )
    assert room.json()["bed_type"] == "King Size"
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Contact Guest", "phone": "9877700002"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
            "emergency_contact_name": "Bhai",
            "emergency_contact_phone": "9000000001",
            "vehicle_number": "GJ01AB1234",
            "vehicle_type": "Car",
            "parking_slot": "P-4",
        },
        headers=headers,
    )
    assert booking.status_code == 201, booking.text
    assert booking.json()["emergency_contact_name"] == "Bhai"
    assert booking.json()["vehicle_number"] == "GJ01AB1234"

    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking.json()["id"], "terms_acknowledged": True},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text


async def test_payment_summary_and_gst_by_booking(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a, "owner")
    summary = await client.get("/api/v1/payments/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert {"total_collected", "cash", "upi", "refunds"} <= set(body)

    gst = await client.get(
        f"/api/v1/reports/gst/by-booking?from_date={TODAY - timedelta(days=30)}&to_date={TODAY}",
        headers=headers,
    )
    assert gst.status_code == 200, gst.text
    assert "items" in gst.json()

    # Workers get neither.
    hk = await _headers(client, hotel_a, "housekeeping")
    denied = await client.get("/api/v1/payments/summary", headers=hk)
    assert denied.status_code == 403


async def test_renewal_request_notifies_and_audits(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a, "owner")
    resp = await client.post(
        "/api/v1/subscriptions/me/renewal-request?plan_code=standard", headers=headers
    )
    assert resp.status_code == 200, resp.text

    audit = await client.get(
        "/api/v1/audit-logs?action=subscriptions.renewal_requested", headers=headers
    )
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1

    # Housekeeping cannot request renewals.
    hk = await _headers(client, hotel_a, "housekeeping")
    denied = await client.post("/api/v1/subscriptions/me/renewal-request", headers=hk)
    assert denied.status_code == 403
