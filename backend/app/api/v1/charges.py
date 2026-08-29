from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.payment import ChargeCreate, ChargeListOut, ChargeOut
from app.services import charges as charges_service

router = APIRouter(prefix="/charges", tags=["charges"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("", response_model=ChargeListOut)
async def list_charges(
    booking_id: UUID = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> ChargeListOut:
    items = await charges_service.list_charges(db, tenant, booking_id)
    return ChargeListOut(items=[ChargeOut.model_validate(c) for c in items], total=len(items))


@router.post("", response_model=ChargeOut, status_code=201)
async def add_charge(
    body: ChargeCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_COLLECT)),
    db: AsyncSession = Depends(get_db),
) -> ChargeOut:
    charge = await charges_service.add_charge(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return ChargeOut.model_validate(charge)


@router.post("/{charge_id}/void", response_model=ChargeOut)
async def void_charge(
    charge_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.PAYMENTS_CORRECT)),
    db: AsyncSession = Depends(get_db),
) -> ChargeOut:
    charge = await charges_service.void_charge(
        db, tenant, charge_id, correlation_id=_correlation(request)
    )
    return ChargeOut.model_validate(charge)
