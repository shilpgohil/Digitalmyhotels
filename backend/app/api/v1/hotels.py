from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
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
        headers={"Cache-Control": "private, max-age=60"},
    )
