from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import GstRates, calculate_gst, money
from app.models.booking import Booking
from app.models.payment import HotelCharge
from app.repositories.hotels import get_or_create_gst_settings
from app.schemas.payment import ChargeCreate
from app.services.audit import write_audit
from app.services.bookings import get_booking, settle_booking_amounts
from app.services.ledger import append_entry


async def _gst_rates(db: AsyncSession, hotel_id: UUID) -> tuple[GstRates, bool]:
    gst = await get_or_create_gst_settings(db, hotel_id)
    return (
        GstRates(
            cgst=gst.default_cgst_rate,
            sgst=gst.default_sgst_rate,
            igst=gst.default_igst_rate,
            version=gst.version,
        ),
        gst.is_gst_registered,
    )


async def add_charge(
    db: AsyncSession,
    tenant: TenantContext,
    body: ChargeCreate,
    *,
    correlation_id: str | None = None,
) -> HotelCharge:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, body.booking_id)
    if booking.status != "checked_in":
        raise ValidationAppError(
            "Charges can only be added to an active stay", code="not_checked_in"
        )

    taxable = money(body.rate * body.quantity)
    rates, registered = await _gst_rates(db, hotel_id)
    if body.apply_gst:
        breakup = calculate_gst(taxable, rates, is_registered=registered)
        tax, total = breakup.total_tax, breakup.total_amount
    else:
        tax, total = Decimal("0.00"), taxable

    charge = HotelCharge(
        hotel_id=hotel_id,
        booking_id=booking.id,
        category=body.category,
        description=body.description,
        quantity=body.quantity,
        rate=body.rate,
        taxable_amount=taxable,
        tax_amount=tax,
        total_amount=total,
        created_by_id=tenant.user_id,
    )
    db.add(charge)
    await db.flush()

    booking.total_amount = money(booking.total_amount + total)
    booking.tax_amount = money(booking.tax_amount + tax)
    # Recompute due AND payment status — a paid booking that gains a charge
    # must flip back to "partial" (client bug: PAID badge with ₹200 due).
    settle_booking_amounts(booking)

    await append_entry(
        db,
        hotel_id=hotel_id,
        booking_id=booking.id,
        entry_type="debit",
        amount=total,
        description=f"{body.category}: {body.description}",
        reference_type="hotel_charge",
        reference_id=charge.id,
        created_by_id=tenant.user_id,
    )
    await write_audit(
        db,
        action="charges.added",
        entity_type="hotel_charge",
        entity_id=charge.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking": booking.booking_number,
            "category": body.category,
            "total": str(total),
        },
        correlation_id=correlation_id,
    )
    return charge


async def void_charge(
    db: AsyncSession,
    tenant: TenantContext,
    charge_id: UUID,
    *,
    correlation_id: str | None = None,
) -> HotelCharge:
    """Void (never delete) a charge; reverses booking totals via a credit."""
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(HotelCharge).where(
            HotelCharge.id == charge_id, HotelCharge.hotel_id == hotel_id
        )
    )
    charge = result.scalar_one_or_none()
    if charge is None:
        raise NotFoundError("Charge not found")
    if charge.voided_at is not None:
        raise ValidationAppError("Charge is already voided", code="already_voided")

    booking_result = await db.execute(
        select(Booking).where(
            Booking.id == charge.booking_id, Booking.hotel_id == hotel_id
        )
    )
    booking = booking_result.scalar_one()

    charge.voided_at = datetime.now(UTC)
    booking.total_amount = money(booking.total_amount - charge.total_amount)
    booking.tax_amount = money(booking.tax_amount - charge.tax_amount)
    settle_booking_amounts(booking)

    await append_entry(
        db,
        hotel_id=hotel_id,
        booking_id=booking.id,
        entry_type="credit",
        amount=charge.total_amount,
        description=f"Void charge: {charge.description}",
        reference_type="hotel_charge_void",
        reference_id=charge.id,
        created_by_id=tenant.user_id,
    )
    await write_audit(
        db,
        action="charges.voided",
        entity_type="hotel_charge",
        entity_id=charge.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"total": str(charge.total_amount)},
        correlation_id=correlation_id,
    )
    return charge


async def list_charges(
    db: AsyncSession,
    tenant: TenantContext,
    booking_id: UUID,
) -> list[HotelCharge]:
    hotel_id = tenant.require_hotel()
    # Validates booking is in tenant scope.
    await get_booking(db, tenant, booking_id)
    result = await db.execute(
        select(HotelCharge)
        .where(HotelCharge.hotel_id == hotel_id, HotelCharge.booking_id == booking_id)
        .order_by(HotelCharge.created_at)
    )
    return list(result.scalars().all())
