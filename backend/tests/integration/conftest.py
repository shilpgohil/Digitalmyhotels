"""Shared fixtures for integration tests: seeded hotel, users per role, login helper."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import RoleCode
from app.core.security import hash_password
from app.models.hotel import Hotel, HotelSettings
from app.models.user import HotelMembership, Role, User


async def _ensure_roles(db: AsyncSession) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for code in RoleCode:
        result = await db.execute(select(Role).where(Role.code == code.value))
        role = result.scalar_one_or_none()
        if role is None:
            role = Role(code=code.value, name=code.value.title(), is_system=True)
            db.add(role)
            await db.flush()
        roles[code.value] = role
    return roles


class HotelFixture:
    def __init__(self, hotel: Hotel, users: dict[str, tuple[User, str]]) -> None:
        self.hotel = hotel
        self.users = users  # role_code -> (User, password)

    def credentials(self, role: str) -> tuple[str, str]:
        user, password = self.users[role]
        return user.email, password


async def make_hotel_with_team(db: AsyncSession, *, name: str | None = None) -> HotelFixture:
    suffix = uuid4().hex[:8]
    roles = await _ensure_roles(db)
    hotel = Hotel(name=name or f"Hotel {suffix}", slug=f"hotel-{suffix}")
    db.add(hotel)
    await db.flush()
    db.add(HotelSettings(hotel_id=hotel.id))

    users: dict[str, tuple[User, str]] = {}
    password = "TeamPass123!"
    for role_code in ("owner", "manager", "admin", "housekeeping"):
        user = User(
            email=f"{role_code}-{suffix}@example.org",
            full_name=f"{role_code.title()} {suffix}",
            password_hash=hash_password(password),
        )
        db.add(user)
        await db.flush()
        db.add(
            HotelMembership(
                user_id=user.id,
                hotel_id=hotel.id,
                role_id=roles[role_code].id,
                status="active",
            )
        )
        users[role_code] = (user, password)
    await db.commit()
    return HotelFixture(hotel, users)


async def login(client: AsyncClient, email: str, password: str) -> str:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def hotel_a(db_session: AsyncSession) -> HotelFixture:
    return await make_hotel_with_team(db_session)


@pytest.fixture
async def hotel_b(db_session: AsyncSession) -> HotelFixture:
    return await make_hotel_with_team(db_session)
