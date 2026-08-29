from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.stay import CheckOutOut, CheckOutRequest, CheckoutReversalRequest
from app.services import stay as stay_service

router = APIRouter(prefix="/checkouts", tags=["stay"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.post("", response_model=CheckOutOut, status_code=201)
async def check_out(
    body: CheckOutRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.CHECKOUT)),
    db: AsyncSession = Depends(get_db),
) -> CheckOutOut:
    return await stay_service.check_out(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.post("/{booking_id}/reverse", response_model=CheckOutOut)
async def reverse_checkout(
    booking_id: UUID,
    body: CheckoutReversalRequest,
    request: Request,
    # Reversal is restricted: requires checkout AND payment-correction rights
    # (Owner/Manager hold both; Admin does not hold corrections).
    tenant: TenantContext = Depends(
        require_permissions(Permission.CHECKOUT, Permission.PAYMENTS_CORRECT)
    ),
    db: AsyncSession = Depends(get_db),
) -> CheckOutOut:
    return await stay_service.reverse_checkout(
        db, tenant, booking_id, body.reason, correlation_id=_correlation(request)
    )
