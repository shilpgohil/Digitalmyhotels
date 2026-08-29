"""Password reset request/confirm, change-password, attachment upload."""

from __future__ import annotations

import io
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_password_reset_flow(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    email, old_password = hotel_a.credentials("admin")

    resp = await client.post(
        "/api/v1/auth/password-reset/request", json={"email": email}
    )
    assert resp.status_code == 200

    # Unknown email gives the identical response (no user enumeration).
    unknown = await client.post(
        "/api/v1/auth/password-reset/request", json={"email": "nobody@example.org"}
    )
    assert unknown.status_code == 200
    assert unknown.json() == resp.json()

    # The raw token only exists in the email; for the test, forge one via the service.
    from app.core.security import generate_refresh_token, hash_token

    raw = generate_refresh_token()
    result = await db_session.execute(select(User).where(User.email == email))
    user = result.scalar_one()
    user.password_reset_token_hash = hash_token(raw)
    from datetime import UTC, datetime, timedelta

    user.password_reset_expires_at = datetime.now(UTC) + timedelta(hours=1)
    await db_session.commit()

    confirm = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": raw, "new_password": "BrandNew123!"},
    )
    assert confirm.status_code == 200, confirm.text

    # Token is single-use.
    reuse = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": raw, "new_password": "Another123!"},
    )
    assert reuse.status_code == 401

    # Old password no longer works; the new one does.
    bad = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": old_password}
    )
    assert bad.status_code == 401
    good = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "BrandNew123!"}
    )
    assert good.status_code == 200


async def test_change_password(client: AsyncClient, hotel_a: HotelFixture) -> None:
    email, password = hotel_a.credentials("manager")
    headers = auth_headers(await login(client, email, password))

    wrong = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "not-it", "new_password": "Fresh12345"},
        headers=headers,
    )
    assert wrong.status_code == 401

    ok = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": password, "new_password": "Fresh12345"},
        headers=headers,
    )
    assert ok.status_code == 200
    relogin = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Fresh12345"}
    )
    assert relogin.status_code == 200


async def test_expense_attachment_upload(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    email, password = hotel_a.credentials("owner")
    headers = auth_headers(await login(client, email, password))

    expense = await client.post(
        "/api/v1/expenses",
        json={"amount": "500.00", "expense_date": str(date.today())},
        headers=headers,
    )
    assert expense.status_code == 201, expense.text
    expense_id = expense.json()["id"]

    # 1x1 PNG
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
        b"\xc0\x00\x00\x00\x03\x00\x01\x9a\x9e\xcc\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    upload = await client.put(
        f"/api/v1/expenses/{expense_id}/attachment",
        files={"file": ("bill.png", io.BytesIO(png), "image/png")},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text

    download = await client.get(
        f"/api/v1/expenses/{expense_id}/attachment", headers=headers
    )
    assert download.status_code == 200
    assert download.headers["content-type"] == "image/png"

    bad_type = await client.put(
        f"/api/v1/expenses/{expense_id}/attachment",
        files={"file": ("evil.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
        headers=headers,
    )
    assert bad_type.status_code == 422
