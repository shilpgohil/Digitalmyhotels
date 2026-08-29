from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.services.auth import create_user

# DB fixtures are session-loop scoped; tests must share that loop.
pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _make_user(db: AsyncSession, email: str) -> None:
    await create_user(
        db,
        email=email,
        password="Password123!",
        full_name="Test User",
    )
    await db.commit()


async def test_health(client: AsyncClient) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_login_and_me(client: AsyncClient, db_session: AsyncSession) -> None:
    await _make_user(db_session, "login-test@example.com")

    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "login-test@example.com", "password": "Password123!"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["user"]["email"] == "login-test@example.com"

    settings = get_settings()
    assert settings.refresh_cookie_name in resp.cookies

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "login-test@example.com"


async def test_login_wrong_password_is_safe_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _make_user(db_session, "wrongpw@example.com")
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "wrongpw@example.com", "password": "nope"},
    )
    assert resp.status_code == 401
    err = resp.json()["error"]
    assert err["code"] == "invalid_credentials"
    assert "correlation_id" in err


async def test_refresh_rotation_and_reuse_detection(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _make_user(db_session, "rotate@example.com")
    settings = get_settings()

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "rotate@example.com", "password": "Password123!"},
    )
    assert login.status_code == 200
    first_refresh = login.cookies[settings.refresh_cookie_name]

    r1 = await client.post("/api/v1/auth/refresh")
    assert r1.status_code == 200
    second_refresh = r1.cookies.get(settings.refresh_cookie_name)
    assert second_refresh and second_refresh != first_refresh

    # Replaying the first (rotated-out) token must trip reuse detection.
    client.cookies.clear()
    client.cookies.set(settings.refresh_cookie_name, first_refresh, path="/api/v1/auth")
    r2 = await client.post("/api/v1/auth/refresh")
    assert r2.status_code == 401
    assert r2.json()["error"]["code"] == "refresh_reuse"

    # And the rotated family is revoked — the second token no longer works.
    client.cookies.clear()
    client.cookies.set(settings.refresh_cookie_name, second_refresh, path="/api/v1/auth")
    r3 = await client.post("/api/v1/auth/refresh")
    assert r3.status_code == 401


async def test_me_requires_token(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
