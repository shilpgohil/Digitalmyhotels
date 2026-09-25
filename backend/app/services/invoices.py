from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import GstRates, calculate_gst, money
from app.models.booking import Booking
from app.models.guest import Guest
from app.models.hotel import Hotel, HotelSettings
from app.models.invoice import Invoice, InvoiceItem
from app.models.payment import HotelCharge
from app.models.room import Room
from app.repositories.hotels import get_gst_context
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
    from app.services.subscriptions import assert_transactions_allowed as _ata

    await _ata(db, hotel_id)
    booking = await get_booking(db, tenant, booking_id)
    if booking.status not in ("checked_in", "checked_out"):
        raise ValidationAppError(
            "Invoices can only be generated for active or completed stays",
            code="booking_not_invoiceable",
        )

    existing = await db.execute(
        select(Invoice).where(
            Invoice.booking_id == booking.id,
            Invoice.hotel_id == booking.hotel_id,
            Invoice.status.notin_(("cancelled",)),
        )
    )
    existing_invoice = existing.scalars().first()
    if existing_invoice:
        # Return the existing invoice instead of 409 — idempotent behaviour
        # prevents "Invoice generation error" when clicking the button a
        # second time (e.g. after checkout auto-generated one).
        await db.refresh(existing_invoice, ["items"])
        return existing_invoice

    gst, gst_registered, gst_inclusive = await get_gst_context(db, hotel_id)
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
        # inclusive ("GST Included by Hotel"): rate is the gross customer
        # price; GST is extracted inside it, so the total never changes.
        breakup = calculate_gst(
            taxable,
            rates,
            is_interstate=interstate,
            is_registered=gst_registered,
            inclusive=gst_inclusive,
        )
        db.add(
            InvoiceItem(
                hotel_id=hotel_id,
                invoice_id=invoice.id,
                description=(
                    # Use ASCII dash (safe for PDF latin-1 encoding; em/en dashes
                    # can render as "?" in some PDF viewers via FPDF latin-1 codec).
                    f"Room {room.room_number if room else ''} - "
                    + (
                        "Day use"
                        + (
                            f" ({booking.check_in_time}-{booking.check_out_time})"
                            if booking.check_in_time and booking.check_out_time
                            else ""
                        )
                        if booking.check_in_date == booking.check_out_date
                        else f"{nights} night(s)"
                    )
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
                # First letter capital (client 09/2026 common change).
                description=f"{charge.category.capitalize()}: {charge.description}",
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

    # Late checkout fee — if the booking has a checkout record with a late fee,
    # add it as a separate non-taxable line item so the invoice total matches
    # the amount the guest was actually charged at checkout.
    from app.models.booking import CheckOut  # local import to avoid circular
    checkout_result = await db.execute(
        select(CheckOut).where(
            CheckOut.booking_id == booking.id,
            CheckOut.hotel_id == hotel_id,
            CheckOut.is_reversed.is_(False),
        ).order_by(CheckOut.created_at.desc()).limit(1)
    )
    checkout_record = checkout_result.scalar_one_or_none()
    late_fee = (
        checkout_record.late_fee
        if checkout_record and checkout_record.late_fee > 0
        else Decimal("0.00")
    )
    if late_fee > 0:
        db.add(
            InvoiceItem(
                hotel_id=hotel_id,
                invoice_id=invoice.id,
                description="Late checkout fee",
                quantity=1,
                rate=late_fee,
                taxable_amount=late_fee,
                tax_amount=Decimal("0.00"),
                total_amount=late_fee,
            )
        )
        subtotal += late_fee

    total = money(
        subtotal + cgst_total + sgst_total + igst_total - booking.discount_amount
    )
    # Checkout now computes final_total with the SAME engine (rooms×GST +
    # charges + late fee − discount), so the invoice total and the checkout
    # settlement agree by construction. Due is simply total − paid − deposit.
    paid_amount = booking.advance_amount
    security = booking.security_deposit
    due = money(max(total - paid_amount - security, Decimal("0.00")))

    invoice.subtotal = money(subtotal)
    invoice.cgst_amount = money(cgst_total)
    invoice.sgst_amount = money(sgst_total)
    invoice.igst_amount = money(igst_total)
    invoice.total_amount = total
    invoice.paid_amount = paid_amount
    invoice.due_amount = due
    if due == 0:
        invoice.status = "paid"
    elif paid_amount > 0:
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
    booking_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Returns (items_as_dicts_with_booking_number, total).

    dict contains the Invoice ORM object + booking_number so the API can
    construct InvoiceOut(booking_number=...) without a second query round-trip
    (ss12: "Invoice ID wrong" — staff need to see BH-0013 next to INV-00013).
    """
    from app.models.booking import Booking as _Booking

    hotel_id = tenant.require_hotel()
    stmt = select(Invoice).where(Invoice.hotel_id == hotel_id)
    if status:
        stmt = stmt.where(Invoice.status == status)
    if booking_id:
        stmt = stmt.where(Invoice.booking_id == booking_id)
    if query:
        stmt = stmt.where(Invoice.invoice_number.ilike(f"%{query}%"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.options(*INVOICE_LOAD)
        .order_by(Invoice.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    invoices = list(result.scalars().all())

    # Batch-fetch booking numbers for all invoices in one query.
    booking_ids = [inv.booking_id for inv in invoices if inv.booking_id]
    booking_num_map: dict = {}
    if booking_ids:
        rows = (
            await db.execute(
                select(_Booking.id, _Booking.booking_number).where(
                    _Booking.id.in_(booking_ids)
                )
            )
        ).all()
        booking_num_map = {row[0]: row[1] for row in rows}

    return [
        {"invoice": inv, "booking_number": booking_num_map.get(inv.booking_id)}
        for inv in invoices
    ], total


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
    """Render the ONE proper invoice design (matches the /invoices preview card):
    navy header band, Billed To / Stay Details columns, Description|Amount
    items, and Subtotal / GST / Advance Paid / TOTAL DUE summary.
    """
    invoice = await get_invoice(db, tenant, invoice_id)
    hotel = await db.get(Hotel, tenant.require_hotel())
    gst, gst_registered, gst_inclusive = await get_gst_context(
        db, tenant.require_hotel()
    )
    booking = await db.get(Booking, invoice.booking_id)

    # Current rooms (number + type) and guest phone for the Stay/Billed blocks.
    from app.models.booking import BookingRoom

    rooms_label = ""
    guest_phone = ""
    if booking:
        room_rows = (
            (
                await db.execute(
                    select(Room.room_number)
                    .join(BookingRoom, BookingRoom.room_id == Room.id)
                    .where(
                        BookingRoom.booking_id == booking.id,
                        BookingRoom.is_current.is_(True),
                    )
                    .order_by(Room.room_number)
                )
            )
            .scalars()
            .all()
        )
        rooms_label = ", ".join(room_rows)
        if booking.primary_guest_id:
            guest = await db.get(Guest, booking.primary_guest_id)
            guest_phone = guest.normalized_phone if guest else ""

    from fpdf import FPDF

    def latin1(text: str) -> str:
        """Core PDF fonts are Latin-1 only. Transliterate common non-latin1
        chars to safe ASCII equivalents before falling back to '?' replace."""
        # Transliterate common typographic characters that appear in
        # invoice descriptions (em/en dash from room-line items, smart quotes).
        _trans = str.maketrans({
            "\u2014": "-",   # em dash — → -
            "\u2013": "-",   # en dash – → -
            "\u2018": "'",   # left single quote
            "\u2019": "'",   # right single quote
            "\u201c": '"',   # left double quote
            "\u201d": '"',   # right double quote
            "\u2026": "...", # ellipsis
        })
        return text.translate(_trans).encode("latin-1", errors="replace").decode("latin-1")

    def inr(value: object) -> str:
        return f"Rs. {value}"

    NAVY = (14, 26, 51)
    MUTED = (110, 120, 138)
    INK = (17, 24, 39)
    GOLD = (161, 128, 47)
    RULE = (226, 230, 236)

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # ── Navy header band ──
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, 210, 40, style="F")
    pdf.set_xy(14, 10)
    pdf.set_font("helvetica", "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(120, 8, latin1(hotel.name if hotel else "Hotel"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(14)
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(196, 204, 218)
    address_bits = (
        [b for b in [hotel.address_line1, hotel.city, hotel.state] if b] if hotel else []
    )
    if address_bits:
        pdf.cell(120, 4.5, latin1(", ".join(address_bits)), new_x="LMARGIN", new_y="NEXT")
        pdf.set_x(14)
    if gst.is_gst_registered and gst.gstin:
        pdf.cell(120, 4.5, f"GSTIN: {gst.gstin}", new_x="LMARGIN", new_y="NEXT")

    # Right side: invoice number + date
    pdf.set_xy(120, 10)
    pdf.set_font("helvetica", "B", 7)
    pdf.set_text_color(170, 180, 200)
    label = "INVOICE NO."
    if invoice.status == "cancelled":
        label = "INVOICE NO. (CANCELLED)"
    pdf.cell(76, 4, label, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(120, 15)
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(76, 6, invoice.invoice_number, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(120, 22)
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(196, 204, 218)
    pdf.cell(76, 5, invoice.invoice_date.strftime("%d/%m/%Y"), align="R")

    # ── Billed To / Stay Details ──
    pdf.set_xy(14, 50)
    pdf.set_font("helvetica", "B", 7)
    pdf.set_text_color(*MUTED)
    pdf.cell(90, 4, "BILLED TO")
    pdf.cell(90, 4, "STAY DETAILS", new_x="LMARGIN", new_y="NEXT")

    pdf.set_x(14)
    pdf.set_font("helvetica", "B", 10)
    pdf.set_text_color(*INK)
    pdf.cell(90, 5.5, latin1(invoice.guest_name))
    pdf.set_font("helvetica", "", 9)
    pdf.cell(90, 5.5, latin1(rooms_label or "-"), new_x="LMARGIN", new_y="NEXT")

    pdf.set_x(14)
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(*MUTED)
    stay_dates = ""
    if booking:
        cin = booking.check_in_date.strftime("%d/%m/%Y")
        cout = booking.check_out_date.strftime("%d/%m/%Y")
        cin_t = f", {booking.check_in_time}" if booking.check_in_time else ""
        cout_t = f", {booking.check_out_time}" if booking.check_out_time else ""
        stay_dates = f"{cin}{cin_t} -> {cout}{cout_t}"
    pdf.cell(90, 5, latin1(guest_phone))
    pdf.cell(90, 5, latin1(stay_dates), new_x="LMARGIN", new_y="NEXT")
    # Guest address intentionally omitted from the invoice (client 09/2026).
    if booking:
        pdf.set_x(14)
        pdf.cell(90, 5, "")
        pdf.cell(90, 5, f"Booking: {booking.booking_number}", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)

    # ── Line items: DESCRIPTION | AMOUNT ──
    pdf.set_x(14)
    pdf.set_font("helvetica", "B", 7)
    pdf.set_text_color(*MUTED)
    pdf.cell(140, 6, "DESCRIPTION")
    pdf.cell(42, 6, "AMOUNT", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*RULE)
    pdf.line(14, pdf.get_y(), 196, pdf.get_y())

    pdf.set_font("helvetica", "", 10)
    pdf.set_text_color(*INK)
    for item in invoice.items:
        # First letter capital — covers items generated before this change.
        desc = item.description[:1].upper() + item.description[1:]
        if item.quantity > 1:
            desc = f"{desc} x {item.quantity}"
        pdf.set_x(14)
        pdf.cell(140, 8, latin1(desc[:80]))
        pdf.cell(42, 8, latin1(inr(item.total_amount)), align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.line(14, pdf.get_y(), 196, pdf.get_y())

    pdf.ln(4)

    # ── Summary (right-aligned block) ──
    def summary_row(
        label: str,
        value: str,
        *,
        bold: bool = False,
        color: tuple[int, int, int] | None = None,
    ) -> None:
        pdf.set_x(110)
        pdf.set_font("helvetica", "B" if bold else "", 10)
        pdf.set_text_color(*(color or MUTED))
        pdf.cell(50, 6.5, label)
        pdf.set_text_color(*(color or INK))
        pdf.cell(36, 6.5, latin1(value), align="R", new_x="LMARGIN", new_y="NEXT")

    gst_total = invoice.cgst_amount + invoice.sgst_amount + invoice.igst_amount
    # Client 09/2026 GST modes on the customer-facing document:
    # - included_by_customer: Subtotal + GST rows (tax added on top, shown)
    # - included_by_hotel:    GST hidden — subtotal shown GROSS (tax inside)
    # - no_gst:               GST hidden, tax is zero anyway
    show_gst_row = gst_registered and not gst_inclusive
    display_subtotal = (
        invoice.subtotal if show_gst_row else money(invoice.subtotal + gst_total)
    )
    summary_row("Subtotal", inr(display_subtotal))
    if show_gst_row:
        # Client 17/09: show CGST + SGST separately; fall back to combined if
        # only IGST is present (inter-state) or if both CGST/SGST are zero.
        _cgst_rate = float(gst.default_cgst_rate or 0)
        _sgst_rate = float(gst.default_sgst_rate or 0)
        _igst_rate = float(gst.default_igst_rate or 0)
        if invoice.cgst_amount > 0:
            _lbl = f"CGST ({_cgst_rate:g}%)" if _cgst_rate else "CGST"
            summary_row(_lbl, inr(invoice.cgst_amount))
        if invoice.sgst_amount > 0:
            _lbl = f"SGST ({_sgst_rate:g}%)" if _sgst_rate else "SGST"
            summary_row(_lbl, inr(invoice.sgst_amount))
        if invoice.igst_amount > 0:
            _lbl = f"IGST ({_igst_rate:g}%)" if _igst_rate else "IGST"
            summary_row(_lbl, inr(invoice.igst_amount))
        if invoice.cgst_amount == 0 and invoice.igst_amount == 0 and gst_total > 0:
            summary_row("GST", inr(gst_total))
    if invoice.discount_amount > 0:
        summary_row("Discount", f"-{inr(invoice.discount_amount)}")
    if invoice.paid_amount > 0:
        summary_row("Advance Paid", f"-{inr(invoice.paid_amount)}", color=GOLD)
    pdf.set_draw_color(*RULE)
    pdf.line(110, pdf.get_y() + 1, 196, pdf.get_y() + 1)
    pdf.ln(2)
    pdf.set_x(110)
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*INK)
    pdf.cell(50, 9, "TOTAL DUE")
    pdf.set_font("helvetica", "B", 14)
    pdf.cell(36, 9, latin1(inr(invoice.due_amount)), align="R", new_x="LMARGIN", new_y="NEXT")

    if invoice.status == "cancelled":
        pdf.ln(4)
        pdf.set_x(14)
        pdf.set_font("helvetica", "B", 10)
        pdf.set_text_color(190, 40, 40)
        pdf.cell(0, 6, "THIS INVOICE HAS BEEN CANCELLED", new_x="LMARGIN", new_y="NEXT")

    # "Powered by DigitalMyHotels" footer — per-hotel super-admin toggle
    # (client 15/09, plan §3.8).
    settings_row = await db.scalar(
        select(HotelSettings.show_powered_by).where(
            HotelSettings.hotel_id == tenant.require_hotel()
        )
    )
    if settings_row is not False:  # default ON when no settings row exists
        # Pin "Powered by" to the absolute bottom-centre of the page
        # (client 09/2026: "keep it in bottom center").  set_y(-N) counts from
        # the bottom margin so the text sits ~12 mm above the page edge.
        pdf.set_y(-14)
        pdf.set_x(14)
        pdf.set_font("helvetica", "I", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(182, 5, "Powered by DigitalMyHotels", align="C", new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


async def email_invoice(
    db: AsyncSession,
    tenant: TenantContext,
    invoice_id: UUID,
    *,
    correlation_id: str | None = None,
) -> str:
    """Email the invoice PDF to the guest. Returns the recipient address."""
    from app.integrations.email.base import EmailAttachment, EmailMessage, get_email_backend
    from app.models.guest import Guest

    invoice = await get_invoice(db, tenant, invoice_id)
    booking = await db.get(Booking, invoice.booking_id)
    guest = (
        await db.get(Guest, booking.primary_guest_id)
        if booking and booking.primary_guest_id
        else None
    )
    if guest is None or not guest.email:
        raise ValidationAppError(
            "Guest has no email address on file — add one to the guest profile first",
            code="guest_no_email",
        )

    hotel = await db.get(Hotel, tenant.require_hotel())
    hotel_name = hotel.name if hotel else "Your hotel"
    pdf_bytes = await render_invoice_pdf(db, tenant, invoice_id)

    await get_email_backend().send(
        EmailMessage(
            to=guest.email,
            subject=f"Invoice {invoice.invoice_number} — {hotel_name}",
            body_text=(
                f"Dear {guest.full_name},\n\n"
                f"Please find attached your invoice {invoice.invoice_number} "
                f"for your stay at {hotel_name}.\n\n"
                f"Total: INR {invoice.total_amount}\n\n"
                f"Thank you for staying with us."
            ),
            attachments=[
                EmailAttachment(
                    filename=f"{invoice.invoice_number}.pdf", content=pdf_bytes
                )
            ],
        )
    )
    await write_audit(
        db,
        action="invoices.emailed",
        entity_type="invoice",
        entity_id=invoice.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        after={"invoice_number": invoice.invoice_number, "to": guest.email},
        correlation_id=correlation_id,
    )
    return guest.email
