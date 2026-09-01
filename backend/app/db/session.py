from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

settings = get_settings()

# ── Connection pool configuration ──────────────────────────────────────────────
# MEASURED: establishing a fresh connection to Neon (TCP + TLS + SCRAM auth)
# costs ~3 seconds from Render. NullPool paid that cost on EVERY request and
# made the whole app feel slow. A small persistent pool keeps connections
# alive between requests → DB round-trips drop to single-digit milliseconds.
#
# Sizing: Render free tier runs 1 uvicorn worker, so at most
# pool_size + max_overflow = 5 connections — safely within Neon free-tier
# limits (and far below the ~112 allowed via the "-pooler" URL).
#
# pool_recycle=240 proactively replaces connections before Neon's ~5-minute
# idle timeout can kill them; pool_pre_ping catches anything that slips
# through (the ping is a same-region round-trip, ~2 ms).
_pool_kwargs: dict = {
    "pool_size": 5 if not settings.is_production else 3,
    "max_overflow": 5 if not settings.is_production else 2,
    "pool_timeout": 15,
    "pool_recycle": 240,
    "pool_pre_ping": True,
}

# Neon's pooled connection string ("-pooler" hostname) runs PgBouncer in
# transaction mode, which is incompatible with asyncpg's prepared-statement
# cache. Disabling the cache costs ~1 ms per query but works with both the
# pooled and direct connection strings.
_connect_args: dict = {}
if settings.is_production:
    _connect_args = {"statement_cache_size": 0}

engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,
    connect_args=_connect_args,
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
