"""The UPI raw-ID boundary — the most sensitive business rule in Phase 1."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

UPI_ID = "meridian.court@okhdfc"


async def _login_as(client: AsyncClient, hotel: HotelFixture, role: str) -> dict[str, str]:
    email, password = hotel.credentials(role)
    token = await login(client, email, password)
    return auth_headers(token)


async def test_owner_sets_upi_and_qr_is_generated(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _login_as(client, hotel_a, "owner")
    resp = await client.put(
        "/api/v1/hotels/me/payment-config", json={"upi_id": UPI_ID}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["upi_id"] == UPI_ID
    assert body["qr_version"] >= 1

    qr = await client.get("/api/v1/hotels/me/payment-qr/image", headers=headers)
    assert qr.status_code == 200
    assert qr.headers["content-type"] == "image/png"
    assert qr.content[:8] == b"\x89PNG\r\n\x1a\n"


async def test_invalid_upi_id_rejected(client: AsyncClient, hotel_a: HotelFixture) -> None:
    headers = await _login_as(client, hotel_a, "owner")
    resp = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "not a upi id!!"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_worker_cannot_read_or_write_upi_config(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner_headers = await _login_as(client, hotel_a, "owner")
    await client.put(
        "/api/v1/hotels/me/payment-config", json={"upi_id": UPI_ID}, headers=owner_headers
    )

    hk_headers = await _login_as(client, hotel_a, "housekeeping")

    read = await client.get("/api/v1/hotels/me/payment-config", headers=hk_headers)
    assert read.status_code == 403

    write = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "attacker@upi"},
        headers=hk_headers,
    )
    assert write.status_code == 403


async def test_worker_can_view_qr_and_response_never_leaks_upi_id(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    owner_headers = await _login_as(client, hotel_a, "owner")
    await client.put(
        "/api/v1/hotels/me/payment-config", json={"upi_id": UPI_ID}, headers=owner_headers
    )

    hk_headers = await _login_as(client, hotel_a, "housekeeping")

    meta = await client.get("/api/v1/hotels/me/payment-qr", headers=hk_headers)
    assert meta.status_code == 200
    assert UPI_ID not in meta.text
    assert "upi_id" not in meta.json()

    image = await client.get("/api/v1/hotels/me/payment-qr/image", headers=hk_headers)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"


async def test_admin_can_manage_upi_but_manager_cannot(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Product owner decision: manager cannot configure UPI — only owner and admin."""
    # Admin should succeed.
    admin_headers = await _login_as(client, hotel_a, "admin")
    resp = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "admin.updated@okaxis"},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text

    # Manager must be denied.
    manager_headers = await _login_as(client, hotel_a, "manager")
    denied = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "manager.updated@okaxis"},
        headers=manager_headers,
    )
    assert denied.status_code == 403, denied.text


async def test_upi_change_is_audited_without_raw_value(
    client: AsyncClient, hotel_a: HotelFixture, db_session
) -> None:
    headers = await _login_as(client, hotel_a, "owner")
    await client.put(
        "/api/v1/hotels/me/payment-config", json={"upi_id": UPI_ID}, headers=headers
    )
    from sqlalchemy import select

    from app.models.platform import AuditLog

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.hotel_id == hotel_a.hotel.id,
            AuditLog.action == "upi.config_updated",
        )
    )
    rows = list(result.scalars().all())
    assert rows, "UPI change must be audited"
    for row in rows:
        serialized = str(row.before) + str(row.after) + str(row.metadata_json)
        assert UPI_ID not in serialized, "Audit must not contain the raw UPI ID"
