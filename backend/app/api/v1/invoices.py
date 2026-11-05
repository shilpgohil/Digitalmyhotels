from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.invoice import (
    InvoiceCancelRequest,
    InvoiceGenerateRequest,
    InvoiceListOut,
    InvoiceOut,
    PublicInvoiceOut,
)
from app.services import invoices as invoices_service

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("")
async def list_invoices(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    booking_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceListOut:
    items, total = await invoices_service.list_invoices(
        db, tenant, status=status, query=q, booking_id=booking_id, limit=limit, offset=offset
    )
    return InvoiceListOut(
        items=[
            InvoiceOut.model_validate(row["invoice"]).model_copy(
                update={
                    "booking_number": row.get("booking_number"),
                    "guest_phone": row.get("guest_phone"),
                }
            )
            for row in items
        ],
        total=total,
    )


@router.post("", status_code=201)
async def generate_invoice(
    body: InvoiceGenerateRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    invoice = await invoices_service.generate_invoice(
        db,
        tenant,
        body.booking_id,
        interstate=body.interstate,
        correlation_id=_correlation(request),
    )
    return InvoiceOut.model_validate(invoice)


@router.get("/{invoice_id}")
async def get_invoice(
    invoice_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    from sqlalchemy import select

    from app.models.booking import Booking as _Booking
    from app.models.guest import Guest as _Guest

    invoice = await invoices_service.get_invoice(db, tenant, invoice_id)
    out = InvoiceOut.model_validate(invoice)
    if invoice.booking_id:
        row = (
            await db.execute(
                select(_Booking.booking_number, _Guest.normalized_phone)
                .outerjoin(_Guest, _Guest.id == _Booking.primary_guest_id)
                .where(_Booking.id == invoice.booking_id)
            )
        ).first()
        if row:
            out = out.model_copy(
                update={"booking_number": row[0], "guest_phone": row[1]}
            )
    return out


@router.get("/{invoice_id}/pdf")
async def invoice_pdf(
    invoice_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    pdf = await invoices_service.render_invoice_pdf(db, tenant, invoice_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="invoice-{invoice_id}.pdf"'},
    )


@router.get("/public/{invoice_id}")
async def public_invoice_detail(
    invoice_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> PublicInvoiceOut:
    """Public read-only invoice details for customer viewing & 1-click PDF download."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.core.errors import NotFoundError
    from app.models.booking import Booking, BookingRoom
    from app.models.guest import Guest
    from app.models.hotel import Hotel
    from app.models.invoice import Invoice
    from app.models.room import Room
    from app.schemas.invoice import InvoiceItemOut

    stmt = select(Invoice).options(selectinload(Invoice.items)).where(Invoice.id == invoice_id)
    res = await db.execute(stmt)
    invoice = res.scalar_one_or_none()
    if not invoice:
        raise NotFoundError("Invoice not found", code="invoice_not_found")

    hotel = await db.get(Hotel, invoice.hotel_id)
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
    from app.models.invoice import GstSettings

    gst = await db.scalar(select(GstSettings).where(GstSettings.hotel_id == invoice.hotel_id))
    hotel_gstin = gst.gstin if gst and gst.is_gst_registered else None

    booking_num: str | None = None
    guest_phone: str | None = None
    room_numbers: str | None = None
    check_in_date = None
    check_in_time = None
    check_out_date = None
    check_out_time = None
    nights: int | None = None

    if invoice.booking_id:
        booking = await db.get(Booking, invoice.booking_id)
        if booking:
            booking_num = booking.booking_number
            check_in_date = booking.check_in_date
            check_in_time = booking.check_in_time
            check_out_date = booking.check_out_date
            check_out_time = booking.check_out_time
            if check_in_date and check_out_date:
                nights = max(1, (check_out_date - check_in_date).days)
            if booking.primary_guest_id:
                guest = await db.get(Guest, booking.primary_guest_id)
                if guest:
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
            if room_rows:
                room_numbers = ", ".join(room_rows)

    return PublicInvoiceOut(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        invoice_date=invoice.invoice_date,
        status=invoice.status,
        booking_number=booking_num,
        guest_name=invoice.guest_name,
        guest_address=invoice.guest_address,
        guest_phone=guest_phone,
        hotel_name=hotel_name,
        hotel_address=hotel_addr,
        hotel_phone=hotel_phone,
        hotel_gstin=hotel_gstin,
        room_numbers=room_numbers,
        check_in_date=check_in_date,
        check_in_time=check_in_time,
        check_out_date=check_out_date,
        check_out_time=check_out_time,
        nights=nights,
        subtotal=invoice.subtotal,
        discount_amount=invoice.discount_amount,
        cgst_amount=invoice.cgst_amount,
        sgst_amount=invoice.sgst_amount,
        igst_amount=invoice.igst_amount,
        total_amount=invoice.total_amount,
        paid_amount=invoice.paid_amount,
        due_amount=invoice.due_amount,
        items=[InvoiceItemOut.model_validate(it) for it in invoice.items],
        pdf_url=f"/api/v1/invoices/public/{invoice.id}/pdf",
    )


@router.get("/public/{invoice_id}/pdf")
async def public_invoice_pdf(
    invoice_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Public read-only invoice PDF for direct customer download via WhatsApp/SMS."""
    from app.core.errors import NotFoundError
    from app.core.permissions import RoleCode
    from app.models.invoice import Invoice

    invoice = await db.get(Invoice, invoice_id)
    if not invoice:
        raise NotFoundError("Invoice not found", code="invoice_not_found")
    tenant = TenantContext(
        user_id=invoice.created_by_id or invoice.hotel_id,
        hotel_id=invoice.hotel_id,
        role=RoleCode.OWNER,
        is_super_admin=False,
    )
    pdf = await invoices_service.render_invoice_pdf(db, tenant, invoice_id)
    fname = f"invoice-{invoice.invoice_number}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


@router.post("/{invoice_id}/email")
async def email_invoice(
    invoice_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Email the invoice PDF to the guest's email address."""
    to = await invoices_service.email_invoice(
        db, tenant, invoice_id, correlation_id=_correlation(request)
    )
    return {"message": f"Invoice sent to {to}", "to": to}


@router.post("/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: UUID,
    body: InvoiceCancelRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    invoice = await invoices_service.cancel_invoice(
        db, tenant, invoice_id, body.reason, correlation_id=_correlation(request)
    )
    return InvoiceOut.model_validate(invoice)
