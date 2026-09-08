from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_super_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.hotel import HotelOut
from app.schemas.ops import PlatformTrendOut
from app.schemas.platform import (
    AdminCustomerDetailOut,
    AdminCustomerListOut,
    AdminCustomerSummaryOut,
    AdminHotelDetailOut,
    AdminHotelUpdate,
    CreateHotelRequest,
    HotelAdminListOut,
    PlatformDashboardOut,
    RenewalRequestAdminListOut,
    RenewalRequestAdminOut,
    SubscriptionAssign,
    SubscriptionOut,
    SubscriptionPlanCreate,
    SubscriptionPlanOut,
    SubscriptionPlanUpdate,
)
from app.services import reports as reports_service
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


@router.get("/dashboard/trend", response_model=PlatformTrendOut)
async def platform_trend(
    months: int = Query(default=6, ge=1, le=24),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> PlatformTrendOut:
    """Monthly hotel growth + revenue + check-ins for the super-admin dashboard chart."""
    return await reports_service.platform_monthly_trend(db, months=months)


@router.get("/hotels", response_model=HotelAdminListOut)
async def list_hotels(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    recent_days: int | None = Query(default=None, ge=1, le=365),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> HotelAdminListOut:
    return await admin_service.list_hotels(
        db,
        status=status,
        q=q,
        limit=limit,
        offset=offset,
        recent_days=recent_days,
    )


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


@router.get("/hotels/{hotel_id}", response_model=AdminHotelDetailOut)
async def get_hotel_detail(
    hotel_id: UUID,
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminHotelDetailOut:
    """Hotel profile + owner contact for the Super Admin edit view (item 28)."""
    return AdminHotelDetailOut(**await admin_service.get_hotel_detail(db, hotel_id))


@router.patch("/hotels/{hotel_id}", response_model=AdminHotelDetailOut)
async def update_hotel(
    hotel_id: UUID,
    body: AdminHotelUpdate,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminHotelDetailOut:
    """Super Admin hotel edit — profile fields + owner-phone backfill (items 28/30)."""
    changes = body.model_dump(exclude_unset=True)
    if "email" in changes and changes["email"] is not None:
        changes["email"] = str(changes["email"])
    detail = await admin_service.update_hotel_admin(
        db, hotel_id, changes, actor_id=user.id, correlation_id=_correlation(request)
    )
    return AdminHotelDetailOut(**detail)


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


@router.get("/password-requests")
async def list_password_requests(
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Pending owner/administrator password-reset requests (item 34)."""
    from app.services.password_requests import list_platform_requests

    return await list_platform_requests(db)


@router.post("/password-requests/{request_id}/dismiss")
async def dismiss_password_request(
    request_id: UUID,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.services.password_requests import dismiss_request

    await dismiss_request(
        db,
        request_id,
        resolved_by_id=user.id,
        audience="super_admin",
        correlation_id=_correlation(request),
    )
    return {"message": "Request dismissed"}


@router.post("/users/{user_id}/reset-password")
async def reset_hotel_user_password(
    user_id: UUID,
    request: Request,
    body: dict,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Super Admin resets a hotel owner/administrator's password (item 34).

    Issues the temporary password, revokes every session, forces a change at
    next login, resolves the pending request and audits the action.
    """
    from sqlalchemy import select as _select

    from app.core.errors import NotFoundError, ValidationAppError
    from app.core.security import hash_password
    from app.services.auth import _revoke_all_user_refresh_tokens
    from app.services.password_requests import complete_for_user

    new_password = str(body.get("new_password") or "")
    if len(new_password) < 8:
        raise ValidationAppError(
            "Password must be at least 8 characters", code="password_too_short"
        )
    target = (
        await db.execute(_select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if target is None:
        raise NotFoundError("User not found")
    if target.is_super_admin and target.id != user.id:
        raise ValidationAppError(
            "Super admin accounts cannot be reset here", code="super_admin_protected"
        )

    target.password_hash = hash_password(new_password)
    target.must_reset_password = True
    await _revoke_all_user_refresh_tokens(db, target.id)
    await complete_for_user(db, target.id, resolved_by_id=user.id)
    await write_audit(
        db,
        action="platform.password_reset",
        entity_type="user",
        entity_id=target.id,
        actor_id=user.id,
        correlation_id=_correlation(request),
    )
    return {"message": "Password reset — user must change it at next login"}


@router.get("/customers", response_model=AdminCustomerListOut)
async def list_customers(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminCustomerListOut:
    """Cross-hotel customer search — MASKED summaries only (item 36)."""
    items, total = await admin_service.search_customers(
        db, q=q, limit=limit, offset=offset
    )
    return AdminCustomerListOut(
        items=[AdminCustomerSummaryOut(**i) for i in items], total=total
    )


@router.get("/customers/{guest_id}", response_model=AdminCustomerDetailOut)
async def get_customer(
    guest_id: UUID,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminCustomerDetailOut:
    """Explicit AUDITED full-profile view — the only unmasked path (item 36)."""
    detail = await admin_service.get_customer_detail(
        db, guest_id, actor_id=user.id, correlation_id=_correlation(request)
    )
    return AdminCustomerDetailOut(**detail)


@router.get("/plans", response_model=list[SubscriptionPlanOut])
async def list_plans(
    include_inactive: bool = Query(default=False),
    _user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[SubscriptionPlanOut]:
    """Plan catalogue. include_inactive=true powers the management page,
    where deactivated plans stay visible (item 27: deactivate, never delete)."""
    if include_inactive:
        from sqlalchemy import select

        from app.models.platform import SubscriptionPlan

        rows = (
            await db.execute(
                select(SubscriptionPlan).order_by(
                    SubscriptionPlan.is_active.desc(), SubscriptionPlan.duration_days
                )
            )
        ).scalars()
        return [SubscriptionPlanOut.model_validate(p) for p in rows]
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


@router.patch("/plans/{plan_id}", response_model=SubscriptionPlanOut)
async def update_plan(
    plan_id: UUID,
    body: SubscriptionPlanUpdate,
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPlanOut:
    """Edit price/name/duration or (de)activate a plan — never deletes (item 27)."""
    plan = await admin_service.update_plan(
        db,
        plan_id,
        body.model_dump(exclude_unset=True),
        actor_id=user.id,
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
    sub = await sub_service.renew_subscription(
        db,
        hotel_id=hotel_id,
        plan=plan,
        start=body.start_date,
        grace_days=body.grace_days,
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
