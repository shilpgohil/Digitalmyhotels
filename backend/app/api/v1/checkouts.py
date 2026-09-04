from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.stay import (
    CheckOutOut,
    CheckOutRequest,
    CheckoutReversalRequest,
    SettlementPreviewOut,
)
from app.services import stay as stay_service
from app.services.bookings import get_booking

router = APIRouter(prefix="/checkouts", tags=["stay"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("/{booking_id}/preview", response_model=SettlementPreviewOut)
async def settlement_preview(
    booking_id: UUID,
    late_fee: Decimal = Query(default=Decimal("0.00"), ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.CHECKOUT)),
    db: AsyncSession = Depends(get_db),
) -> SettlementPreviewOut:
    """Exact settlement numbers BEFORE checkout — same calculator the checkout
    itself uses, so the screen can never disagree with the recorded bill."""
    booking = await get_booking(db, tenant, booking_id)
    settlement = await stay_service.compute_settlement(db, booking, late_fee=late_fee)
    return SettlementPreviewOut(**{k: str(v) for k, v in settlement.items()})


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
