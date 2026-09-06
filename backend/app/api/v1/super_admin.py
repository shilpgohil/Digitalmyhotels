from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_super_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.hotel import HotelOut
from app.schemas.platform import (
    CreateHotelRequest,
    HotelAdminListOut,
    PlatformDashboardOut,
    RenewalRequestAdminListOut,
    RenewalRequestAdminOut,
    SubscriptionAssign,
    SubscriptionOut,
    SubscriptionPlanCreate,
    SubscriptionPlanOut,
)
from app.services import subscriptions as sub_service
from app.services import super_admin as admin_service
from app.services.audit import write_audit
from app.services.notifications import create_notification

router = APIRouter(prefix="/super-admin", tags=["super-admin"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("/dashboard", response_model=PlatformDashboardOut)
async def platform_dashboard(
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> PlatformDashboardOut:
    return await admin_service.dashboard(db)


@router.get("/hotels", response_model=HotelAdminListOut)
async def list_hotels(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> HotelAdminListOut:
    return await admin_service.list_hotels(db, status=status, q=q, limit=limit, offset=offset)


@router.post("/hotels", response_model=HotelOut, status_code=201)
async def create_hotel(
    body: CreateHotelRequest,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> HotelOut:
    hotel = await admin_service.create_hotel_with_owner(
        db, body, actor_id=user.id, correlation_id=_correlation(request)
    )
    return HotelOut.model_validate(hotel)


@router.post("/hotels/{hotel_id}/status", response_model=HotelOut)
async def set_status(
    hotel_id: UUID,
    request: Request,
    status: str = Query(...),
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> HotelOut:
    hotel = await admin_service.set_hotel_status(
        db, hotel_id, status, actor_id=user.id, correlation_id=_correlation(request)
    )
    return HotelOut.model_validate(hotel)


@router.get("/plans", response_model=list[SubscriptionPlanOut])
async def list_plans(
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[SubscriptionPlanOut]:
    items = await sub_service.list_plans(db)
    return [SubscriptionPlanOut.model_validate(p) for p in items]


@router.post("/plans", response_model=SubscriptionPlanOut, status_code=201)
async def create_plan(
    body: SubscriptionPlanCreate,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPlanOut:
    from app.models.platform import SubscriptionPlan

    plan = SubscriptionPlan(**body.model_dump())
    db.add(plan)
    await db.flush()
    await write_audit(
        db,
        action="platform.plan_created",
        entity_type="subscription_plan",
        entity_id=plan.id,
        actor_id=user.id,
        after={"code": plan.code},
        correlation_id=_correlation(request),
    )
    return SubscriptionPlanOut.model_validate(plan)


@router.post("/hotels/{hotel_id}/subscription", response_model=SubscriptionOut)
async def assign_subscription(
    hotel_id: UUID,
    body: SubscriptionAssign,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    plan = await sub_service.get_plan(db, body.plan_id)
    sub = await sub_service.assign_plan(
        db,
        hotel_id=hotel_id,
        plan=plan,
        start=body.start_date,
        grace_days=body.grace_days,
        trial=False,
    )
    await write_audit(
        db,
        action="platform.subscription_assigned",
        entity_type="subscription",
        entity_id=sub.id,
        actor_id=user.id,
        hotel_id=hotel_id,
        correlation_id=_correlation(request),
    )
    return SubscriptionOut.model_validate(sub)


@router.get("/renewal-requests", response_model=RenewalRequestAdminListOut)
async def list_renewal_requests(
    status: str | None = Query(default="pending"),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> RenewalRequestAdminListOut:
    rows = await sub_service.list_renewal_requests(db, status=status)
    items = [
        RenewalRequestAdminOut(
            id=req.id,
            hotel_id=req.hotel_id,
            hotel_name=hotel.name,
            plan_id=plan.id,
            plan_name=plan.name,
            duration_days=plan.duration_days,
            amount=req.amount,
            status=req.status,
            created_at=req.created_at,
            decided_at=req.decided_at,
        )
        for req, hotel, plan in rows
    ]
    return RenewalRequestAdminListOut(items=items, total=len(items))


async def _decide_renewal(
    db: AsyncSession,
    request_id: UUID,
    *,
    approve: bool,
    user: User,
    correlation_id: str | None,
) -> RenewalRequestAdminOut:
    from sqlalchemy import select

    from app.models.hotel import Hotel

    req, plan = await sub_service.decide_renewal_request(
        db, request_id, approve=approve, decided_by_id=user.id
    )
    hotel = (await db.execute(select(Hotel).where(Hotel.id == req.hotel_id))).scalar_one()
    verb = "approved" if approve else "rejected"
    await write_audit(
        db,
        action=f"platform.renewal_request_{verb}",
        entity_type="subscription_renewal_request",
        entity_id=req.id,
        actor_id=user.id,
        hotel_id=req.hotel_id,
        after={"plan_code": plan.code, "amount": str(req.amount)},
        correlation_id=correlation_id,
    )
    # Tell the partner the outcome (finance category, deep link to the plan page).
    if approve:
        title = "Subscription renewed"
        body = (
            f"Your payment for the {plan.name} plan was confirmed. "
            "Your subscription is now active."
        )
    else:
        title = "Renewal request rejected"
        body = (
            f"Your renewal request for the {plan.name} plan could not be verified. "
            "Please contact the DigitalMyHotels team."
        )
    await create_notification(
        db,
        hotel_id=req.hotel_id,
        user_id=None,
        type=f"subscription.renewal_{verb}",
        category="finance",
        title=title,
        body=body,
        deep_link="/plan",
        payload={"renewal_request_id": str(req.id), "plan_code": plan.code},
    )
    return RenewalRequestAdminOut(
        id=req.id,
        hotel_id=req.hotel_id,
        hotel_name=hotel.name,
        plan_id=plan.id,
        plan_name=plan.name,
        duration_days=plan.duration_days,
        amount=req.amount,
        status=req.status,
        created_at=req.created_at,
        decided_at=req.decided_at,
    )


@router.post("/renewal-requests/{request_id}/approve", response_model=RenewalRequestAdminOut)
async def approve_renewal_request(
    request_id: UUID,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> RenewalRequestAdminOut:
    return await _decide_renewal(
        db, request_id, approve=True, user=user, correlation_id=_correlation(request)
    )


@router.post("/renewal-requests/{request_id}/reject", response_model=RenewalRequestAdminOut)
async def reject_renewal_request(
    request_id: UUID,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> RenewalRequestAdminOut:
    return await _decide_renewal(
        db, request_id, approve=False, user=user, correlation_id=_correlation(request)
    )
