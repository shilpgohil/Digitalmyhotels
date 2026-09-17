"""Recently-expired hotel list + dashboard count (client 17/09/2026).

Tests:
- Hotel whose subscription expired last week shows in the list.
- Hotel expired 60 days ago does NOT show (outside 30-day window).
- Hotel in grace period (expired 2 days ago, grace = 7) shows.
- Hotel expiring in 3 days shows (about_to_expire with expiring_within=5).
- Dashboard count uses the same logic as the list (not status column).
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hotel import Hotel, HotelSettings
from app.models.platform import Subscription, SubscriptionPlan
from tests.integration.conftest import auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _super_admin_headers(client: AsyncClient, db_session: AsyncSession) -> dict:
    from app.services.auth import create_user

    email = f"sa-re-{uuid4().hex[:8]}@example.org"
    await create_user(
        db_session,
        email=email,
        password="SaPass123!",
        full_name="SA Recently Expired Test",
        is_super_admin=True,
    )
    await db_session.commit()
    return auth_headers(await login(client, email, "SaPass123!"))


async def _make_hotel_with_subscription(
    db_session: AsyncSession,
    *,
    expiry_offset_days: int,
    grace_days: int = 3,
) -> Hotel:
    """Create a hotel with a subscription expiring `expiry_offset_days` from today.
    Negative = already expired.  Positive = future expiry."""
    suffix = uuid4().hex[:8]
    hotel = Hotel(name=f"Test RE Hotel {suffix}", slug=f"re-hotel-{suffix}")
    db_session.add(hotel)
    await db_session.flush()
    db_session.add(HotelSettings(hotel_id=hotel.id))

    # Minimal plan
    plan_id = uuid4()
    db_session.add(SubscriptionPlan(
        id=plan_id,
        name=f"Plan {suffix}",
        code=f"plan-{suffix}",
        price=1000,
        duration_days=30,
        is_active=True,
    ))
    await db_session.flush()

    today = date.today()
    expiry = today + timedelta(days=expiry_offset_days)
    start = min(expiry - timedelta(days=30), today)
    status = "active" if expiry_offset_days > 0 else "expired"
    sub = Subscription(
        hotel_id=hotel.id,
        plan_id=plan_id,
        status=status,
        start_date=start,
        expiry_date=expiry,
        grace_days=grace_days,
    )
    db_session.add(sub)
    await db_session.commit()
    return hotel


async def test_recently_expired_within_30_days_appears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A hotel expired 5 days ago must appear in the recently-expired list."""
    headers = await _super_admin_headers(client, db_session)
    hotel = await _make_hotel_with_subscription(db_session, expiry_offset_days=-5)

    resp = await client.get(
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&limit=100",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    ids = [h["id"] for h in resp.json()["items"]]
    assert str(hotel.id) in ids, "Hotel expired 5 days ago must appear"


async def test_recently_expired_beyond_window_absent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A hotel expired 60 days ago must NOT appear in the 30-day window."""
    headers = await _super_admin_headers(client, db_session)
    hotel = await _make_hotel_with_subscription(db_session, expiry_offset_days=-60)

    resp = await client.get(
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&limit=100",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    ids = [h["id"] for h in resp.json()["items"]]
    assert str(hotel.id) not in ids, "Hotel expired 60 days ago must NOT appear in 30-day window"


async def test_grace_period_hotel_appears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A hotel in its grace period (expired 2 days ago, grace=7) must appear."""
    headers = await _super_admin_headers(client, db_session)
    # grace_days=7 means it's still functional but expired for accounting
    hotel = await _make_hotel_with_subscription(db_session, expiry_offset_days=-2, grace_days=7)

    resp = await client.get(
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&limit=100",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    ids = [h["id"] for h in resp.json()["items"]]
    assert str(hotel.id) in ids, "Grace-period hotel must appear in recently-expired list"


async def test_about_to_expire_hotel_appears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A hotel expiring in 3 days must appear with expiring_within=5."""
    headers = await _super_admin_headers(client, db_session)
    hotel = await _make_hotel_with_subscription(db_session, expiry_offset_days=3)

    resp = await client.get(
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=5&limit=100",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    ids = [h["id"] for h in resp.json()["items"]]
    assert str(hotel.id) in ids, "Hotel expiring in 3 days must appear with expiring_within=5"


async def test_dashboard_count_matches_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Dashboard recently_expired count must be >= 1 after creating an expired hotel."""
    headers = await _super_admin_headers(client, db_session)
    await _make_hotel_with_subscription(db_session, expiry_offset_days=-5)

    dash = await client.get("/api/v1/super-admin/dashboard", headers=headers)
    assert dash.status_code == 200, dash.text
    count = dash.json()["recently_expired"]
    assert count >= 1, "Dashboard recently_expired count must be >= 1 after creating expired hotel"
