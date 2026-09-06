from __future__ import annotations

from fastapi import APIRouter, Depends, File, Path, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.repositories.hotels import (
    get_hotel,
    get_or_create_gst_settings,
    get_or_create_settings,
)
from app.schemas.hotel import (
    GstSettingsOut,
    GstSettingsUpdate,
    HotelImageOut,
    HotelOut,
    HotelSettingsOut,
    HotelSettingsUpdate,
    HotelUpdate,
    PaymentConfigOut,
    PaymentConfigUpdate,
    PaymentQrOut,
    ServiceItemCreate,
    ServiceItemOut,
    ServiceItemUpdate,
)
from app.services import payment_config as upi_service
from app.services.audit import write_audit

router = APIRouter(prefix="/hotels", tags=["hotels"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


# Property gallery: max 5 photos, one per position slot 0–4.
GALLERY_MAX_SLOTS = 5
_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _validate_gallery_image(content_type: str, data: bytes) -> None:
    from io import BytesIO

    from PIL import Image, UnidentifiedImageError

    from app.core.errors import ValidationAppError

    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise ValidationAppError(
            "Image must be PNG, JPEG or WebP", code="invalid_image_type"
        )
    if len(data) > _MAX_IMAGE_BYTES:
        raise ValidationAppError("Image must be 5 MB or smaller", code="image_too_large")
    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
    except UnidentifiedImageError as exc:
        raise ValidationAppError("File is not a valid image", code="invalid_image") from exc


def _image_media_type(object_key: str) -> str:
    key = object_key.lower()
    if key.endswith(".png"):
        return "image/png"
    if key.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


@router.get("/me", response_model=HotelOut)
async def get_my_hotel(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> HotelOut:
    hotel = await get_hotel(db, tenant.require_hotel())
    return HotelOut.model_validate(hotel)


@router.patch("/me", response_model=HotelOut)
async def update_my_hotel(
    body: HotelUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> HotelOut:
    hotel = await get_hotel(db, tenant.require_hotel())
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(hotel, k) for k in changes}
    for key, value in changes.items():
        setattr(hotel, key, value)
    if changes:
        await write_audit(
            db,
            action="hotel.updated",
            entity_type="hotel",
            entity_id=hotel.id,
            actor_id=tenant.user_id,
            hotel_id=hotel.id,
            before=before,
            after=changes,
            correlation_id=_correlation(request),
        )
    return HotelOut.model_validate(hotel)


@router.get("/me/settings", response_model=HotelSettingsOut)
async def get_my_settings(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> HotelSettingsOut:
    settings = await get_or_create_settings(db, tenant.require_hotel())
    return HotelSettingsOut.model_validate(settings)


@router.patch("/me/settings", response_model=HotelSettingsOut)
async def update_my_settings(
    body: HotelSettingsUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> HotelSettingsOut:
    settings = await get_or_create_settings(db, tenant.require_hotel())
    changes = body.model_dump(exclude_unset=True)
    before = {k: str(getattr(settings, k)) for k in changes}
    for key, value in changes.items():
        setattr(settings, key, value)
    if changes:
        await write_audit(
            db,
            action="hotel.settings_updated",
            entity_type="hotel_settings",
            entity_id=settings.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=_correlation(request),
        )
    return HotelSettingsOut.model_validate(settings)


@router.get("/me/services", response_model=list[ServiceItemOut])
async def list_services(
    include_inactive: bool = False,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[ServiceItemOut]:
    from sqlalchemy import select

    from app.models.hotel import HotelServiceItem

    query = select(HotelServiceItem).where(
        HotelServiceItem.hotel_id == tenant.require_hotel()
    )
    if not include_inactive:
        query = query.where(HotelServiceItem.is_active.is_(True))
    items = (await db.execute(query.order_by(HotelServiceItem.name))).scalars().all()
    return [ServiceItemOut.model_validate(i) for i in items]


@router.post("/me/services", response_model=ServiceItemOut, status_code=201)
async def create_service(
    body: ServiceItemCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> ServiceItemOut:
    from app.models.hotel import HotelServiceItem

    item = HotelServiceItem(
        hotel_id=tenant.require_hotel(), name=body.name.strip(), price=body.price
    )
    db.add(item)
    await db.flush()
    await write_audit(
        db,
        action="hotel.service_created",
        entity_type="hotel_service_item",
        entity_id=item.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        after={"name": item.name, "price": str(item.price)},
        correlation_id=_correlation(request),
    )
    return ServiceItemOut.model_validate(item)


@router.patch("/me/services/{service_id}", response_model=ServiceItemOut)
async def update_service(
    service_id: str,
    body: ServiceItemUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> ServiceItemOut:
    from uuid import UUID as _UUID

    from sqlalchemy import select

    from app.core.errors import NotFoundError
    from app.models.hotel import HotelServiceItem

    result = await db.execute(
        select(HotelServiceItem).where(
            HotelServiceItem.id == _UUID(service_id),
            HotelServiceItem.hotel_id == tenant.require_hotel(),
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise NotFoundError("Service item not found")
    changes = body.model_dump(exclude_unset=True)
    before = {k: str(getattr(item, k)) for k in changes}
    for key, value in changes.items():
        setattr(item, key, value)
    if changes:
        await write_audit(
            db,
            action="hotel.service_updated",
            entity_type="hotel_service_item",
            entity_id=item.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=_correlation(request),
        )
    return ServiceItemOut.model_validate(item)


@router.get("/me/gst", response_model=GstSettingsOut)
async def get_my_gst(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> GstSettingsOut:
    gst = await get_or_create_gst_settings(db, tenant.require_hotel())
    return GstSettingsOut.model_validate(gst)


@router.patch("/me/gst", response_model=GstSettingsOut)
async def update_my_gst(
    body: GstSettingsUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GST_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> GstSettingsOut:
    gst = await get_or_create_gst_settings(db, tenant.require_hotel())
    changes = body.model_dump(exclude_unset=True)
    before = {k: str(getattr(gst, k)) for k in changes}
    for key, value in changes.items():
        setattr(gst, key, value)
    if changes:
        gst.version += 1
        await write_audit(
            db,
            action="gst.settings_updated",
            entity_type="gst_settings",
            entity_id=gst.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=_correlation(request),
        )
    return GstSettingsOut.model_validate(gst)


# --- Hotel logo + property gallery ----------------------------------------------


@router.get("/me/logo/image")
async def get_hotel_logo_image(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from app.core.errors import NotFoundError
    from app.integrations.storage.base import get_storage

    hotel = await get_hotel(db, tenant.require_hotel())
    if not hotel.logo_object_key:
        raise NotFoundError("Hotel logo is not configured", code="logo_not_configured")
    try:
        data = await get_storage().get_bytes(hotel.logo_object_key)
    except FileNotFoundError as exc:
        raise NotFoundError("Hotel logo is not available", code="logo_missing") from exc
    return Response(
        content=data,
        media_type=_image_media_type(hotel.logo_object_key),
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/me/gallery", response_model=list[HotelImageOut])
async def list_gallery(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[HotelImageOut]:
    from sqlalchemy import select

    from app.models.hotel import HotelImage

    result = await db.execute(
        select(HotelImage)
        .where(HotelImage.hotel_id == tenant.require_hotel())
        .order_by(HotelImage.position)
    )
    return [HotelImageOut.model_validate(i) for i in result.scalars().all()]


@router.put("/me/gallery/{position}", response_model=HotelImageOut)
async def upload_gallery_image(
    request: Request,
    position: int = Path(ge=0, le=GALLERY_MAX_SLOTS - 1),
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> HotelImageOut:
    from sqlalchemy import select

    from app.integrations.storage.base import get_storage, new_object_key
    from app.models.hotel import HotelImage

    data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    _validate_gallery_image(content_type, data)

    hotel_id = tenant.require_hotel()
    storage = get_storage()
    key = new_object_key(f"hotels/{hotel_id}/gallery", file.filename or "photo.jpg")
    await storage.put_bytes(key=key, data=data, content_type=content_type)

    result = await db.execute(
        select(HotelImage).where(
            HotelImage.hotel_id == hotel_id, HotelImage.position == position
        )
    )
    image = result.scalar_one_or_none()
    old_key = image.object_key if image else None
    if image is None:
        image = HotelImage(hotel_id=hotel_id, position=position, object_key=key)
        db.add(image)
    else:
        image.object_key = key
    await db.flush()

    # Replaced slot — remove the orphaned object (best effort).
    if old_key:
        try:
            await storage.delete(old_key)
        except Exception:  # noqa: BLE001 — stale object is not worth failing the upload
            pass

    await write_audit(
        db,
        action="hotel.gallery_image_uploaded",
        entity_type="hotel_image",
        entity_id=image.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"position": position},
        correlation_id=_correlation(request),
    )
    return HotelImageOut.model_validate(image)


@router.get("/me/gallery/{position}/image")
async def get_gallery_image(
    position: int = Path(ge=0, le=GALLERY_MAX_SLOTS - 1),
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from sqlalchemy import select

    from app.core.errors import NotFoundError
    from app.integrations.storage.base import get_storage
    from app.models.hotel import HotelImage

    result = await db.execute(
        select(HotelImage).where(
            HotelImage.hotel_id == tenant.require_hotel(),
            HotelImage.position == position,
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise NotFoundError("No image at this gallery position", code="image_not_found")
    try:
        data = await get_storage().get_bytes(image.object_key)
    except FileNotFoundError as exc:
        raise NotFoundError("Gallery image is not available", code="image_missing") from exc
    return Response(
        content=data,
        media_type=_image_media_type(image.object_key),
        headers={"Cache-Control": "private, no-store"},
    )


@router.delete("/me/gallery/{position}", status_code=204, response_class=Response)
async def delete_gallery_image(
    request: Request,
    position: int = Path(ge=0, le=GALLERY_MAX_SLOTS - 1),
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from sqlalchemy import select

    from app.core.errors import NotFoundError
    from app.integrations.storage.base import get_storage
    from app.models.hotel import HotelImage

    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(HotelImage).where(
            HotelImage.hotel_id == hotel_id, HotelImage.position == position
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise NotFoundError("No image at this gallery position", code="image_not_found")
    object_key = image.object_key
    image_id = image.id
    await db.delete(image)
    await db.flush()
    try:
        await get_storage().delete(object_key)
    except Exception:  # noqa: BLE001 — orphaned object is not worth failing the delete
        pass
    await write_audit(
        db,
        action="hotel.gallery_image_deleted",
        entity_type="hotel_image",
        entity_id=image_id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        before={"position": position},
        correlation_id=_correlation(request),
    )
    return Response(status_code=204)


# --- UPI payment configuration -------------------------------------------------


@router.get("/me/payment-config", response_model=PaymentConfigOut)
async def get_payment_config(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW_UPI_ID)),
    db: AsyncSession = Depends(get_db),
) -> PaymentConfigOut:
    upi_id, config = await upi_service.get_config_view(db, tenant)
    return PaymentConfigOut(
        upi_id=upi_id,
        config_version=config.config_version,
        has_logo=config.logo_object_key is not None,
        qr_version=config.qr_version,
    )


@router.put("/me/payment-config", response_model=PaymentConfigOut)
async def update_payment_config(
    body: PaymentConfigUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_UPI)),
    db: AsyncSession = Depends(get_db),
) -> PaymentConfigOut:
    config = await upi_service.update_upi_id(
        db, tenant, body.upi_id, correlation_id=_correlation(request)
    )
    return PaymentConfigOut(
        upi_id=body.upi_id,
        config_version=config.config_version,
        has_logo=config.logo_object_key is not None,
        qr_version=config.qr_version,
    )


@router.put("/me/payment-config/logo", response_model=PaymentConfigOut)
async def upload_payment_logo(
    request: Request,
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_UPI)),
    db: AsyncSession = Depends(get_db),
) -> PaymentConfigOut:
    data = await file.read()
    config = await upi_service.update_logo(
        db,
        tenant,
        filename=file.filename or "logo.png",
        content_type=file.content_type or "application/octet-stream",
        data=data,
        correlation_id=_correlation(request),
    )
    # Do not echo the raw UPI ID back from the upload endpoint.
    return PaymentConfigOut(
        upi_id=None,
        config_version=config.config_version,
        has_logo=True,
        qr_version=config.qr_version,
    )


@router.get("/me/payment-qr", response_model=PaymentQrOut)
async def get_payment_qr_meta(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW_PAYMENT_QR)),
    db: AsyncSession = Depends(get_db),
) -> PaymentQrOut:
    from app.repositories.hotels import get_or_create_payment_config

    hotel = await get_hotel(db, tenant.require_hotel())
    config = await get_or_create_payment_config(db, tenant.require_hotel())
    return PaymentQrOut(
        qr_available=config.qr_object_key is not None,
        qr_version=config.qr_version,
        payment_label=upi_service.payment_label(hotel),
    )


@router.get("/me/payment-qr/image")
async def get_payment_qr_image(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW_PAYMENT_QR)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    png = await upi_service.get_qr_png(db, tenant)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )
