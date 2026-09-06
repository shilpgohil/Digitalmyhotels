from __future__ import annotations

from decimal import Decimal
from urllib.parse import quote_plus
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.auth import MessageOut
from app.schemas.platform import (
    RenewalRequestCreate,
    RenewalRequestOut,
    SubscriptionOut,
    SubscriptionPaymentInfoOut,
    SubscriptionPlanOut,
)
from app.services import subscriptions as sub_service
from app.services.audit import write_audit
from app.services.notifications import create_notification
from app.services.payment_config import render_qr_png_async

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("/plans", response_model=list[SubscriptionPlanOut])
async def list_plans(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[SubscriptionPlanOut]:
    items = await sub_service.list_plans(db)
    return [SubscriptionPlanOut.model_validate(p) for p in items]


@router.get("/me", response_model=SubscriptionOut | None)
async def my_subscription(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut | None:
    sub = await sub_service.get_active_subscription(db, tenant.require_hotel())
    if sub is None:
        return None
    sub_service.refresh_status(sub)
    return SubscriptionOut.model_validate(sub)


@router.post("/me/renewal-request", response_model=MessageOut)
async def request_renewal(
    request: Request,
    plan_code: str | None = None,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Notify platform admins that this hotel wants to renew/upgrade.

    Payment stays operational (no gateway in this phase) — the super admin
    assigns the plan after confirming the payment.
    """
    from app.models.hotel import Hotel
    from app.models.user import User

    hotel_id = tenant.require_hotel()
    hotel = (await db.execute(select(Hotel).where(Hotel.id == hotel_id))).scalar_one()
    super_admins = (
        (await db.execute(select(User).where(User.is_super_admin.is_(True)))).scalars().all()
    )
    for admin in super_admins:
        await create_notification(
            db,
            hotel_id=None,
            user_id=admin.id,
            type="subscription.renewal_requested",
            title=f"Renewal request: {hotel.name}",
            body=f"{hotel.name} requested a subscription renewal"
            + (f" (plan: {plan_code})" if plan_code else "")
            + ". Confirm payment and assign the plan.",
            payload={"hotel_id": str(hotel_id), "plan_code": plan_code},
        )
    await write_audit(
        db,
        action="subscriptions.renewal_requested",
        entity_type="hotel",
        entity_id=hotel_id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"plan_code": plan_code},
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    return MessageOut(
        message="Renewal request sent. The DigitalMyHotels team will contact you shortly."
    )


async def _notify_super_admins_of_request(
    db: AsyncSession, *, hotel_name: str, plan_name: str, hotel_id: UUID, request_id: UUID
) -> None:
    from app.models.user import User

    super_admins = (
        (await db.execute(select(User).where(User.is_super_admin.is_(True)))).scalars().all()
    )
    for admin in super_admins:
        await create_notification(
            db,
            hotel_id=None,
            user_id=admin.id,
            type="subscription.renewal_requested",
            category="platform",
            title=f"Renewal request: {hotel_name}",
            body=f"{hotel_name} says they paid for the {plan_name} plan. "
            "Verify the payment and approve or reject the request.",
            payload={"hotel_id": str(hotel_id), "renewal_request_id": str(request_id)},
        )


@router.post("/renewal-requests", response_model=RenewalRequestOut, status_code=201)
async def create_renewal_request(
    body: RenewalRequestCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_SETTINGS)),
    db: AsyncSession = Depends(get_db),
) -> RenewalRequestOut:
    """Partner confirms an offline UPI payment — creates a pending request."""
    from app.models.hotel import Hotel

    hotel_id = tenant.require_hotel()
    plan = await sub_service.get_plan(db, body.plan_id)
    req = await sub_service.create_renewal_request(
        db,
        hotel_id=hotel_id,
        plan=plan,
        requested_by_id=tenant.user_id,
        note=body.note,
    )
    hotel = (await db.execute(select(Hotel).where(Hotel.id == hotel_id))).scalar_one()
    await _notify_super_admins_of_request(
        db, hotel_name=hotel.name, plan_name=plan.name, hotel_id=hotel_id, request_id=req.id
    )
    await write_audit(
        db,
        action="subscriptions.renewal_request_created",
        entity_type="subscription_renewal_request",
        entity_id=req.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"plan_code": plan.code, "amount": str(req.amount)},
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    return RenewalRequestOut.model_validate(req)


@router.get("/renewal-requests/mine", response_model=RenewalRequestOut | None)
async def my_renewal_request(
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RenewalRequestOut | None:
    req = await sub_service.get_latest_renewal_request(db, tenant.require_hotel())
    if req is None:
        return None
    return RenewalRequestOut.model_validate(req)


@router.get("/payment-info", response_model=SubscriptionPaymentInfoOut)
async def platform_payment_info(
    _tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
) -> SubscriptionPaymentInfoOut:
    """Platform collection UPI (for the renewal payment modal). Not a secret —
    it is the VPA the partner is asked to pay into."""
    settings = get_settings()
    if not settings.platform_upi_id:
        return SubscriptionPaymentInfoOut(configured=False)
    return SubscriptionPaymentInfoOut(
        configured=True,
        upi_id=settings.platform_upi_id,
        payee_name=settings.platform_upi_payee_name or settings.app_name,
    )


@router.get("/payment-qr")
async def platform_payment_qr(
    plan_id: UUID,
    _tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """UPI QR for paying the platform the exact plan amount. 404 when the
    platform UPI is not configured (frontend falls back to instructions)."""
    settings = get_settings()
    if not settings.platform_upi_id:
        raise NotFoundError(
            "Platform payment UPI is not configured", code="platform_upi_not_configured"
        )
    plan = await sub_service.get_plan(db, plan_id)
    payee = settings.platform_upi_payee_name or settings.app_name
    amount = plan.price.quantize(Decimal("0.01"))
    uri = (
        f"upi://pay"
        f"?pa={quote_plus(settings.platform_upi_id)}"
        f"&pn={quote_plus(payee)}"
        f"&am={amount}"
        f"&cu=INR"
    )
    png = await render_qr_png_async(uri)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )
