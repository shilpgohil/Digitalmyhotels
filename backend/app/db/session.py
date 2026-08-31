from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

# ── Connection pool configuration ──────────────────────────────────────────────
# Neon free tier limits concurrent connections (~10 max). We use NullPool in
# production so every request gets a fresh connection and releases it immediately
# — this pairs perfectly with Neon's HTTP-based connection pooler URL
# (hostname contains "-pooler") which maintains a warm connection pool on the
# Neon side. In development the default pool is fine since the DB is local.
_pool_kwargs: dict = {}
if settings.is_production:
    _pool_kwargs = {"poolclass": NullPool}
else:
    _pool_kwargs = {
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": 15,
        "pool_recycle": 300,   # Recycle connections every 5 min — avoids stale conns
        "pool_pre_ping": True,
    }

engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,
    **_pool_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
