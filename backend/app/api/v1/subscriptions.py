from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.auth import MessageOut
from app.schemas.platform import SubscriptionOut, SubscriptionPlanOut
from app.services import subscriptions as sub_service
from app.services.audit import write_audit
from app.services.notifications import create_notification

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
