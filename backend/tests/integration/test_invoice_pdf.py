"""End-to-end test for invoice generation and PDF rendering.

Covers:
- Booking → check-in → generate invoice (financial math)
- PDF rendering returns valid PDF bytes (fpdf2 path exercised live)
- Invoice totals reconcile with booking amounts
- Duplicate invoice rejected
- Cancelled invoice can be recreated
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()
_PDF_MAGIC = b"%PDF"


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _full_booking_checked_in(
    client: AsyncClient, headers, *, base_price: str = "2500.00", nights: int = 2
) -> tuple[str, str]:
    """Returns (booking_id, room_id)."""
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "INV-TYPE", "name": "Invoice Test", "base_price": base_price},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "INV-101", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    room_id = room.json()["id"]

    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Invoice Guest", "phone": "9899000001"},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text

    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room_id],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=nights)),
            "adults": 1,
        },
        headers=headers,
    )
    assert booking.status_code == 201, booking.text
    booking_id = booking.json()["id"]

    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking_id},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text
    return booking_id, room_id


async def test_invoice_generation_and_pdf_render(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Complete path: create booking → check in → generate invoice → download PDF."""
    headers = await _headers(client, hotel_a)
    booking_id, _ = await _full_booking_checked_in(
        client, headers, base_price="3000.00", nights=2
    )

    # Generate invoice
    inv_resp = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert inv_resp.status_code == 201, inv_resp.text
    inv = inv_resp.json()
    invoice_id = inv["id"]

    # Invoice must have at least one line item (the room charge).
    assert len(inv["items"]) >= 1

    # Subtotal = base_price × nights = 3000 × 2 = 6000 (no GST configured by default).
    assert Decimal(inv["subtotal"]) == Decimal("6000.00"), inv

    # total_amount must equal subtotal + taxes − discount.
    computed = (
        Decimal(inv["subtotal"])
        + Decimal(inv["cgst_amount"])
        + Decimal(inv["sgst_amount"])
        + Decimal(inv["igst_amount"])
        - Decimal(inv["discount_amount"])
    )
    assert Decimal(inv["total_amount"]) == computed, f"Total mismatch: {inv}"

    # Download the PDF — verify it starts with the PDF magic header.
    pdf_resp = await client.get(f"/api/v1/invoices/{invoice_id}/pdf", headers=headers)
    assert pdf_resp.status_code == 200, pdf_resp.text
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert pdf_resp.content[:4] == _PDF_MAGIC, (
        f"Response does not look like a PDF: {pdf_resp.content[:16]!r}"
    )
    # A reasonable PDF should be at least 1 KB.
    assert len(pdf_resp.content) > 1024, "PDF seems unexpectedly small"


async def test_duplicate_invoice_rejected(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """A second invoice for the same booking must be rejected with invoice_exists."""
    headers = await _headers(client, hotel_a)
    booking_id, _ = await _full_booking_checked_in(
        client, headers, base_price="1500.00", nights=1
    )

    first = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "invoice_exists"


async def test_cancelled_invoice_allows_new_one(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """After cancelling an invoice, a new one can be generated for the same booking."""
    headers = await _headers(client, hotel_a)
    booking_id, _ = await _full_booking_checked_in(
        client, headers, base_price="2000.00", nights=1
    )

    first = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    inv_id = first.json()["id"]

    cancel = await client.post(
        f"/api/v1/invoices/{inv_id}/cancel",
        json={"reason": "Wrong invoice issued"},
        headers=headers,
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"

    # Should now be able to create a new invoice.
    replacement = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert replacement.status_code == 201, replacement.text
    assert replacement.json()["invoice_number"] != first.json()["invoice_number"]


async def test_invoice_with_hotel_charges(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Invoice must include non-voided hotel charges as line items."""
    headers = await _headers(client, hotel_a)
    booking_id, _ = await _full_booking_checked_in(
        client, headers, base_price="2000.00", nights=1
    )

    # Add a food charge.
    charge_resp = await client.post(
        "/api/v1/charges",
        json={
            "booking_id": booking_id,
            "category": "food",
            "description": "Breakfast",
            "quantity": 2,
            "rate": "250.00",
            "apply_gst": False,
        },
        headers=headers,
    )
    assert charge_resp.status_code == 201, charge_resp.text

    inv_resp = await client.post(
        "/api/v1/invoices",
        json={"booking_id": booking_id, "interstate": False},
        headers=headers,
    )
    assert inv_resp.status_code == 201, inv_resp.text
    inv = inv_resp.json()

    descriptions = [item["description"] for item in inv["items"]]
    assert any("food" in d.lower() or "breakfast" in d.lower() for d in descriptions), (
        f"Charge not found in invoice items: {descriptions}"
    )
    # total = room (2000) + food (500) = 2500
    assert Decimal(inv["total_amount"]) == Decimal("2500.00"), inv
