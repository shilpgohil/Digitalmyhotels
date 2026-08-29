from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import GstRates, calculate_gst, money
from app.models.booking import Booking
from app.models.guest import Guest
from app.models.hotel import Hotel, HotelSettings
from app.models.invoice import Invoice, InvoiceItem
from app.models.payment import HotelCharge
from app.models.room import Room
from app.repositories.hotels import get_or_create_gst_settings
from app.services.audit import write_audit
from app.services.bookings import get_booking

INVOICE_LOAD = (selectinload(Invoice.items),)


async def _next_invoice_number(db: AsyncSession, hotel_id: UUID) -> str:
    result = await db.execute(
        select(HotelSettings).where(HotelSettings.hotel_id == hotel_id).with_for_update()
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = HotelSettings(hotel_id=hotel_id)
        db.add(settings)
        await db.flush()
    number = f"{settings.invoice_prefix}-{settings.invoice_next_number:05d}"
    settings.invoice_next_number += 1
    return number


async def generate_invoice(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
    *,
    interstate: bool = False,
    correlation_id: str | None = None,
) -> Invoice:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, booking_id)
    if booking.status not in ("checked_in", "checked_out"):
        raise ValidationAppError(
            "Invoices can only be generated for active or completed stays",
            code="booking_not_invoiceable",
        )

    existing = await db.execute(
        select(Invoice).where(
            Invoice.booking_id == booking.id,
            Invoice.status.notin_(("cancelled",)),
        )
    )
    if existing.scalars().first():
        raise ConflictError(
            "An active invoice already exists for this booking", code="invoice_exists"
        )

    gst = await get_or_create_gst_settings(db, hotel_id)
    rates = GstRates(
        cgst=gst.default_cgst_rate,
        sgst=gst.default_sgst_rate,
        igst=gst.default_igst_rate,
        version=gst.version,
    )

    guest = await db.get(Guest, booking.primary_guest_id) if booking.primary_guest_id else None
    nights = max((booking.check_out_date - booking.check_in_date).days, 1)

    invoice = Invoice(
        hotel_id=hotel_id,
        booking_id=booking.id,
        invoice_number=await _next_invoice_number(db, hotel_id),
        invoice_date=date.today(),
        status="generated",
        guest_name=guest.full_name if guest else "Guest",
        guest_address=guest.address if guest else None,
        subtotal=Decimal("0.00"),
        discount_amount=booking.discount_amount,
        total_amount=Decimal("0.00"),
        created_by_id=tenant.user_id,
    )
    db.add(invoice)
    await db.flush()

    subtotal = Decimal("0.00")
    cgst_total = sgst_total = igst_total = Decimal("0.00")

    # Room line items — one per allocated room (historical rooms included).
    room_ids = [br.room_id for br in booking.rooms if br.is_current]
    rooms_result = await db.execute(select(Room).where(Room.id.in_(room_ids)))
    rooms_by_id = {r.id: r for r in rooms_result.scalars().all()}
    for booking_room in booking.rooms:
        if not booking_room.is_current:
            continue
        room = rooms_by_id.get(booking_room.room_id)
        taxable = money(booking_room.rate * nights)
        breakup = calculate_gst(
            taxable, rates, is_interstate=interstate, is_registered=gst.is_gst_registered
        )
        db.add(
            InvoiceItem(
                hotel_id=hotel_id,
                invoice_id=invoice.id,
                description=(
                    f"Room {room.room_number if room else ''} — {nights} night(s)"
                ),
                quantity=nights,
                rate=booking_room.rate,
                taxable_amount=breakup.taxable_amount,
                tax_amount=breakup.total_tax,
                total_amount=breakup.total_amount,
            )
        )
        subtotal += breakup.taxable_amount
        cgst_total += breakup.cgst_amount
        sgst_total += breakup.sgst_amount
        igst_total += breakup.igst_amount

    # Hotel charges (non-voided) carry their own computed tax.
    charges_result = await db.execute(
        select(HotelCharge).where(
            HotelCharge.booking_id == booking.id, HotelCharge.voided_at.is_(None)
        )
    )
    for charge in charges_result.scalars().all():
        db.add(
            InvoiceItem(
                hotel_id=hotel_id,
                invoice_id=invoice.id,
                description=f"{charge.category}: {charge.description}",
                quantity=charge.quantity,
                rate=charge.rate,
                taxable_amount=charge.taxable_amount,
                tax_amount=charge.tax_amount,
                total_amount=charge.total_amount,
            )
        )
        subtotal += charge.taxable_amount
        # Charge tax was computed with the same engine defaults (intra-state).
        half = money(charge.tax_amount / 2)
        if interstate:
            igst_total += charge.tax_amount
        else:
            cgst_total += half
            sgst_total += money(charge.tax_amount - half)

    total = money(
        subtotal + cgst_total + sgst_total + igst_total - booking.discount_amount
    )
    paid = booking.advance_amount
    due = money(max(total - paid - booking.security_deposit, Decimal("0.00")))

    invoice.subtotal = money(subtotal)
    invoice.cgst_amount = money(cgst_total)
    invoice.sgst_amount = money(sgst_total)
    invoice.igst_amount = money(igst_total)
    invoice.total_amount = total
    invoice.paid_amount = money(paid)
    invoice.due_amount = due
    if due == 0:
        invoice.status = "paid"
    elif paid > 0:
        invoice.status = "partially_paid"

    await db.flush()
    await write_audit(
        db,
        action="invoices.generated",
        entity_type="invoice",
        entity_id=invoice.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "invoice_number": invoice.invoice_number,
            "booking": booking.booking_number,
            "total": str(total),
        },
        correlation_id=correlation_id,
    )
    return await get_invoice(db, tenant, invoice.id)


async def get_invoice(db: AsyncSession, tenant: TenantContext, invoice_id: UUID) -> Invoice:
    result = await db.execute(
        select(Invoice)
        .options(*INVOICE_LOAD)
        .where(Invoice.id == invoice_id, Invoice.hotel_id == tenant.require_hotel())
    )
    invoice = result.scalar_one_or_none()
    if invoice is None:
        raise NotFoundError("Invoice not found")
    return invoice


async def list_invoices(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    status: str | None = None,
    query: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Invoice], int]:
    hotel_id = tenant.require_hotel()
    stmt = select(Invoice).where(Invoice.hotel_id == hotel_id)
    if status:
        stmt = stmt.where(Invoice.status == status)
    if query:
        stmt = stmt.where(Invoice.invoice_number.ilike(f"%{query}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.options(*INVOICE_LOAD)
        .order_by(Invoice.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total


async def cancel_invoice(
    db: AsyncSession,
    tenant: TenantContext,
    invoice_id: UUID,
    reason: str,
    *,
    correlation_id: str | None = None,
) -> Invoice:
    invoice = await get_invoice(db, tenant, invoice_id)
    if invoice.status == "cancelled":
        raise ValidationAppError("Invoice is already cancelled", code="already_cancelled")
    invoice.status = "cancelled"
    invoice.cancelled_at = datetime.now(UTC)
    invoice.cancel_reason = reason
    await write_audit(
        db,
        action="invoices.cancelled",
        entity_type="invoice",
        entity_id=invoice.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        after={"invoice_number": invoice.invoice_number, "reason": reason},
        correlation_id=correlation_id,
    )
    return invoice


async def render_invoice_pdf(
    db: AsyncSession, tenant: TenantContext, invoice_id: UUID
) -> bytes:
    invoice = await get_invoice(db, tenant, invoice_id)
    hotel = await db.get(Hotel, tenant.require_hotel())
    gst = await get_or_create_gst_settings(db, tenant.require_hotel())
    booking = await db.get(Booking, invoice.booking_id)

    from fpdf import FPDF

    def latin1(text: str) -> str:
        # Core PDF fonts are Latin-1 only; degrade unsupported characters.
        return text.encode("latin-1", errors="replace").decode("latin-1")

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Header
    pdf.set_font("helvetica", "B", 16)
    pdf.set_text_color(11, 21, 38)
    pdf.cell(0, 9, latin1(hotel.name if hotel else "Hotel"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(90, 103, 120)
    address_bits = [b for b in [hotel.address_line1, hotel.city, hotel.state] if b] if hotel else []
    if address_bits:
        pdf.cell(0, 5, latin1(", ".join(address_bits)), new_x="LMARGIN", new_y="NEXT")
    if gst.is_gst_registered and gst.gstin:
        pdf.cell(0, 5, f"GSTIN: {gst.gstin}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("helvetica", "B", 13)
    pdf.set_text_color(11, 21, 38)
    title = "TAX INVOICE" if gst.is_gst_registered else "INVOICE"
    if invoice.status == "cancelled":
        title += " (CANCELLED)"
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("helvetica", "", 10)
    pdf.cell(0, 6, f"Invoice No: {invoice.invoice_number}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Date: {invoice.invoice_date.isoformat()}", new_x="LMARGIN", new_y="NEXT")
    if booking:
        pdf.cell(0, 6, f"Booking: {booking.booking_number}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, latin1(f"Guest: {invoice.guest_name}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Items table
    col_widths = (86, 16, 24, 24, 20, 24)
    headers = ("Description", "Qty", "Rate", "Taxable", "Tax", "Total")
    pdf.set_font("helvetica", "B", 9)
    pdf.set_fill_color(11, 21, 38)
    pdf.set_text_color(255, 255, 255)
    for width, header in zip(col_widths, headers, strict=False):
        pdf.cell(width, 7, header, border=1, fill=True, align="C")
    pdf.ln()
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(20, 20, 20)
    for item in invoice.items:
        pdf.cell(col_widths[0], 7, latin1(item.description[:52]), border=1)
        pdf.cell(col_widths[1], 7, str(item.quantity), border=1, align="C")
        pdf.cell(col_widths[2], 7, f"{item.rate}", border=1, align="R")
        pdf.cell(col_widths[3], 7, f"{item.taxable_amount}", border=1, align="R")
        pdf.cell(col_widths[4], 7, f"{item.tax_amount}", border=1, align="R")
        pdf.cell(col_widths[5], 7, f"{item.total_amount}", border=1, align="R")
        pdf.ln()

    pdf.ln(3)

    def summary_row(label: str, value: str, *, bold: bool = False) -> None:
        pdf.set_font("helvetica", "B" if bold else "", 10)
        pdf.cell(140, 6, label, align="R")
        pdf.cell(50, 6, value, align="R", new_x="LMARGIN", new_y="NEXT")

    summary_row("Subtotal", f"{invoice.subtotal}")
    if invoice.discount_amount > 0:
        summary_row("Discount", f"-{invoice.discount_amount}")
    if invoice.cgst_amount > 0:
        summary_row("CGST", f"{invoice.cgst_amount}")
        summary_row("SGST", f"{invoice.sgst_amount}")
    if invoice.igst_amount > 0:
        summary_row("IGST", f"{invoice.igst_amount}")
    summary_row("Total", f"INR {invoice.total_amount}", bold=True)
    summary_row("Paid", f"{invoice.paid_amount}")
    summary_row("Due", f"{invoice.due_amount}", bold=True)

    return bytes(pdf.output())
