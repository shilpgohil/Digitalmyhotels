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


async def get_platform_logo_bytes(db: AsyncSession) -> bytes | None:
    """Return the raw bytes of the platform brand logo stored in B2, or None.

    Used to composite the DigitalMyHotels logo in the centre of the
    subscription payment QR.  Failure is non-fatal — the QR is rendered
    without a logo if the key is absent or the object cannot be fetched.
    Falls back to PLATFORM_LOGO_URL env var if no DB key is set.
    """
    from app.core.errors import NotFoundError
    from app.integrations.storage.base import get_storage

    cfg = await get_platform_config(db)

    # Priority 1: B2 key stored in DB (uploaded by SA via Settings page)
    if cfg and cfg.platform_logo_object_key:
        try:
            return await get_storage().get_bytes(cfg.platform_logo_object_key)
        except (NotFoundError, FileNotFoundError, Exception):  # noqa: BLE001
            pass

    # Priority 2: PLATFORM_LOGO_URL env var (URL-hosted logo, optional)
    settings = get_settings()
    if settings.platform_logo_url:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(settings.platform_logo_url)
                if resp.status_code == 200:
                    ct = resp.headers.get("content-type", "")
                    if ct.startswith("image/"):
                        return resp.content
        except Exception:  # noqa: BLE001
            pass

    return None


async def upload_platform_logo(
    db: AsyncSession,
    *,
    data: bytes,
    content_type: str,
) -> PlatformConfig:
    """Store platform brand logo in B2, update PlatformConfig, return row."""
    from app.core.errors import ValidationAppError
    from app.integrations.storage.base import get_storage, new_object_key

    ALLOWED = {"image/png", "image/jpeg", "image/webp"}
    MAX_BYTES = 512 * 1024  # 512 KB — logos are small

    if content_type not in ALLOWED:
        raise ValidationAppError(
            "Logo must be PNG, JPEG or WebP", code="invalid_logo_type"
        )
    if len(data) > MAX_BYTES:
        raise ValidationAppError(
            "Logo must be 512 KB or smaller", code="logo_too_large"
        )

    cfg = await get_platform_config(db)
    if cfg is None:
        cfg = PlatformConfig(id=uuid.uuid4())
        db.add(cfg)

    storage = get_storage()
    suffix = {"image/png": "png", "image/webp": "webp"}.get(content_type, "jpg")
    key = new_object_key("platform/logo", f"brand.{suffix}")
    await storage.put_bytes(key=key, data=data, content_type=content_type)

    # Best-effort cleanup of old key
    old_key = cfg.platform_logo_object_key
    if old_key and old_key != key:
        try:
            await storage.delete(old_key)
        except Exception:  # noqa: BLE001
            pass

    cfg.platform_logo_object_key = key
    await db.flush()
    return cfg
