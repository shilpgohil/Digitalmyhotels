"""Payments, charges, ledger, corrections, refunds, invoices — the money core."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture, role: str = "owner"):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def _checked_in_booking(client: AsyncClient, headers) -> dict:
    """Create room type + room + guest + booking + check-in. Returns booking JSON."""
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "STD", "name": "Standard", "base_price": "1000.00"},
        headers=headers,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "201", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Money Guest", "phone": "9866666666"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=2)),
        },
        headers=headers,
    )
    assert booking.status_code == 201, booking.text
    checkin = await client.post(
        "/api/v1/checkins", json={"booking_id": booking.json()["id"]}, headers=headers
    )
    assert checkin.status_code == 201, checkin.text
    return booking.json()


async def test_charge_payment_ledger_flow(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    booking = await _checked_in_booking(client, headers)
    booking_id = booking["id"]
    # 2 nights x 1000 = 2000 total

    # Register GST so charge taxes apply (6+6 = 12%).
    gst = await client.patch(
        "/api/v1/hotels/me/gst",
        json={"is_gst_registered": True, "gstin": "27ABCDE1234F1Z5", "state_code": "27"},
        headers=headers,
    )
    assert gst.status_code == 200, gst.text

    # Add a food charge: 2 x 250 = 500 taxable + 60 GST = 560.
    charge = await client.post(
        "/api/v1/charges",
        json={
            "booking_id": booking_id,
            "category": "food",
            "description": "Dinner",
            "quantity": 2,
            "rate": "250.00",
        },
        headers=headers,
    )
    assert charge.status_code == 201, charge.text
    assert charge.json()["tax_amount"] == "60.00"
    assert charge.json()["total_amount"] == "560.00"

    # Collect a partial cash payment of 1500.
    payment = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking_id, "amount": "1500.00", "method": "cash"},
        headers=headers,
    )
    assert payment.status_code == 201, payment.text

    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    body = detail.json()
    assert body["total_amount"] == "2560.00"
    assert body["advance_amount"] == "1500.00"
    assert body["due_amount"] == "1060.00"
    assert body["payment_status"] == "partial"

    # Ledger: debit 2000 (rooms), debit 560 (charge), credit 1500 → balance 1060.
    ledger = await client.get(f"/api/v1/payments/ledger/{booking_id}", headers=headers)
    assert ledger.status_code == 200
    assert ledger.json()["balance"] == "1060.00"
    entries = ledger.json()["items"]
    assert [e["entry_type"] for e in entries] == ["debit", "debit", "credit"]
    assert entries[-1]["balance_after"] == "1060.00"

    # Correct the payment 1500 → 1200: original marked corrected, new record.
    correction = await client.post(
        f"/api/v1/payments/{payment.json()['id']}/correct",
        json={"corrected_amount": "1200.00", "reason": "Cashier typo"},
        headers=headers,
    )
    assert correction.status_code == 200, correction.text
    assert correction.json()["corrects_payment_id"] == payment.json()["id"]

    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.json()["advance_amount"] == "1200.00"
    assert detail.json()["due_amount"] == "1360.00"

    # Refund 200.
    refund = await client.post(
        "/api/v1/payments/refunds",
        json={
            "booking_id": booking_id,
            "amount": "200.00",
            "method": "cash",
            "reason": "Overcharge adjustment",
        },
        headers=headers,
    )
    assert refund.status_code == 201, refund.text
    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.json()["advance_amount"] == "1000.00"

    # Void the charge — booking totals shrink, ledger credit appended.
    void = await client.post(
        f"/api/v1/charges/{charge.json()['id']}/void", headers=headers
    )
    assert void.status_code == 200, void.text
    detail = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)
    assert detail.json()["total_amount"] == "2000.00"


async def test_invoice_generation_and_cancel(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    booking = await _checked_in_booking(client, headers)
    booking_id = booking["id"]

    await client.patch(
        "/api/v1/hotels/me/gst",
        json={"is_gst_registered": True, "gstin": "27ABCDE1234F1Z5"},
        headers=headers,
    )

    invoice = await client.post(
        "/api/v1/invoices", json={"booking_id": booking_id}, headers=headers
    )
    assert invoice.status_code == 201, invoice.text
    body = invoice.json()
    # 2 nights x 1000 = 2000 taxable + 12% GST = 2240
    assert body["subtotal"] == "2000.00"
    assert body["cgst_amount"] == "120.00"
    assert body["sgst_amount"] == "120.00"
    assert body["total_amount"] == "2240.00"
    assert body["status"] == "generated"
    assert len(body["items"]) == 1

    # Numbering is sequential and hotel-scoped.
    assert "-" in body["invoice_number"]

    # Duplicate active invoice rejected.
    dup = await client.post(
        "/api/v1/invoices", json={"booking_id": booking_id}, headers=headers
    )
    assert dup.status_code == 409

    # PDF renders.
    pdf = await client.get(f"/api/v1/invoices/{body['id']}/pdf", headers=headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:5] == b"%PDF-"

    # Cancel with reason, then a fresh invoice may be generated.
    cancel = await client.post(
        f"/api/v1/invoices/{body['id']}/cancel",
        json={"reason": "Wrong guest details"},
        headers=headers,
    )
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    again = await client.post(
        "/api/v1/invoices", json={"booking_id": booking_id}, headers=headers
    )
    assert again.status_code == 201


async def test_admin_collects_but_cannot_correct_or_refund(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner_headers = await _headers(client, hotel_a)
    booking = await _checked_in_booking(client, owner_headers)

    admin_headers = await _headers(client, hotel_a, role="admin")
    payment = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking["id"], "amount": "500.00", "method": "upi"},
        headers=admin_headers,
    )
    assert payment.status_code == 201, payment.text

    correction = await client.post(
        f"/api/v1/payments/{payment.json()['id']}/correct",
        json={"corrected_amount": "400.00", "reason": "attempt"},
        headers=admin_headers,
    )
    assert correction.status_code == 403

    refund = await client.post(
        "/api/v1/payments/refunds",
        json={
            "booking_id": booking["id"],
            "amount": "100.00",
            "method": "cash",
            "reason": "attempt",
        },
        headers=admin_headers,
    )
    assert refund.status_code == 403


async def test_expense_workflow(client: AsyncClient, hotel_a: HotelFixture) -> None:
    owner = await _headers(client, hotel_a)
    admin = await _headers(client, hotel_a, role="admin")

    categories = await client.get("/api/v1/expenses/categories", headers=admin)
    assert categories.status_code == 200
    electricity = next(c for c in categories.json() if c["name"] == "Electricity")

    # Admin creates + submits; cannot approve.
    expense = await client.post(
        "/api/v1/expenses",
        json={
            "category_id": electricity["id"],
            "expense_date": str(TODAY),
            "amount": "4500.00",
            "description": "July electricity bill",
            "submit": True,
        },
        headers=admin,
    )
    assert expense.status_code == 201, expense.text
    expense_id = expense.json()["id"]
    assert expense.json()["status"] == "submitted"

    denied = await client.post(f"/api/v1/expenses/{expense_id}/approve", headers=admin)
    assert denied.status_code == 403

    # Owner approves then marks paid; invalid transitions blocked.
    premature = await client.post(f"/api/v1/expenses/{expense_id}/mark-paid", headers=owner)
    assert premature.status_code == 422

    approved = await client.post(f"/api/v1/expenses/{expense_id}/approve", headers=owner)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    paid = await client.post(f"/api/v1/expenses/{expense_id}/mark-paid", headers=owner)
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"
    assert paid.json()["payment_status"] == "paid"


async def test_recurring_expense_generation(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner = await _headers(client, hotel_a)
    recurring = await client.post(
        "/api/v1/expenses/recurring",
        json={
            "name": "Internet subscription",
            "amount": "1999.00",
            "frequency": "monthly",
            "start_date": str(TODAY - timedelta(days=40)),
        },
        headers=owner,
    )
    assert recurring.status_code == 201, recurring.text

    run = await client.post("/api/v1/expenses/recurring/run", headers=owner)
    assert run.status_code == 200
    generated = run.json()["items"]
    # start 40 days ago, monthly → at least 2 due drafts.
    assert len(generated) >= 2
    assert all(e["status"] == "draft" for e in generated)
    assert all(Decimal(e["amount"]) == Decimal("1999.00") for e in generated)

    # Idempotent: immediate second run creates nothing new.
    rerun = await client.post("/api/v1/expenses/recurring/run", headers=owner)
    assert rerun.json()["total"] == 0
