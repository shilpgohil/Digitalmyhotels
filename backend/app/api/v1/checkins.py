from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.stay import (
    BookAndCheckInRequest,
    CheckInOut,
    CheckInRequest,
    CurrentGuestsListOut,
    RoomTransferOut,
    RoomTransferRequest,
)
from app.services import stay as stay_service

router = APIRouter(tags=["stay"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.post("/checkins", response_model=CheckInOut, status_code=201)
async def check_in(
    body: CheckInRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.CHECKIN)),
    db: AsyncSession = Depends(get_db),
) -> CheckInOut:
    return await stay_service.check_in(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.post("/checkins/book-and-checkin", response_model=CheckInOut, status_code=201)
async def book_and_check_in(
    body: BookAndCheckInRequest,
    request: Request,
    tenant: TenantContext = Depends(
        require_permissions(Permission.BOOKINGS_MANAGE, Permission.CHECKIN)
    ),
    db: AsyncSession = Depends(get_db),
) -> CheckInOut:
    """Unified walk-in flow: booking + check-in in one atomic transaction."""
    return await stay_service.book_and_check_in(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.get("/current-guests", response_model=CurrentGuestsListOut)
async def current_guests(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> CurrentGuestsListOut:
    items, total = await stay_service.list_current_guests(
        db, tenant, query=q, limit=limit, offset=offset
    )
    return CurrentGuestsListOut(items=items, total=total)


@router.post("/room-transfers", response_model=RoomTransferOut, status_code=201)
async def transfer_room(
    body: RoomTransferRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOM_TRANSFER)),
    db: AsyncSession = Depends(get_db),
) -> RoomTransferOut:
    return await stay_service.transfer_room(
        db, tenant, body, correlation_id=_correlation(request)
    )
