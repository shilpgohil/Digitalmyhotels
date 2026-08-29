from __future__ import annotations

import os
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db
from app.main import app
from app.models import Base

# Point tests at the local Docker Postgres regardless of .env content.
# Port 5434 is used because 5432 is often already taken on the dev machine.
_BASE_DB = (
    os.environ.get("DATABASE_URL", get_settings().database_url)
    .replace("@127.0.0.1:5432/", "@127.0.0.1:5434/")
    .replace("@localhost:5432/", "@127.0.0.1:5434/")
)
TEST_DATABASE_URL = _BASE_DB.rsplit("/", 1)[0] + "/digitalmyhotels_test"


@pytest.fixture(scope="session")
async def test_engine():
    admin_engine = create_async_engine(
        get_settings().database_url.rsplit("/", 1)[0] + "/postgres",
        isolation_level="AUTOCOMMIT",
    )
    from sqlalchemy import text

    async with admin_engine.connect() as conn:
        exists = await conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = 'digitalmyhotels_test'")
        )
        if not exists.scalar():
            await conn.execute(text("CREATE DATABASE digitalmyhotels_test"))
    await admin_engine.dispose()

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
