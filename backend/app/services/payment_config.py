"""UPI payment configuration and QR generation.

Security rules (non-negotiable):
- Raw UPI ID is returned only to roles holding HOTEL_VIEW_UPI_ID.
- Workers receive the QR image and a safe label — never the raw UPI ID.
- Every configuration change is audited (without logging the raw value).
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from urllib.parse import quote_plus
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_sensitive, encrypt_sensitive
from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.integrations.storage.base import get_storage, new_object_key
from app.models.hotel import Hotel, HotelPaymentConfig
from app.repositories.hotels import get_hotel, get_or_create_payment_config
from app.services.audit import write_audit

ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_LOGO_BYTES = 2 * 1024 * 1024


async def update_upi_id(
    db: AsyncSession,
    tenant: TenantContext,
    upi_id: str,
    *,
    correlation_id: str | None = None,
) -> HotelPaymentConfig:
    hotel_id = tenant.require_hotel()
    config = await get_or_create_payment_config(db, hotel_id)
    config.upi_id_encrypted = encrypt_sensitive(upi_id)
    config.upi_id_last4 = upi_id.split("@", 1)[0][-4:]
    config.config_version += 1
    config.updated_by_id = tenant.user_id
    await _regenerate_qr(db, hotel_id, config)
    await write_audit(
        db,
        action="upi.config_updated",
        entity_type="hotel_payment_config",
        entity_id=config.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        # Never store the raw UPI ID in the audit trail.
        after={"config_version": config.config_version, "upi_last4": config.upi_id_last4},
        correlation_id=correlation_id,
    )
    return config


async def update_logo(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    correlation_id: str | None = None,
) -> HotelPaymentConfig:
    if content_type not in ALLOWED_LOGO_TYPES:
        raise ValidationAppError(
            "Logo must be PNG, JPEG or WebP", code="invalid_logo_type"
        )
    if len(data) > MAX_LOGO_BYTES:
        raise ValidationAppError("Logo must be 2 MB or smaller", code="logo_too_large")
    _validate_image(data)

    hotel_id = tenant.require_hotel()
    config = await get_or_create_payment_config(db, hotel_id)
    storage = get_storage()
    key = new_object_key(f"hotels/{hotel_id}/logo", filename)
    await storage.put_bytes(key=key, data=data, content_type=content_type)
    config.logo_object_key = key
    config.config_version += 1
    config.updated_by_id = tenant.user_id

    hotel = await get_hotel(db, hotel_id)
    hotel.logo_object_key = key

    if config.upi_id_encrypted:
        await _regenerate_qr(db, hotel_id, config)

    await write_audit(
        db,
        action="upi.logo_updated",
        entity_type="hotel_payment_config",
        entity_id=config.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"config_version": config.config_version},
        correlation_id=correlation_id,
    )
    return config


def _validate_image(data: bytes) -> None:
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
    except UnidentifiedImageError as exc:
        raise ValidationAppError("File is not a valid image", code="invalid_image") from exc


def build_upi_uri(upi_id: str, payee_name: str) -> str:
    # UPI spec: pa = payment address (VPA), pn = payee name, cu = currency,
    # mc = merchant category code (5812 = restaurant/hospitality signals it's
    # a business VPA so UPI apps prefer pn over the bank-registered VPA name).
    # quote_plus encodes spaces as '+' which is correct for UPI query params.
    return (
        f"upi://pay"
        f"?pa={quote_plus(upi_id)}"
        f"&pn={quote_plus(payee_name)}"
        f"&cu=INR"
        f"&mc=5812"
    )


async def _regenerate_qr(
    db: AsyncSession, hotel_id: UUID, config: HotelPaymentConfig
) -> None:
    """Generate the UPI QR server-side, compositing the hotel logo in the center.

    Pillow image processing is CPU-bound; we run it in a thread-pool executor
    so the async event loop stays responsive.
    """
    if not config.upi_id_encrypted:
        return
    upi_id = decrypt_sensitive(config.upi_id_encrypted)
    hotel = await get_hotel(db, hotel_id)
    logo_bytes = await _load_logo(config)
    uri = build_upi_uri(upi_id, hotel.name)

    # Offload CPU-bound Pillow work to a thread executor.
    loop = asyncio.get_event_loop()
    qr_png = await loop.run_in_executor(None, _render_qr_png, uri, logo_bytes)

    storage = get_storage()
    key = f"hotels/{hotel_id}/payment-qr/v{config.config_version}.png"
    await storage.put_bytes(key=key, data=qr_png, content_type="image/png")
    config.qr_object_key = key
    config.qr_version = config.config_version


async def _load_logo(config: HotelPaymentConfig) -> bytes | None:
    if not config.logo_object_key:
        return None
    try:
        return await get_storage().get_bytes(config.logo_object_key)
    except FileNotFoundError:
        return None


def _render_qr_png(payload: str, logo_bytes: bytes | None) -> bytes:
    import qrcode
    from PIL import Image
    from qrcode.constants import ERROR_CORRECT_H

    # High error correction so the centered logo cannot break scanability.
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=10, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    if logo_bytes:
        logo = Image.open(BytesIO(logo_bytes)).convert("RGBA")
        # Logo occupies at most ~1/5 of the QR width — safe with H correction.
        target = img.size[0] // 5
        logo.thumbnail((target, target))
        canvas = Image.new("RGBA", (target + 12, target + 12), "white")
        offset = ((canvas.size[0] - logo.size[0]) // 2, (canvas.size[1] - logo.size[1]) // 2)
        canvas.paste(logo, offset, logo)
        pos = ((img.size[0] - canvas.size[0]) // 2, (img.size[1] - canvas.size[1]) // 2)
        img.paste(canvas.convert("RGB"), pos)

    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def get_config_view(
    db: AsyncSession, tenant: TenantContext
) -> tuple[str | None, HotelPaymentConfig]:
    """Raw UPI ID + config — caller must have verified HOTEL_VIEW_UPI_ID."""
    hotel_id = tenant.require_hotel()
    config = await get_or_create_payment_config(db, hotel_id)
    upi_id = decrypt_sensitive(config.upi_id_encrypted) if config.upi_id_encrypted else None
    return upi_id, config


async def get_qr_png(db: AsyncSession, tenant: TenantContext) -> bytes:
    """QR image bytes — safe for any role with HOTEL_VIEW_PAYMENT_QR."""
    hotel_id = tenant.require_hotel()
    config = await get_or_create_payment_config(db, hotel_id)
    if not config.qr_object_key:
        raise NotFoundError("Payment QR is not configured yet", code="qr_not_configured")
    try:
        return await get_storage().get_bytes(config.qr_object_key)
    except FileNotFoundError as exc:
        raise NotFoundError("Payment QR is not available", code="qr_missing") from exc


def payment_label(hotel: Hotel) -> str:
    return f"Pay {hotel.name} via UPI"
