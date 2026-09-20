"""Platform-level configuration service.

Manages the single-row `platform_config` table that stores settings the
Super Admin can change from the SA panel (e.g. the platform collection UPI
used for subscription payments).  Reads fall back to environment variables
so existing deployments that already set PLATFORM_UPI_ID in Render continue
to work without a manual migration step.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.platform import PlatformConfig


async def get_platform_config(db: AsyncSession) -> PlatformConfig | None:
    """Return the persisted config row, or None if not yet written."""
    result = await db.execute(select(PlatformConfig).limit(1))
    return result.scalar_one_or_none()


async def get_platform_upi(db: AsyncSession) -> tuple[str | None, str | None]:
    """
    Return (upi_id, payee_name) for the platform collection UPI.

    Priority:
    1. DB row (set by SA via the panel)
    2. Environment variable PLATFORM_UPI_ID (legacy / first-deploy fallback)
    """
    cfg = await get_platform_config(db)
    if cfg and cfg.platform_upi_id:
        return cfg.platform_upi_id, cfg.platform_upi_payee_name
    # Env-var fallback keeps existing Render deployments working.
    settings = get_settings()
    if settings.platform_upi_id:
        return settings.platform_upi_id, (settings.platform_upi_payee_name or settings.app_name)
    return None, None


async def update_platform_upi(
    db: AsyncSession,
    *,
    upi_id: str | None,
    payee_name: str | None,
) -> PlatformConfig:
    """Upsert the platform UPI config (creates row on first call)."""
    cfg = await get_platform_config(db)
    if cfg is None:
        cfg = PlatformConfig(id=uuid.uuid4())
        db.add(cfg)
    cfg.platform_upi_id = upi_id.strip() if upi_id else None
    cfg.platform_upi_payee_name = payee_name.strip() if payee_name else None
    await db.flush()
    return cfg
