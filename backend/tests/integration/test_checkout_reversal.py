"""Checkout reversal hardening (plan §3.3, 15/09/2026).

Reversal must clean its money artifacts: the auto-generated invoice is
cancelled, and a payment recorded after checkout blocks the reversal.
A second checkout generates a fresh invoice.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payment import Payment
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today()


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


async def _checked_out_booking(client: AsyncClient, headers) -> tuple[str, str]:
    """Book+check-in+check-out; returns (booking_id, invoice_id)."""
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "REV1", "name": "Reversal Type", "base_price": "1000.00"},
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "RV-1", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Reversal Guest", "phone": "9811122233"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    assert booking.status_code == 201, booking.text
    booking_id = booking.json()["id"]
    checkin = await client.post(
        "/api/v1/checkins", json={"booking_id": booking_id}, headers=headers
    )
    assert checkin.status_code == 201, checkin.text
    done = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking_id, "collect_payment": True, "payment_method": "cash"},
        headers=headers,
    )
    assert done.status_code == 201, done.text
    invoice_id = done.json()["invoice_id"]
    assert invoice_id, "checkout must auto-generate the invoice (plan §3.4)"
    return booking_id, invoice_id


async def test_reversal_cancels_invoice_and_recheckout_generates_new(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    booking_id, invoice_id = await _checked_out_booking(client, headers)

    reverse = await client.post(
        f"/api/v1/checkouts/{booking_id}/reverse",
        json={"reason": "guest returned, wrong checkout"},
        headers=headers,
    )
    assert reverse.status_code == 200, reverse.text

    # Booking reopened; invoice auto-cancelled (plan §3.3).
    detail = (await client.get(f"/api/v1/bookings/{booking_id}", headers=headers)).json()
    assert detail["status"] == "checked_in"
    inv = (await client.get(f"/api/v1/invoices/{invoice_id}", headers=headers)).json()
    assert inv["status"] == "cancelled"
    assert "Checkout reversed" in (inv["cancel_reason"] or "")

    # Second checkout issues a FRESH invoice (new number, not the cancelled one).
    done2 = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking_id, "collect_payment": True, "payment_method": "cash"},
        headers=headers,
    )
    assert done2.status_code == 201, done2.text
    new_invoice_id = done2.json()["invoice_id"]
    assert new_invoice_id and new_invoice_id != invoice_id


async def test_midstay_invoice_superseded_at_checkout(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Plan §3.4 reverify: an invoice generated MID-STAY cannot include
    checkout charges — checkout must cancel it and issue the final one."""
    headers = await _headers(client, hotel_a)
    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "REV3", "name": "Reversal Type 3", "base_price": "1000.00"},
        headers=headers,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "RV-3", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Midstay Guest", "phone": "9811122255"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    booking_id = booking.json()["id"]
    await client.post("/api/v1/checkins", json={"booking_id": booking_id}, headers=headers)

    # Mid-stay invoice (e.g. from the check-in success screen).
    midstay = await client.post(
        "/api/v1/invoices", json={"booking_id": booking_id}, headers=headers
    )
    assert midstay.status_code == 201, midstay.text
    midstay_id = midstay.json()["id"]

    # Checkout adds a charge — the final bill differs from the mid-stay invoice.
    done = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking_id,
            "collect_payment": True,
            "payment_method": "cash",
            "charges": [
                {"description": "Late snack", "amount": "300", "category": "restaurant"}
            ],
        },
        headers=headers,
    )
    assert done.status_code == 201, done.text
    final_id = done.json()["invoice_id"]
    assert final_id and final_id != midstay_id

    old = (await client.get(f"/api/v1/invoices/{midstay_id}", headers=headers)).json()
    assert old["status"] == "cancelled"
    assert "Superseded" in (old["cancel_reason"] or "")
    new = (await client.get(f"/api/v1/invoices/{final_id}", headers=headers)).json()
    assert new["status"] != "cancelled"
    # Final invoice includes the checkout charge (300) on top of the room.
    assert float(new["total_amount"]) > float(old["total_amount"])


async def test_post_checkout_payment_blocks_reversal(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)

    rt = await client.post(
        "/api/v1/rooms/types",
        json={"code": "REV2", "name": "Reversal Type 2", "base_price": "1000.00"},
        headers=headers,
    )
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": "RV-2", "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Reversal Guest 2", "phone": "9811122244"},
        headers=headers,
    )
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(TODAY),
            "check_out_date": str(TODAY + timedelta(days=1)),
        },
        headers=headers,
    )
    booking_id = booking.json()["id"]
    await client.post("/api/v1/checkins", json={"booking_id": booking_id}, headers=headers)
    done = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking_id, "allow_due": True, "due_reason": "pays later"},
        headers=headers,
    )
    assert done.status_code == 201, done.text

    # Guest pays the due LATER (simulated by shifting paid_at past the margin).
    pay = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking_id, "amount": "500.00", "method": "cash"},
        headers=headers,
    )
    assert pay.status_code == 201, pay.text
    await db_session.execute(
        update(Payment)
        .where(Payment.id == pay.json()["id"])
        .values(paid_at=Payment.paid_at + timedelta(minutes=10))
    )
    await db_session.commit()

    reverse = await client.post(
        f"/api/v1/checkouts/{booking_id}/reverse",
        json={"reason": "attempting reversal"},
        headers=headers,
    )
    assert reverse.status_code == 409, reverse.text
    assert "post_checkout_payment_exists" in reverse.text
