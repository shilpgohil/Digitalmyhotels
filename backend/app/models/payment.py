from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class HotelCharge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hotel_charges"
    __table_args__ = (
        CheckConstraint(
            "category IN ('food','restaurant','laundry','room_service','extra_bed','minibar',"
            "'transport','damage','other')",
            name="charge_category",
        ),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Payment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "payments"
    __table_args__ = (
        # Cash and UPI are the core payment methods. Card, bank_transfer and
        # other are accepted for manual record-keeping only (no gateway integration).
        CheckConstraint(
            "method IN ('cash','upi','card','bank_transfer','other')",
            name="payment_method",
        ),
        CheckConstraint(
            "status IN ('pending','completed','failed','refunded','cancelled','corrected')",
            name="payment_status",
        ),
        CheckConstraint(
            "purpose IN ('advance','stay','deposit','charge','other')",
            name="payment_purpose",
        ),
        # Financial reporting scans by hotel + date.
        Index("ix_payments_hotel_paid_at", "hotel_id", "paid_at"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoices.id"), nullable=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), default="stay", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(128), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    collected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Correction trail
    corrects_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True
    )
    correction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class Refund(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint("method IN ('cash','upi')", name="refund_method"),
        CheckConstraint(
            "status IN ('pending','completed','cancelled')",
            name="refund_status",
        ),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    refunded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )


class GuestBookingLedger(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Append-oriented ledger. Corrections create new rows."""

    __tablename__ = "guest_booking_ledger"
    __table_args__ = (
        CheckConstraint("entry_type IN ('debit','credit')", name="ledger_entry_type"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    # Monotonic append order — timestamps can tie across fast transactions.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    reference_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
