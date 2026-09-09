from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.models.ops import ShiftHandover
from app.schemas.ops import (
    DailyClosingClose,
    DailyClosingOut,
    DailyClosingReopen,
    ShiftHandoverCreate,
    ShiftHandoverOut,
)
from app.services import ops as ops_service

router = APIRouter(prefix="/ops", tags=["operations"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


def _closing_out(row: object) -> DailyClosingOut:
    """Serialize a closing row, including live backdated-payment stats."""
    out = DailyClosingOut.model_validate(row)
    return out.model_copy(
        update={
            "backdated_payments_count": int(
                getattr(row, "backdated_payments_count", 0) or 0
            ),
            "backdated_payments_amount": getattr(
                row, "backdated_payments_amount", 0
            )
            or 0,
        }
    )


def _handover_out(row: ShiftHandover) -> ShiftHandoverOut:
    """Serialize a handover, surfacing the free-text `to_name` stored in snapshot."""
    out = ShiftHandoverOut.model_validate(row)
    snapshot = row.snapshot or {}
    out.to_name = snapshot.get("to_name")
    return out


@router.get("/daily-closing", response_model=list[DailyClosingOut])
async def list_closings(
    tenant: TenantContext = Depends(require_permissions(Permission.DAILY_CLOSING)),
    db: AsyncSession = Depends(get_db),
) -> list[DailyClosingOut]:
    items = await ops_service.list_closings(db, tenant)
    return [_closing_out(i) for i in items]


@router.get("/daily-closing/today", response_model=DailyClosingOut)
async def today_closing(
    business_date: date | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.DAILY_CLOSING)),
    db: AsyncSession = Depends(get_db),
) -> DailyClosingOut:
    row = await ops_service.get_or_open_day(db, tenant, business_date)
    return _closing_out(row)


@router.post("/daily-closing/close", response_model=DailyClosingOut)
async def close_day(
    body: DailyClosingClose,
    request: Request,
    business_date: date | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.DAILY_CLOSING)),
    db: AsyncSession = Depends(get_db),
) -> DailyClosingOut:
    row = await ops_service.close_day(
        db, tenant, business_date or date.today(), body, correlation_id=_correlation(request)
    )
    return _closing_out(row)


@router.post("/daily-closing/{closing_id}/reopen", response_model=DailyClosingOut)
async def reopen_day(
    closing_id: UUID,
    body: DailyClosingReopen,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.DAILY_CLOSING)),
    db: AsyncSession = Depends(get_db),
) -> DailyClosingOut:
    row = await ops_service.reopen_day(
        db, tenant, closing_id, body, correlation_id=_correlation(request)
    )
    return _closing_out(row)


@router.get("/shift-handover", response_model=list[ShiftHandoverOut])
async def list_handovers(
    tenant: TenantContext = Depends(require_permissions(Permission.SHIFT_HANDOVER)),
    db: AsyncSession = Depends(get_db),
) -> list[ShiftHandoverOut]:
    items = await ops_service.list_handovers(db, tenant)
    return [_handover_out(i) for i in items]


@router.post("/shift-handover", response_model=ShiftHandoverOut, status_code=201)
async def create_handover(
    body: ShiftHandoverCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.SHIFT_HANDOVER)),
    db: AsyncSession = Depends(get_db),
) -> ShiftHandoverOut:
    row = await ops_service.create_handover(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return _handover_out(row)


@router.post("/shift-handover/{handover_id}/confirm", response_model=ShiftHandoverOut)
async def confirm_handover(
    handover_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.SHIFT_HANDOVER)),
    db: AsyncSession = Depends(get_db),
) -> ShiftHandoverOut:
    row = await ops_service.confirm_handover(
        db, tenant, handover_id, correlation_id=_correlation(request)
    )
    return _handover_out(row)
