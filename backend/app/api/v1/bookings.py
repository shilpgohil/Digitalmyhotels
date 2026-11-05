from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.booking import (
    BookingAddRoomRequest,
    BookingCancel,
    BookingCreate,
    BookingListOut,
    BookingOut,
    BookingRoomReplaceRequest,
    BookingUpdate,
    PublicStaySlipOut,
    PublicVoucherOut,
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


@router.get("/export.csv")
async def export_bookings_csv(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    csv_content = await bookings_service.export_bookings_csv(
        db,
        tenant,
        status=status,
        query=q,
        from_date=from_date,
        to_date=to_date,
    )
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="completed-bookings.csv"'},
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
            city=guest.city,
            state=guest.state,
            country=guest.country,
            is_primary=reg.is_primary,
            registration_number=reg.registration_number,
            purpose_of_visit=reg.purpose_of_visit,
            company_name=reg.company_name,
            alternate_contact_phone=reg.alternate_contact_phone,
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


@router.post("/{booking_id}/replace-room", response_model=BookingOut)
async def replace_booking_room(
    booking_id: UUID,
    body: BookingRoomReplaceRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    """Swap one allocated room BEFORE check-in — availability-aware and atomic.

    In-house stays use POST /room-transfers instead (separate lifecycle).
    """
    booking = await bookings_service.replace_booking_room(
        db,
        tenant,
        booking_id,
        from_room_id=body.from_room_id,
        to_room_id=body.to_room_id,
        reason=body.reason,
        correlation_id=_correlation(request),
    )
    return await bookings_service.to_out(db, booking)


@router.post("/{booking_id}/add-room", response_model=BookingOut)
async def add_room_to_booking(
    booking_id: UUID,
    body: BookingAddRoomRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> BookingOut:
    """Add an extra room to a confirmed advance booking before check-in.

    Allows staff to accommodate guests who want more rooms than originally
    booked. Priced at the room type's default rate — the booking total and
    ledger are updated atomically.
    """
    booking = await bookings_service.add_room_to_booking(
        db,
        tenant,
        booking_id,
        new_room_id=body.room_id,
        correlation_id=_correlation(request),
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


@router.get("/{booking_id}/voucher/pdf")
async def booking_voucher_pdf(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    pdf = await bookings_service.render_booking_voucher_pdf(db, tenant, booking_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="voucher-{booking_id}.pdf"'},
    )


@router.get("/{booking_id}/registration/pdf")
async def booking_registration_pdf(
    booking_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.BOOKINGS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    pdf = await bookings_service.render_registration_slip_pdf(db, tenant, booking_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="stay-slip-{booking_id}.pdf"'},
    )


@router.get("/public/{booking_id}/voucher")
async def public_booking_voucher_detail(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> PublicVoucherOut:
    """Public read-only advance booking voucher details for customer preview."""
    from sqlalchemy import select

    from app.core.errors import NotFoundError
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.room import Room

    booking = await db.get(Booking, booking_id)
    if not booking:
        raise NotFoundError("Booking not found", code="booking_not_found")

    hotel = await db.get(Hotel, booking.hotel_id)
    hotel_name = hotel.name if hotel else "Hotel"
    hotel_addr = (
        ", ".join(
            filter(
                None,
                [
                    hotel.address_line1 if hotel else "",
                    hotel.city if hotel else "",
                    hotel.state if hotel else "",
                ],
            )
        )
        if hotel
        else None
    )
    hotel_phone = hotel.phone if hotel else None
    hotel_gstin: str | None = None

    guest_name = "Guest"
    guest_phone = None
    if booking.primary_guest_id:
        guest = await db.get(Guest, booking.primary_guest_id)
        if guest:
            guest_name = guest.full_name
            guest_phone = guest.normalized_phone

    room_rows = (
        await db.execute(
            select(Room.room_number)
            .join(BookingRoom, BookingRoom.room_id == Room.id)
            .where(
                BookingRoom.booking_id == booking.id,
                BookingRoom.is_current.is_(True),
            )
            .order_by(Room.room_number)
        )
    ).scalars().all()
    room_str = ", ".join(room_rows) if room_rows else "Assigned at check-in"

    nights = None
    if booking.check_in_date and booking.check_out_date:
        nights = max(1, (booking.check_out_date - booking.check_in_date).days)

    return PublicVoucherOut(
        id=booking.id,
        voucher_number=f"VCH-{booking.booking_number}",
        booking_number=booking.booking_number,
        status=booking.status,
        guest_name=guest_name,
        guest_phone=guest_phone,
        hotel_name=hotel_name,
        hotel_address=hotel_addr,
        hotel_phone=hotel_phone,
        hotel_gstin=hotel_gstin,
        room_numbers_or_type=room_str,
        check_in_date=booking.check_in_date,
        check_in_time=booking.check_in_time,
        check_out_date=booking.check_out_date,
        check_out_time=booking.check_out_time,
        nights=nights,
        adults=booking.adults,
        children=booking.children,
        total_estimated_tariff=booking.total_amount,
        advance_paid=booking.advance_amount,
        balance_due=booking.due_amount,
        payment_method=booking.payment_status,
        pdf_url=f"/api/v1/bookings/public/{booking.id}/voucher/pdf",
    )


@router.get("/public/{booking_id}/registration")
async def public_booking_registration_detail(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> PublicStaySlipOut:
    """Public read-only in-stay registration & stay slip details for customer preview."""
    from sqlalchemy import select

    from app.core.errors import NotFoundError
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.room import Room

    booking = await db.get(Booking, booking_id)
    if not booking:
        raise NotFoundError("Booking not found", code="booking_not_found")

    hotel = await db.get(Hotel, booking.hotel_id)
    hotel_name = hotel.name if hotel else "Hotel"
    hotel_addr = (
        ", ".join(
            filter(
                None,
                [
                    hotel.address_line1 if hotel else "",
                    hotel.city if hotel else "",
                    hotel.state if hotel else "",
                ],
            )
        )
        if hotel
        else None
    )
    hotel_phone = hotel.phone if hotel else None
    hotel_gstin: str | None = None

    guest_name = "Guest"
    guest_phone = None
    if booking.primary_guest_id:
        guest = await db.get(Guest, booking.primary_guest_id)
        if guest:
            guest_name = guest.full_name
            guest_phone = guest.normalized_phone

    room_rows = (
        await db.execute(
            select(Room.room_number)
            .join(BookingRoom, BookingRoom.room_id == Room.id)
            .where(
                BookingRoom.booking_id == booking.id,
                BookingRoom.is_current.is_(True),
            )
            .order_by(Room.room_number)
        )
    ).scalars().all()
    room_str = ", ".join(room_rows) if room_rows else "—"

    return PublicStaySlipOut(
        id=booking.id,
        booking_number=booking.booking_number,
        guest_name=guest_name,
        guest_phone=guest_phone,
        hotel_name=hotel_name,
        hotel_address=hotel_addr,
        hotel_phone=hotel_phone,
        hotel_gstin=hotel_gstin,
        room_numbers=room_str,
        check_in_date=str(booking.check_in_date) if booking.check_in_date else None,
        check_in_time=booking.check_in_time,
        check_out_date=str(booking.check_out_date) if booking.check_out_date else None,
        check_out_time=booking.check_out_time,
        guest_count=booking.adults + booking.children,
        due_amount=booking.due_amount,
        payment_status=booking.payment_status,
        pdf_url=f"/api/v1/bookings/public/{booking.id}/registration/pdf",
    )


@router.get("/public/{booking_id}/voucher/pdf")
async def public_booking_voucher_pdf(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Public read-only booking voucher PDF for direct customer download via WhatsApp."""
    from app.core.errors import NotFoundError
    from app.core.permissions import RoleCode
    from app.models.booking import Booking

    booking = await db.get(Booking, booking_id)
    if not booking:
        raise NotFoundError("Booking not found", code="booking_not_found")
    tenant = TenantContext(
        user_id=booking.hotel_id,
        hotel_id=booking.hotel_id,
        role=RoleCode.OWNER,
        is_super_admin=False,
    )
    pdf = await bookings_service.render_booking_voucher_pdf(db, tenant, booking_id)
    bn = booking.booking_number
    fname = f"voucher-{bn}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


@router.get("/public/{booking_id}/registration/pdf")
async def public_booking_registration_pdf(
    booking_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Public read-only guest stay registration card PDF for direct customer download."""
    from app.core.errors import NotFoundError
    from app.core.permissions import RoleCode
    from app.models.booking import Booking

    booking = await db.get(Booking, booking_id)
    if not booking:
        raise NotFoundError("Booking not found", code="booking_not_found")
    tenant = TenantContext(
        user_id=booking.hotel_id,
        hotel_id=booking.hotel_id,
        role=RoleCode.OWNER,
        is_super_admin=False,
    )
    pdf = await bookings_service.render_registration_slip_pdf(db, tenant, booking_id)
    bn = booking.booking_number
    fname = f"stay-slip-{bn}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )
