from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.gst import money
from app.models.booking import Booking
from app.models.payment import Payment, Refund
from app.schemas.payment import PaymentCreate, RefundCreate
from app.services.audit import write_audit
from app.services.bookings import get_booking, settle_booking_amounts
from app.services.ledger import append_entry


def _now() -> datetime:
    return datetime.now(UTC)


async def payment_summary(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
):
    from sqlalchemy import case, func, literal_column

    from app.schemas.payment import PaymentSummaryOut

    hotel_id = tenant.require_hotel()

    # Single query: all payment sums in one pass using conditional aggregation.
    pay_stmt = select(
        func.coalesce(func.sum(Payment.amount), 0).label("total"),
        func.coalesce(
            func.sum(case((Payment.method == "cash", Payment.amount), else_=0)), 0
        ).label("cash"),
        func.coalesce(
            func.sum(case((Payment.method == "upi", Payment.amount), else_=0)), 0
        ).label("upi"),
        func.coalesce(
            func.sum(case((Payment.purpose == "deposit", Payment.amount), else_=0)), 0
        ).label("deposits"),
    ).where(Payment.hotel_id == hotel_id, Payment.status == "completed")
    if from_date:
        pay_stmt = pay_stmt.where(func.date(Payment.paid_at) >= from_date)
    if to_date:
        pay_stmt = pay_stmt.where(func.date(Payment.paid_at) <= to_date)
    pay_row = (await db.execute(pay_stmt)).one()

    # Refunds in one query.
    ref_stmt = select(
        func.coalesce(func.sum(Refund.amount), 0).label("total")
    ).where(Refund.hotel_id == hotel_id, Refund.status == "completed")
    if from_date:
        ref_stmt = ref_stmt.where(func.date(Refund.refunded_at) >= from_date)
    if to_date:
        ref_stmt = ref_stmt.where(func.date(Refund.refunded_at) <= to_date)
    ref_row = (await db.execute(ref_stmt)).one()

    # Booking counts in one query using conditional aggregation.
    count_stmt = select(
        func.count(case(
            (Booking.payment_status == "paid", literal_column("1"))
        )).label("paid"),
        func.count(case(
            (Booking.payment_status == "partial", literal_column("1"))
        )).label("partial"),
        func.count(case(
            (Booking.payment_status == "unpaid", literal_column("1"))
        )).label("unpaid"),
    ).where(
        Booking.hotel_id == hotel_id,
        Booking.status.notin_(("cancelled", "no_show")),
    )
    count_row = (await db.execute(count_stmt)).one()

    return PaymentSummaryOut(
        total_collected=money(pay_row.total),
        cash=money(pay_row.cash),
        upi=money(pay_row.upi),
        refunds=money(ref_row.total),
        deposits=money(pay_row.deposits),
        paid_bookings=int(count_row.paid),
        partial_bookings=int(count_row.partial),
        unpaid_bookings=int(count_row.unpaid),
    )


async def collect_payment(
    db: AsyncSession,
    tenant: TenantContext,
    body: PaymentCreate,
    *,
    correlation_id: str | None = None,
) -> Payment:
    hotel_id = tenant.require_hotel()
    from app.services.subscriptions import assert_transactions_allowed

    await assert_transactions_allowed(db, hotel_id)
    booking = await get_booking(db, tenant, body.booking_id)
    if booking.status in ("cancelled", "no_show"):
        raise ValidationAppError(
            "Payments cannot be collected for cancelled/no-show bookings",
            code="booking_closed",
        )

    payment = Payment(
        hotel_id=hotel_id,
        booking_id=booking.id,
        amount=money(body.amount),
        method=body.method,
        status="completed",
        purpose=body.purpose,
        reference=body.reference,
        paid_at=_now(),
        collected_by_id=tenant.user_id,
        notes=body.notes,
    )
    db.add(payment)
    await db.flush()

    if body.purpose == "deposit":
        booking.security_deposit = money(booking.security_deposit + payment.amount)
    else:
        booking.advance_amount = money(booking.advance_amount + payment.amount)
    # Deposit AND advance both settle against the bill — recompute due + status.
    settle_booking_amounts(booking)

    await append_entry(
        db,
        hotel_id=hotel_id,
        booking_id=booking.id,
        entry_type="credit",
        amount=payment.amount,
        description=f"Payment ({body.method}, {body.purpose})",
        reference_type="payment",
        reference_id=payment.id,
        created_by_id=tenant.user_id,
    )
    await write_audit(
        db,
        action="payments.collected",
        entity_type="payment",
        entity_id=payment.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking": booking.booking_number,
            "amount": str(payment.amount),
            "method": body.method,
            "purpose": body.purpose,
        },
        correlation_id=correlation_id,
    )
    from app.models.user import User as _User
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    collector = await db.get(_User, tenant.user_id)
    collector_name = collector.full_name if collector else "Staff"
    await _fire(db, hotel_id=hotel_id, event=NE.PAYMENT_COLLECTED, data={
        "amount": str(payment.amount),
        "method": body.method,
        "booking_number": booking.booking_number,
        "collected_by": collector_name,
    })
    return payment


async def get_payment(db: AsyncSession, tenant: TenantContext, payment_id: UUID) -> Payment:
    result = await db.execute(
        select(Payment).where(
            Payment.id == payment_id, Payment.hotel_id == tenant.require_hotel()
        )
    )
    payment = result.scalar_one_or_none()
    if payment is None:
        raise NotFoundError("Payment not found")
    return payment


async def correct_payment(
    db: AsyncSession,
    tenant: TenantContext,
    payment_id: UUID,
    *,
    corrected_amount: Decimal,
    reason: str,
    correlation_id: str | None = None,
) -> Payment:
    """Correction never mutates the original — it voids and re-records."""
    hotel_id = tenant.require_hotel()
    original = await get_payment(db, tenant, payment_id)
    if original.status != "completed":
        raise ValidationAppError(
            "Only completed payments can be corrected", code="not_correctable"
        )

    booking = await get_booking(db, tenant, original.booking_id)
    corrected_amount = money(corrected_amount)
    delta = corrected_amount - original.amount

    original.status = "corrected"
    replacement = Payment(
        hotel_id=hotel_id,
        booking_id=booking.id,
        amount=corrected_amount,
        method=original.method,
        status="completed",
        purpose=original.purpose,
        reference=original.reference,
        paid_at=original.paid_at,
        collected_by_id=original.collected_by_id,
        corrects_payment_id=original.id,
        correction_reason=reason,
    )
    db.add(replacement)
    await db.flush()

    if original.purpose == "deposit":
        booking.security_deposit = money(booking.security_deposit + delta)
    else:
        booking.advance_amount = money(booking.advance_amount + delta)
    settle_booking_amounts(booking)

    entry_type = "credit" if delta > 0 else "debit"
    if delta != 0:
        await append_entry(
            db,
            hotel_id=hotel_id,
            booking_id=booking.id,
            entry_type=entry_type,
            amount=abs(delta),
            description=f"Payment correction: {reason}",
            reference_type="payment_correction",
            reference_id=replacement.id,
            created_by_id=tenant.user_id,
        )
    await write_audit(
        db,
        action="payments.corrected",
        entity_type="payment",
        entity_id=original.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        before={"amount": str(original.amount)},
        after={
            "amount": str(corrected_amount),
            "replacement_id": str(replacement.id),
            "reason": reason,
        },
        correlation_id=correlation_id,
    )
    return replacement


async def refund_payment(
    db: AsyncSession,
    tenant: TenantContext,
    body: RefundCreate,
    *,
    correlation_id: str | None = None,
) -> Refund:
    hotel_id = tenant.require_hotel()
    booking = await get_booking(db, tenant, body.booking_id)
    amount = money(body.amount)

    # Prevent refunding more than what has been collected for this booking.
    max_refundable = money(booking.advance_amount + booking.security_deposit)
    if amount > max_refundable:
        raise ValidationAppError(
            f"Refund amount ({amount}) exceeds total collected ({max_refundable})",
            code="refund_exceeds_collected",
        )

    if body.payment_id:
        original = await get_payment(db, tenant, body.payment_id)
        if original.booking_id != booking.id:
            raise ValidationAppError(
                "Payment does not belong to this booking", code="payment_mismatch"
            )

    refund = Refund(
        hotel_id=hotel_id,
        booking_id=booking.id,
        payment_id=body.payment_id,
        amount=amount,
        method=body.method,
        status="completed",
        reason=body.reason,
        refunded_at=_now(),
        performed_by_id=tenant.user_id,
    )
    db.add(refund)
    await db.flush()

    booking.advance_amount = money(max(booking.advance_amount - amount, Decimal("0.00")))
    settle_booking_amounts(booking)
    if booking.status == "checked_out" and booking.due_amount == 0:
        booking.payment_status = "refunded"

    await append_entry(
        db,
        hotel_id=hotel_id,
        booking_id=booking.id,
        entry_type="debit",
        amount=amount,
        description=f"Refund ({body.method}): {body.reason}",
        reference_type="refund",
        reference_id=refund.id,
        created_by_id=tenant.user_id,
    )
    await write_audit(
        db,
        action="payments.refunded",
        entity_type="refund",
        entity_id=refund.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "booking": booking.booking_number,
            "amount": str(amount),
            "reason": body.reason,
        },
        correlation_id=correlation_id,
    )
    return refund


async def list_payments(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    booking_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Payment], int]:
    from sqlalchemy import func

    hotel_id = tenant.require_hotel()
    stmt = select(Payment).where(Payment.hotel_id == hotel_id)
    if booking_id:
        stmt = stmt.where(Payment.booking_id == booking_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.order_by(Payment.paid_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total
