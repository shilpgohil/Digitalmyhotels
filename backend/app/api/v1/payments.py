from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.payment import (
    LedgerEntryOut,
    LedgerOut,
    PaymentCorrection,
    PaymentCreate,
    PaymentListOut,
    PaymentOut,
    PaymentSummaryOut,
    RefundCreate,
    RefundOut,
)
from app.services import ledger as ledger_service
from app.services import payments as payments_service
from app.services.bookings import get_booking

router = APIRouter(prefix="/payments", tags=["payments"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("", response_model=PaymentListOut)
async def list_payments(
    booking_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> PaymentListOut:
    items, total = await payments_service.list_payments(
        db, tenant, booking_id=booking_id, limit=limit, offset=offset
    )
    return PaymentListOut(
        items=[PaymentOut.model_validate(p) for p in items], total=total
    )


@router.get("/summary", response_model=PaymentSummaryOut)
async def payment_summary(
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> PaymentSummaryOut:
    from datetime import date as _date

    return await payments_service.payment_summary(
        db,
        tenant,
        from_date=_date.fromisoformat(from_date) if from_date else None,
        to_date=_date.fromisoformat(to_date) if to_date else None,
    )


@router.post("", response_model=PaymentOut, status_code=201)
async def collect_payment(
    body: PaymentCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_COLLECT)),
    db: AsyncSession = Depends(get_db),
) -> PaymentOut:
    payment = await payments_service.collect_payment(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return PaymentOut.model_validate(payment)


@router.post("/{payment_id}/correct", response_model=PaymentOut)
async def correct_payment(
    payment_id: UUID,
    body: PaymentCorrection,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_CORRECT)),
    db: AsyncSession = Depends(get_db),
) -> PaymentOut:
    payment = await payments_service.correct_payment(
        db,
        tenant,
        payment_id,
        corrected_amount=body.corrected_amount,
        reason=body.reason,
        correlation_id=_correlation(request),
    )
    return PaymentOut.model_validate(payment)


@router.post("/refunds", response_model=RefundOut, status_code=201)
async def refund(
    body: RefundCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_REFUND)),
    db: AsyncSession = Depends(get_db),
) -> RefundOut:
    refund_row = await payments_service.refund_payment(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return RefundOut.model_validate(refund_row)


@router.get("/ledger/{booking_id}", response_model=LedgerOut)
async def booking_ledger(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> LedgerOut:
    await get_booking(db, tenant, booking_id)  # tenant-scope check
    entries = await ledger_service.list_entries(db, tenant.require_hotel(), booking_id)
    balance = await ledger_service.current_balance(db, tenant.require_hotel(), booking_id)
    return LedgerOut(
        items=[LedgerEntryOut.model_validate(e) for e in entries], balance=balance
    )
