"""Atomic, server-authoritative checkout: POST quote + single-request commit.

Covers the settlement contract the client reported broken (items 3, 12, 13,
26, 39): the screen must never do its own arithmetic, the commit must be one
transaction, and a failure anywhere must leave nothing behind.
"""

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


async def _stay(
    client: AsyncClient,
    headers,
    *,
    room_number: str = "401",
    hourly_rate: str | None = "300.00",
    check_out_time: str | None = None,
    nights: int = 1,
    phone: str = "9871000001",
) -> dict:
    """Room type + room + guest + booking + check-in. Returns booking JSON."""
    type_body: dict = {
        "code": f"AT{room_number}",
        "name": "Atomic Type",
        "base_price": "2000.00",
    }
    if hourly_rate is not None:
        type_body["hourly_rate"] = hourly_rate
    rt = await client.post("/api/v1/rooms/types", json=type_body, headers=headers)
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={"room_number": room_number, "room_type_id": rt.json()["id"]},
        headers=headers,
    )
    assert room.status_code == 201, room.text
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": "Atomic Guest", "phone": phone},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text

    booking_body: dict = {
        "primary_guest_id": guest.json()["id"],
        "room_ids": [room.json()["id"]],
        "check_in_date": str(TODAY),
        "check_out_date": str(TODAY + timedelta(days=nights)),
    }
    if check_out_time:
        booking_body["check_out_time"] = check_out_time
    booking = await client.post("/api/v1/bookings", json=booking_body, headers=headers)
    assert booking.status_code == 201, booking.text
    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking.json()["id"], "terms_acknowledged": True},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text
    out = booking.json()
    out["room_id"] = room.json()["id"]
    return out


async def _register_gst(client: AsyncClient, headers) -> None:
    resp = await client.patch(
        "/api/v1/hotels/me/gst",
        json={"is_gst_registered": True, "gstin": "27ABCDE1234F1Z5", "state_code": "27"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text


async def _charge_count(client: AsyncClient, headers, booking_id: str) -> int:
    resp = await client.get(f"/api/v1/charges?booking_id={booking_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return len([c for c in resp.json()["items"] if c["voided_at"] is None])


async def _payments(client: AsyncClient, headers, booking_id: str) -> list[dict]:
    resp = await client.get(
        f"/api/v1/payments?booking_id={booking_id}&limit=50", headers=headers
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


EXTRAS = [
    {"category": "restaurant", "description": "Dinner", "amount": "500", "apply_gst": True},
    {"category": "damage", "description": "Broken lamp", "amount": "300", "apply_gst": True},
]


# ── (a) quote is taxed, authoritative and read-only ───────────────────────


async def test_quote_taxes_proposed_charges_and_does_not_mutate(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="401", phone="9871000001")

    quote = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"charges": EXTRAS},
        headers=headers,
    )
    assert quote.status_code == 200, quote.text
    q = quote.json()

    # Room 2000 + 12% GST = 2240. Extras 800 taxable + 96 tax = 896.
    assert Decimal(q["room_subtotal"]) == 2000
    assert Decimal(q["room_gst"]) == 240
    assert Decimal(q["proposed_charges_taxable"]) == 800
    assert Decimal(q["proposed_charges_tax"]) == 96
    assert Decimal(q["proposed_charges_total"]) == 896
    assert Decimal(q["gst_amount"]) == 336
    assert Decimal(q["overtime_amount"]) == 0
    assert Decimal(q["final_total"]) == 3136
    assert Decimal(q["due"]) == 3136

    # Read-only: no charge rows, booking untouched.
    assert await _charge_count(client, headers, booking["id"]) == 0
    detail = await client.get(f"/api/v1/bookings/{booking['id']}", headers=headers)
    assert Decimal(detail.json()["total_amount"]) == 2000
    assert detail.json()["status"] == "checked_in"


# ── (b) one atomic request collects exactly the quoted due ────────────────


async def test_atomic_checkout_collects_exact_quoted_due(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="402", phone="9871000002")

    quote = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"charges": EXTRAS},
        headers=headers,
    )
    quoted_due = Decimal(quote.json()["due"])
    quoted_total = Decimal(quote.json()["final_total"])

    done = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "charges": EXTRAS,
            "collect_payment": True,
            "payment_method": "cash",
        },
        headers=headers,
    )
    assert done.status_code == 201, done.text
    out = done.json()
    assert Decimal(out["final_total"]) == quoted_total
    assert Decimal(out["due_amount"]) == 0
    assert Decimal(out["paid_amount"]) == quoted_due

    payments = await _payments(client, headers, booking["id"])
    assert len(payments) == 1
    assert Decimal(payments[0]["amount"]) == quoted_due
    assert await _charge_count(client, headers, booking["id"]) == 2

    # Invoice agrees with the quote and the persisted checkout.
    invoice = await client.post(
        "/api/v1/invoices", json={"booking_id": booking["id"]}, headers=headers
    )
    assert invoice.status_code == 201, invoice.text
    assert Decimal(invoice.json()["total_amount"]) == quoted_total


# ── (c) a retry after success must not duplicate anything ─────────────────


async def test_checkout_retry_does_not_duplicate_charges_or_payment(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="403", phone="9871000003")

    body = {
        "booking_id": booking["id"],
        "charges": EXTRAS,
        "collect_payment": True,
        "payment_method": "upi",
    }
    first = await client.post("/api/v1/checkouts", json=body, headers=headers)
    assert first.status_code == 201, first.text

    retry = await client.post("/api/v1/checkouts", json=body, headers=headers)
    assert retry.status_code == 422
    assert retry.json()["error"]["code"] == "not_checked_in"

    assert await _charge_count(client, headers, booking["id"]) == 2
    assert len(await _payments(client, headers, booking["id"])) == 1


# ── (d) authorized discount ───────────────────────────────────────────────


async def test_discount_lowers_settlement_and_needs_authorization(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="404", phone="9871000004")

    plain = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote", json={}, headers=headers
    )
    assert plain.status_code == 200, plain.text
    base_total = Decimal(plain.json()["final_total"])

    discounted = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"discount_amount": "500", "discount_reason": "Loyalty adjustment"},
        headers=headers,
    )
    assert discounted.status_code == 200, discounted.text
    assert Decimal(discounted.json()["discount"]) == 500
    assert Decimal(discounted.json()["final_total"]) == base_total - 500

    # Admin holds CHECKOUT but not PAYMENTS_CORRECT — cannot move the discount.
    admin = await _headers(client, hotel_a, role="admin")
    denied = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"discount_amount": "500", "discount_reason": "Loyalty adjustment"},
        headers=admin,
    )
    assert denied.status_code == 403

    denied_commit = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "discount_amount": "500",
            "discount_reason": "Loyalty adjustment",
            "allow_due": True,
            "due_reason": "Corporate billing",
        },
        headers=admin,
    )
    assert denied_commit.status_code == 403

    # A discount change without a reason is rejected even for owner.
    no_reason = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "discount_amount": "500",
            "allow_due": True,
            "due_reason": "Corporate billing",
        },
        headers=headers,
    )
    assert no_reason.status_code == 422

    committed = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "discount_amount": "500",
            "discount_reason": "Loyalty adjustment",
            "allow_due": True,
            "due_reason": "Corporate billing",
        },
        headers=headers,
    )
    assert committed.status_code == 201, committed.text
    assert Decimal(committed.json()["final_total"]) == base_total - 500

    invoice = await client.post(
        "/api/v1/invoices", json={"booking_id": booking["id"]}, headers=headers
    )
    assert invoice.status_code == 201, invoice.text
    assert Decimal(invoice.json()["discount_amount"]) == 500
    assert Decimal(invoice.json()["total_amount"]) == base_total - 500


# ── (e) server-side hourly overstay across a date boundary ────────────────


async def test_hourly_overstay_is_server_calculated_across_midnight(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    booking = await _stay(
        client,
        headers,
        room_number="405",
        hourly_rate="300.00",
        check_out_time="23:00",
        phone="9871000005",
    )
    # Expected 23:00 on day 1; actual 02:30 on day 2 → 3.5 h late, 1 h grace,
    # ceil(2.5) = 3 billable hours × ₹300.
    actual = f"{TODAY + timedelta(days=2)}T02:30:00+05:30"

    quote = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"checked_out_at": actual},
        headers=headers,
    )
    assert quote.status_code == 200, quote.text
    q = quote.json()
    assert q["overtime_hours"] == 3
    assert Decimal(q["overtime_rate_per_hour"]) == 300
    assert Decimal(q["overtime_amount"]) == 900
    assert Decimal(q["final_total"]) == Decimal(q["room_subtotal"]) + 900

    done = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "checked_out_at": actual,
            "collect_payment": True,
            "payment_method": "cash",
        },
        headers=headers,
    )
    assert done.status_code == 201, done.text
    assert Decimal(done.json()["late_fee"]) == 900
    assert done.json()["is_late"] is True
    assert Decimal(done.json()["final_total"]) == Decimal(q["final_total"])


async def test_overstay_is_zero_without_hourly_rate(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    booking = await _stay(
        client,
        headers,
        room_number="406",
        hourly_rate=None,
        check_out_time="10:00",
        phone="9871000006",
    )
    quote = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"checked_out_at": f"{TODAY + timedelta(days=2)}T20:00:00+05:30"},
        headers=headers,
    )
    assert quote.status_code == 200, quote.text
    assert Decimal(quote.json()["overtime_amount"]) == 0


# ── (f) authorized dues keep the exact quoted amount ──────────────────────


async def test_allow_due_preserves_quoted_due_and_reason(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="407", phone="9871000007")

    quote = await client.post(
        f"/api/v1/checkouts/{booking['id']}/quote",
        json={"charges": EXTRAS},
        headers=headers,
    )
    quoted_due = Decimal(quote.json()["due"])

    blocked = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking["id"], "charges": EXTRAS},
        headers=headers,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "balance_due"

    done = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "charges": EXTRAS,
            "allow_due": True,
            "due_reason": "Corporate billing next week",
        },
        headers=headers,
    )
    assert done.status_code == 201, done.text
    assert Decimal(done.json()["due_amount"]) == quoted_due
    assert done.json()["payment_due_authorized"] is True

    detail = await client.get(f"/api/v1/bookings/{booking['id']}", headers=headers)
    assert Decimal(detail.json()["due_amount"]) == quoted_due


# ── (g) any failure rolls the whole request back ──────────────────────────


async def test_failed_checkout_rolls_back_proposed_charges(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Unauthorized dues abort AFTER charges are staged — nothing may persist."""
    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="408", phone="9871000008")

    failed = await client.post(
        "/api/v1/checkouts",
        json={"booking_id": booking["id"], "charges": EXTRAS},
        headers=headers,
    )
    assert failed.status_code == 409

    assert await _charge_count(client, headers, booking["id"]) == 0
    detail = await client.get(f"/api/v1/bookings/{booking['id']}", headers=headers)
    assert Decimal(detail.json()["total_amount"]) == 2000
    assert detail.json()["status"] == "checked_in"


async def test_failed_checkout_rolls_back_collected_payment(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    """Room in an un-checkout-able state aborts after the payment is taken."""
    from uuid import UUID

    from sqlalchemy import select

    from app.models.room import Room

    headers = await _headers(client, hotel_a)
    await _register_gst(client, headers)
    booking = await _stay(client, headers, room_number="409", phone="9871000009")

    room = (
        await db_session.execute(select(Room).where(Room.id == UUID(booking["room_id"])))
    ).scalar_one()
    room.status = "maintenance"
    await db_session.commit()

    failed = await client.post(
        "/api/v1/checkouts",
        json={
            "booking_id": booking["id"],
            "charges": EXTRAS,
            "collect_payment": True,
            "payment_method": "cash",
        },
        headers=headers,
    )
    assert failed.status_code == 409, failed.text

    assert await _charge_count(client, headers, booking["id"]) == 0
    assert await _payments(client, headers, booking["id"]) == []
    detail = await client.get(f"/api/v1/bookings/{booking['id']}", headers=headers)
    assert Decimal(detail.json()["advance_amount"]) == 0
    assert detail.json()["status"] == "checked_in"
