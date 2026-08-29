from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.booking import (
    BookingCancel,
    BookingCreate,
    BookingListOut,
    BookingOut,
    BookingUpdate,
)
from app.services import bookings as bookings_service

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("", response_model=BookingListOut)
async def list_bookings(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> BookingListOut:
    items, total = await bookings_service.list_bookings(
        db,
        tenant,
        status=status,
        query=q,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset,
    )
    return BookingListOut(
        items=await bookings_service.to_out_many(db, items), total=total
    )


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    booking = await bookings_service.get_booking(db, tenant, booking_id)
    return await bookings_service.to_out(db, booking)


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking(
    body: BookingCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    booking = await bookings_service.create_booking(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return await bookings_service.to_out(db, booking)


@router.patch("/{booking_id}", response_model=BookingOut)
async def update_booking(
    booking_id: UUID,
    body: BookingUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    booking = await bookings_service.update_booking(
        db, tenant, booking_id, body, correlation_id=_correlation(request)
    )
    return await bookings_service.to_out(db, booking)


@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel_booking(
    booking_id: UUID,
    body: BookingCancel,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    booking = await bookings_service.cancel_booking(
        db, tenant, booking_id, body.reason, correlation_id=_correlation(request)
    )
    return await bookings_service.to_out(db, booking)


@router.post("/{booking_id}/no-show", response_model=BookingOut)
async def mark_no_show(
    booking_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    booking = await bookings_service.mark_no_show(
        db, tenant, booking_id, correlation_id=_correlation(request)
    )
    return await bookings_service.to_out(db, booking)
