"""
API contract tests — Phase 0 baseline.

These tests verify that frontend/backend parameter contracts cannot silently
diverge.  Specifically:

1. /current-guests  limit cap: le=200 (frontend fetches limit=200 — must return
   200, not 422).  Regression guard for the commit-7400467/3305ac4 bug.
2. /current-guests  response shape: items[] + total fields always present.
3. Payment method enum: the five values the backend accepts match what the
   frontend sends.  Credit-card / debit-card / net_banking are NOT yet
   accepted (Phase 1 work); this test documents the current contract boundary
   so any silent breakage is caught immediately.
4. /payments/billing-history payment_mode filter: accepted values match the
   backend pattern; unknown/empty/wrong-case modes return 422; no payment_mode
   at all (None default) returns 200.

Empty query-string semantics (payment_mode=):
   Sending ``?payment_mode=`` passes an empty string to FastAPI.  With
   ``pattern="^(cash|upi|card|bank_transfer|other)$"`` the empty string fails
   the regex → 422.  Omitting the parameter entirely produces None → no filter
   applied → 200.  Both behaviours are covered by explicit tests below.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _owner_headers(client: AsyncClient, hotel: HotelFixture) -> dict[str, str]:
    email, password = hotel.credentials("owner")
    return auth_headers(await login(client, email, password))


# ---------------------------------------------------------------------------
# 1 & 2 — /current-guests limit contract
# ---------------------------------------------------------------------------


async def test_current_guests_limit_200_accepted(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Frontend always fetches ?limit=200 (full in-house list, client-side
    pagination).  The route must accept it without a 422.  This is the
    regression guard for the 09/2026 'Something went wrong' bug on the
    Current Guests page."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get(
        "/api/v1/current-guests?limit=200",
        headers=headers,
    )
    assert resp.status_code == 200, (
        f"Expected 200 for limit=200, got {resp.status_code}: {resp.text}"
    )


async def test_current_guests_limit_201_rejected(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """limit=201 must be rejected with 422 (le=200 cap enforced)."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get(
        "/api/v1/current-guests?limit=201",
        headers=headers,
    )
    assert resp.status_code == 422, (
        f"Expected 422 for limit=201, got {resp.status_code}"
    )


async def test_current_guests_response_contract(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Response must always contain 'items' (list) and 'total' (int) regardless
    of how many in-house guests exist.  Any schema change must be deliberate."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get(
        "/api/v1/current-guests?limit=10",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "items" in body, "Response missing 'items' field"
    assert "total" in body, "Response missing 'total' field"
    assert isinstance(body["items"], list), "'items' must be a list"
    assert isinstance(body["total"], int), "'total' must be an int"
    assert body["total"] >= 0


# ---------------------------------------------------------------------------
# 3 — Payment method enum contract
# ---------------------------------------------------------------------------

ACCEPTED_PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "other"]

# These values are requested by the client (screenshot #14, item 14) but are
# NOT yet accepted by the backend — they are Phase 1 work.  This test
# documents the current boundary so any accidental silent acceptance is caught.
UNACCEPTED_PAYMENT_METHODS_PHASE1 = ["credit_card", "debit_card", "net_banking"]


async def _seed_booking(client: AsyncClient, headers: dict[str, str]) -> str:
    """Create a minimal checked-in booking and return its booking_id.

    Each call generates a fresh UUID-derived suffix so this helper is safe
    when called multiple times within the same hotel (e.g. future session-scoped
    hotel_a fixture) or across parametrized tests that share a fixture instance.
    Fixed codes / phone numbers would collide on the per-hotel unique constraints:
      - room_types(hotel_id, code)
      - guests(hotel_id, normalized_phone)
    """
    uid = uuid4()
    suffix = uid.hex[:8]  # 8 hex chars → unique per call
    # Phone: 10 decimal digits.  97-prefix + last 8 decimal digits of UUID int.
    phone = str(9700000000 + (uid.int % 100_000_000))
    today = date.today()
    rt = await client.post(
        "/api/v1/rooms/types",
        json={
            "code": f"CTRT-{suffix}",
            "name": f"Contract Test Room Type {suffix}",
            "base_price": "500.00",
        },
        headers=headers,
    )
    assert rt.status_code == 201, rt.text
    room = await client.post(
        "/api/v1/rooms",
        json={
            "room_number": f"CT-{suffix[:6]}",
            "room_type_id": rt.json()["id"],
        },
        headers=headers,
    )
    assert room.status_code == 201, room.text
    guest = await client.post(
        "/api/v1/guests",
        json={"full_name": f"Contract Test Guest {suffix}", "phone": phone},
        headers=headers,
    )
    assert guest.status_code == 201, guest.text
    booking = await client.post(
        "/api/v1/bookings",
        json={
            "primary_guest_id": guest.json()["id"],
            "room_ids": [room.json()["id"]],
            "check_in_date": str(today),
            "check_out_date": str(today + timedelta(days=1)),
        },
        headers=headers,
    )
    assert booking.status_code == 201, booking.text
    checkin = await client.post(
        "/api/v1/checkins",
        json={"booking_id": booking.json()["id"]},
        headers=headers,
    )
    assert checkin.status_code == 201, checkin.text
    return booking.json()["id"]

@pytest.mark.parametrize("method", ACCEPTED_PAYMENT_METHODS)
async def test_payment_method_accepted(
    client: AsyncClient, hotel_a: HotelFixture, method: str
) -> None:
    """Each currently-accepted payment method value must return 201."""
    headers = await _owner_headers(client, hotel_a)
    booking_id = await _seed_booking(client, headers)
    resp = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking_id, "amount": "100.00", "method": method},
        headers=headers,
    )
    assert resp.status_code == 201, (
        f"Expected 201 for method='{method}', got {resp.status_code}: {resp.text}"
    )


@pytest.mark.parametrize("method", UNACCEPTED_PAYMENT_METHODS_PHASE1)
async def test_payment_method_not_yet_accepted(
    client: AsyncClient, hotel_a: HotelFixture, method: str
) -> None:
    """Values from the Phase-1 expanded enum must currently be REJECTED (422)
    so we know when Phase 1 actually wires them in.  If this test fails after
    Phase 1 is implemented, remove or update it.

    NOTE: We use a real seeded booking so this test does not depend on
    whether schema validation happens before or after the booking DB lookup.
    Either way the invalid ``method`` must produce 422.
    """
    headers = await _owner_headers(client, hotel_a)
    booking_id = await _seed_booking(client, headers)
    resp = await client.post(
        "/api/v1/payments",
        json={"booking_id": booking_id, "amount": "100.00", "method": method},
        headers=headers,
    )
    assert resp.status_code == 422, (
        f"Phase-1 method '{method}' should not be accepted yet "
        f"(got {resp.status_code}).  Update this test when Phase 1 lands."
    )


# ---------------------------------------------------------------------------
# 4 — billing-history payment_mode filter contract
# ---------------------------------------------------------------------------

BILLING_HISTORY_ACCEPTED_MODES = ["cash", "upi", "card", "bank_transfer", "other"]

# Invalid modes that the backend pattern MUST reject with 422.
# Includes:
#   - Phase-1 enum values not yet wired in
#   - wrong-case "CASH" (pattern is case-sensitive)
#   - empty string "": sending ?payment_mode= passes "" to FastAPI; the regex
#     pattern ^(cash|upi|card|bank_transfer|other)$ does not match "" → 422.
#     This is distinct from omitting the parameter altogether (None → no filter
#     → 200), which is tested in test_billing_history_no_mode_omitted.
BILLING_HISTORY_REJECTED_MODES = ["credit_card", "debit_card", "net_banking", "CASH", ""]


@pytest.mark.parametrize("mode", BILLING_HISTORY_ACCEPTED_MODES)
async def test_billing_history_accepted_modes(
    client: AsyncClient, hotel_a: HotelFixture, mode: str
) -> None:
    """Each accepted payment_mode must not produce a 422."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get(
        f"/api/v1/payments/billing-history?payment_mode={mode}",
        headers=headers,
    )
    assert resp.status_code == 200, (
        f"Expected 200 for payment_mode='{mode}', got {resp.status_code}: {resp.text}"
    )


@pytest.mark.parametrize("mode", BILLING_HISTORY_REJECTED_MODES)
async def test_billing_history_rejected_modes(
    client: AsyncClient, hotel_a: HotelFixture, mode: str
) -> None:
    """Enum values outside the backend pattern must be rejected with 422.
    See BILLING_HISTORY_REJECTED_MODES for why each value is expected to fail."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get(
        f"/api/v1/payments/billing-history?payment_mode={mode}",
        headers=headers,
    )
    assert resp.status_code == 422, (
        f"Expected 422 for unknown payment_mode='{mode}', got {resp.status_code}"
    )


async def test_billing_history_no_mode_omitted(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Omitting payment_mode entirely (FastAPI default None) must return 200.
    This is the 'no filter' path — distinct from sending an empty string
    (?payment_mode=) which is rejected with 422."""
    headers = await _owner_headers(client, hotel_a)
    resp = await client.get("/api/v1/payments/billing-history", headers=headers)
    assert resp.status_code == 200, (
        f"Expected 200 with no payment_mode param, got {resp.status_code}: {resp.text}"
    )
