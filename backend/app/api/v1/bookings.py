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


@router.get("/{booking_id}/guests")
async def list_booking_guests(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    """All registered guests for a booking, with their ID documents.

    Powers the Completed Bookings view drawer (client: show full guest details
    including Aadhaar/ID images + selfie). Document binaries are fetched via the
    existing GET /guests/{gid}/documents/{doc_id}/file endpoint.
    """
    from sqlalchemy import select as _select

    from app.models.guest import Guest, GuestDocument, GuestRegistration
    from app.schemas.booking import BookingGuestDocOut, BookingGuestOut

    booking = await bookings_service.get_booking(db, tenant, booking_id)
    regs_result = await db.execute(
        _select(GuestRegistration, Guest)
        .join(Guest, Guest.id == GuestRegistration.guest_id)
        .where(
            GuestRegistration.booking_id == booking.id,
            GuestRegistration.hotel_id == booking.hotel_id,
        )
        .order_by(GuestRegistration.is_primary.desc(), GuestRegistration.created_at)
    )
    rows = regs_result.all()
    guest_ids = [g.id for _, g in rows]
    docs_by_guest: dict[UUID, list[GuestDocument]] = {}
    if guest_ids:
        docs_result = await db.execute(
            _select(GuestDocument).where(
                GuestDocument.guest_id.in_(guest_ids),
                GuestDocument.hotel_id == booking.hotel_id,
            )
        )
        for doc in docs_result.scalars():
            docs_by_guest.setdefault(doc.guest_id, []).append(doc)

    def _mask(phone: str | None) -> str:
        if not phone or len(phone) < 4:
            return ""
        return f"••••••{phone[-4:]}"

    return [
        BookingGuestOut(
            guest_id=guest.id,
            full_name=guest.full_name,
            phone_masked=_mask(guest.normalized_phone),
            phone=guest.normalized_phone,
            address=guest.address,
            is_primary=reg.is_primary,
            registration_number=reg.registration_number,
            purpose_of_visit=reg.purpose_of_visit,
            company_name=reg.company_name,
            id_proof_type=guest.id_proof_type,
            documents=[
                BookingGuestDocOut(
                    id=d.id, document_type=d.document_type, side=d.side
                )
                for d in docs_by_guest.get(guest.id, [])
            ],
        )
        for reg, guest in rows
    ]


@router.get("/{booking_id}/foreign-guests")
async def list_foreign_guest_details(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    """Form C records captured at check-in for foreign nationals on this booking."""
    from sqlalchemy import select

    from app.models.guest import ForeignGuestDetail
    from app.schemas.stay import ForeignGuestOut

    booking = await bookings_service.get_booking(db, tenant, booking_id)
    result = await db.execute(
        select(ForeignGuestDetail).where(
            ForeignGuestDetail.booking_id == booking.id,
            ForeignGuestDetail.hotel_id == booking.hotel_id,
        )
    )
    return [ForeignGuestOut.model_validate(r, from_attributes=True) for r in result.scalars()]


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
