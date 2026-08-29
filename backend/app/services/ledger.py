"""Append-oriented guest/booking ledger.

Debits increase what the guest owes; credits decrease it. `balance_after`
is computed under a booking-scoped advisory pattern: callers must already
hold a transaction; the latest entry is read within it.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payment import GuestBookingLedger


async def current_balance(db: AsyncSession, hotel_id: UUID, booking_id: UUID) -> Decimal:
    result = await db.execute(
        select(GuestBookingLedger.balance_after)
        .where(
            GuestBookingLedger.hotel_id == hotel_id,
            GuestBookingLedger.booking_id == booking_id,
        )
        .order_by(GuestBookingLedger.seq.desc())
        .limit(1)
    )
    balance = result.scalar_one_or_none()
    return balance if balance is not None else Decimal("0.00")


async def append_entry(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    booking_id: UUID,
    entry_type: str,
    amount: Decimal,
    description: str,
    reference_type: str | None = None,
    reference_id: UUID | None = None,
    created_by_id: UUID | None = None,
) -> GuestBookingLedger:
    balance = await current_balance(db, hotel_id, booking_id)
    new_balance = balance + amount if entry_type == "debit" else balance - amount
    entry = GuestBookingLedger(
        hotel_id=hotel_id,
        booking_id=booking_id,
        entry_type=entry_type,
        amount=amount,
        balance_after=new_balance,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
        created_by_id=created_by_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def list_entries(
    db: AsyncSession, hotel_id: UUID, booking_id: UUID
) -> list[GuestBookingLedger]:
    result = await db.execute(
        select(GuestBookingLedger)
        .where(
            GuestBookingLedger.hotel_id == hotel_id,
            GuestBookingLedger.booking_id == booking_id,
        )
        .order_by(GuestBookingLedger.seq)
    )
    return list(result.scalars().all())
