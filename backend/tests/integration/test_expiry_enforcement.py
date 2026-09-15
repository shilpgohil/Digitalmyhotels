"""Wind-down enforcement for expired subscriptions (plan Part 2 / scenario S1).

Past expiry + grace, a hotel may still close out in-house guests (checkout,
payments, invoices, charges) and renew its plan, but every OTHER mutation is
blocked with code=subscription_expired. Reads keep working.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import Subscription, SubscriptionPlan
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _expire_hotel(db: AsyncSession, hotel_id) -> None:
    """Give the hotel a subscription that lapsed beyond its grace period."""
    plan = SubscriptionPlan(
        code=f"exp-test-{str(hotel_id)[:8]}",
        name="Expiry Test",
        price=100,
        duration_days=30,
        trial_days=0,
        is_active=True,
    )
    db.add(plan)
    await db.flush()
    db.add(
        Subscription(
            hotel_id=hotel_id,
            plan_id=plan.id,
            status="expired",
            start_date=date.today() - timedelta(days=60),
            expiry_date=date.today() - timedelta(days=20),
            grace_days=7,
            payment_status="paid",
        )
    )
    await db.commit()


async def _owner_headers(client: AsyncClient, hotel: HotelFixture) -> dict[str, str]:
    email, password = hotel.credentials("owner")
    token = await login(client, email, password)
    return {**auth_headers(token), "X-Hotel-Id": str(hotel.hotel.id)}


async def test_expired_hotel_blocks_new_business_allows_winddown(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
):
    headers = await _owner_headers(client, hotel_a)

    # Baseline sanity: mutations work before expiry.
    ok = await client.post(
        "/api/v1/rooms/types",
        json={"code": "exp-rt", "name": "Expiry RT", "base_price": "1000"},
        headers=headers,
    )
    assert ok.status_code in (200, 201), ok.text

    await _expire_hotel(db_session, hotel_a.hotel.id)

    # BLOCKED: new business (room type creation as representative mutation).
    blocked = await client.post(
        "/api/v1/rooms/types",
        json={"code": "exp-rt2", "name": "Expiry RT2", "base_price": "1000"},
        headers=headers,
    )
    assert blocked.status_code == 403, blocked.text
    assert "subscription_expired" in blocked.text

    # ALLOWED: reads keep working (wind-down needs visibility).
    reads = await client.get("/api/v1/bookings?limit=5&offset=0", headers=headers)
    assert reads.status_code == 200, reads.text

    # ALLOWED: renewal request (the way out).
    renew = await client.post(
        "/api/v1/subscriptions/me/renewal-request", headers=headers, json={}
    )
    assert renew.status_code in (200, 201), renew.text
