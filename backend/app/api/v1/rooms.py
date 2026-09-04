from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.room import (
    RoomAvailabilityOut,
    RoomCreate,
    RoomListOut,
    RoomOut,
    RoomStatusSummaryOut,
    RoomStatusUpdate,
    RoomTypeCreate,
    RoomTypeListOut,
    RoomTypeOut,
    RoomTypeUpdate,
    RoomUpdate,
)
from app.services import rooms as rooms_service

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


# --- Room types (place before /{room_id} routes) --------------------------------


@router.get("/types", response_model=RoomTypeListOut)
async def list_room_types(
    include_inactive: bool = Query(default=False),
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RoomTypeListOut:
    items, total = await rooms_service.list_room_types(
        db, tenant, include_inactive=include_inactive
    )
    return RoomTypeListOut(
        items=[RoomTypeOut.model_validate(i) for i in items], total=total
    )


@router.post("/types", response_model=RoomTypeOut, status_code=201)
async def create_room_type(
    body: RoomTypeCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> RoomTypeOut:
    room_type = await rooms_service.create_room_type(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return RoomTypeOut.model_validate(room_type)


@router.patch("/types/{type_id}", response_model=RoomTypeOut)
async def update_room_type(
    type_id: UUID,
    body: RoomTypeUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> RoomTypeOut:
    room_type = await rooms_service.update_room_type(
        db, tenant, type_id, body, correlation_id=_correlation(request)
    )
    return RoomTypeOut.model_validate(room_type)


# --- Rooms ----------------------------------------------------------------------


@router.get("", response_model=RoomListOut)
async def list_rooms(
    status: str | None = Query(default=None),
    room_type_id: UUID | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RoomListOut:
    items, total = await rooms_service.list_rooms(
        db,
        tenant,
        status=status,
        room_type_id=room_type_id,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    return RoomListOut(items=items, total=total)


@router.get("/availability", response_model=RoomAvailabilityOut)
async def room_availability(
    check_in: date = Query(..., description="Check-in date (YYYY-MM-DD)"),
    check_out: date = Query(..., description="Check-out date (YYYY-MM-DD)"),
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RoomAvailabilityOut:
    """Return rooms split into available vs unavailable for the requested date window.

    Unavailable rooms include: overlapping bookings (with `occupied_until` = free date),
    maintenance, cleaning, and out-of-service rooms — sorted by earliest free date
    so the UI can show the best alternative suggestions first.
    """
    from datetime import UTC
    from datetime import datetime as _dt

    from app.core.errors import ValidationAppError

    # Same-day (check_out == check_in) is allowed: day-use bookings query
    # availability for a single calendar day.
    if check_out < check_in:
        raise ValidationAppError(
            "Check-out date must be on or after check-in date",
            code="invalid_dates",
        )
    # Use UTC date for comparison so availability can be queried for "today"
    # across all timezones without being rejected as "past".
    today_utc = _dt.now(UTC).date()
    if check_in < today_utc:
        raise ValidationAppError(
            "Check-in date cannot be in the past",
            code="checkin_date_past",
        )
    return await rooms_service.check_availability(db, tenant, check_in, check_out)


@router.get("/status-summary", response_model=RoomStatusSummaryOut)
async def room_status_summary(
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RoomStatusSummaryOut:
    counts = await rooms_service.status_summary(db, tenant)
    return RoomStatusSummaryOut(total=sum(counts.values()), counts=counts)


@router.post("", response_model=RoomOut, status_code=201)
async def create_room(
    body: RoomCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> RoomOut:
    return await rooms_service.create_room(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(
    room_id: UUID,
    body: RoomUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> RoomOut:
    return await rooms_service.update_room(
        db, tenant, room_id, body, correlation_id=_correlation(request)
    )


@router.put("/{room_id}/status", response_model=RoomOut)
async def update_room_status(
    room_id: UUID,
    body: RoomStatusUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.ROOMS_UPDATE_STATUS)),
    db: AsyncSession = Depends(get_db),
) -> RoomOut:
    return await rooms_service.update_room_status(
        db, tenant, room_id, body, correlation_id=_correlation(request)
    )
