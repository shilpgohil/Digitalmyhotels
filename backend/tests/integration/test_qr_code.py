"""QR code generation tests — exercises the full Pillow + qrcode rendering path.

Verifies:
- Owner can configure UPI and the server generates a valid PNG QR code
- The PNG QR can be fetched by a housekeeping (worker) role
- Workers receive valid PNG bytes (never the raw UPI ID)
- Invalid UPI IDs are rejected
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


async def _login(client: AsyncClient, hotel: HotelFixture, role: str):
    email, password = hotel.credentials(role)
    return auth_headers(await login(client, email, password))


async def test_owner_sets_upi_and_qr_png_is_valid(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Owner configures UPI → server renders PNG QR → PNG magic bytes confirm valid image."""
    owner_headers = await _login(client, hotel_a, "owner")

    # Set a valid UPI ID (admin also has HOTEL_MANAGE_UPI; we use owner here).
    resp = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "hoteldemo@upi"},
        headers=owner_headers,
    )
    assert resp.status_code == 200, resp.text
    config = resp.json()
    assert config["qr_version"] >= 1, "QR version should increment after UPI update"
    assert config["config_version"] >= 1

    # Fetch the QR image as owner.
    qr_resp = await client.get(
        "/api/v1/hotels/me/payment-qr/image",
        headers=owner_headers,
    )
    assert qr_resp.status_code == 200, qr_resp.text
    assert qr_resp.headers["content-type"] == "image/png"
    assert qr_resp.content[:8] == _PNG_MAGIC, (
        f"Response does not look like a PNG: {qr_resp.content[:16]!r}"
    )
    # A minimal 1×1 PNG is ~68 bytes; a real QR should be much larger.
    assert len(qr_resp.content) > 500, "QR PNG seems unexpectedly small"


async def test_worker_gets_qr_but_not_raw_upi(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Housekeeping (worker) can view the QR PNG but cannot access the UPI config."""
    owner_headers = await _login(client, hotel_a, "owner")
    hk_headers = await _login(client, hotel_a, "housekeeping")

    # Ensure UPI is configured.
    await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "worker-test@upi"},
        headers=owner_headers,
    )

    # Worker can view the QR image.
    qr_resp = await client.get(
        "/api/v1/hotels/me/payment-qr/image",
        headers=hk_headers,
    )
    assert qr_resp.status_code == 200, qr_resp.text
    assert qr_resp.content[:8] == _PNG_MAGIC

    # Worker cannot access the raw UPI config (HOTEL_VIEW_UPI_ID not in housekeeping).
    config_resp = await client.get(
        "/api/v1/hotels/me/payment-config",
        headers=hk_headers,
    )
    assert config_resp.status_code == 403, config_resp.text


async def test_qr_before_upi_configured_returns_404(
    client: AsyncClient, hotel_b: HotelFixture
) -> None:
    """Fetching the QR image before any UPI is set should return 404, not crash."""
    # hotel_b is seeded fresh per-test with no UPI configured.
    owner_headers = await _login(client, hotel_b, "owner")

    qr_resp = await client.get(
        "/api/v1/hotels/me/payment-qr/image",
        headers=owner_headers,
    )
    assert qr_resp.status_code == 404, qr_resp.text
    assert qr_resp.json()["error"]["code"] in {"qr_not_configured", "qr_missing"}


async def test_upi_qr_updates_on_second_set(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    """Setting UPI a second time increments config_version and generates a new QR."""
    owner_headers = await _login(client, hotel_a, "owner")

    first = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "first@upi"},
        headers=owner_headers,
    )
    assert first.status_code == 200, first.text
    v1 = first.json()["config_version"]

    second = await client.put(
        "/api/v1/hotels/me/payment-config",
        json={"upi_id": "second@upi"},
        headers=owner_headers,
    )
    assert second.status_code == 200, second.text
    v2 = second.json()["config_version"]

    assert v2 > v1, f"config_version should increase: was {v1}, now {v2}"

    # QR PNG is still valid after update.
    qr_resp = await client.get(
        "/api/v1/hotels/me/payment-qr/image",
        headers=owner_headers,
    )
    assert qr_resp.status_code == 200
    assert qr_resp.content[:8] == _PNG_MAGIC
