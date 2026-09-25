from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError
from app.models.hotel import Hotel, HotelPaymentConfig, HotelSettings
from app.models.invoice import GstSettings


async def get_hotel(db: AsyncSession, hotel_id: UUID) -> Hotel:
    result = await db.execute(
        select(Hotel).options(selectinload(Hotel.settings)).where(Hotel.id == hotel_id)
    )
    hotel = result.scalar_one_or_none()
    if hotel is None:
        raise NotFoundError("Hotel not found")
    return hotel


async def get_or_create_settings(db: AsyncSession, hotel_id: UUID) -> HotelSettings:
    result = await db.execute(
        select(HotelSettings).where(HotelSettings.hotel_id == hotel_id)
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = HotelSettings(hotel_id=hotel_id)
        db.add(settings)
        await db.flush()
    return settings


async def get_or_create_gst_settings(db: AsyncSession, hotel_id: UUID) -> GstSettings:
    result = await db.execute(select(GstSettings).where(GstSettings.hotel_id == hotel_id))
    gst = result.scalar_one_or_none()
    if gst is None:
        gst = GstSettings(hotel_id=hotel_id)
        db.add(gst)
        await db.flush()
    return gst


async def get_gst_context(
    db: AsyncSession, hotel_id: UUID
) -> tuple[GstSettings, bool, bool]:
    """(gst_settings, is_registered, inclusive) — THE way to read GST config.

    Client 09/2026 GST modes map onto two persisted flags:
    - "no_gst"               → is_registered=False
    - "included_by_hotel"    → is_registered=True, inclusive=True
      (GST extracted from within the price; customer never sees it)
    - "included_by_customer" → is_registered=True, inclusive=False
      (GST added on top and displayed to the customer)
    """
    gst = await get_or_create_gst_settings(db, hotel_id)
    settings = await get_or_create_settings(db, hotel_id)
    return gst, gst.is_gst_registered, bool(settings.tax_inclusive_pricing)


def gst_mode(is_registered: bool, inclusive: bool) -> str:
    """String mode name for API responses / audits."""
    if not is_registered:
        return "no_gst"
    return "included_by_hotel" if inclusive else "included_by_customer"


async def get_or_create_payment_config(
    db: AsyncSession, hotel_id: UUID
) -> HotelPaymentConfig:
    result = await db.execute(
        select(HotelPaymentConfig).where(HotelPaymentConfig.hotel_id == hotel_id)
    )
    config = result.scalar_one_or_none()
    if config is None:
        config = HotelPaymentConfig(hotel_id=hotel_id)
        db.add(config)
        await db.flush()
    return config
