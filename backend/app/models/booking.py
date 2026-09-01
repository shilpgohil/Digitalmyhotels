from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Booking(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "bookings"
    __table_args__ = (
        UniqueConstraint("hotel_id", "booking_number", name="uq_booking_number"),
        CheckConstraint(
            "status IN ('pending','confirmed','checked_in','checked_out','cancelled','no_show')",
            name="booking_status",
        ),
        CheckConstraint(
            "payment_status IN ('unpaid','partial','paid','refunded','cancelled')",
            name="booking_payment_status",
        ),
        # Real query paths: operational lists and date-window overlap checks.
        Index("ix_bookings_hotel_status", "hotel_id", "status"),
        Index("ix_bookings_hotel_checkin", "hotel_id", "check_in_date"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_number: Mapped[str] = mapped_column(String(64), nullable=False)
    primary_guest_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guests.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(64), default="walk_in", nullable=False)
    # Guest type per client requirement: business / personal / family / group / other
    guest_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    payment_status: Mapped[str] = mapped_column(String(32), default="unpaid", nullable=False)
    check_in_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_out_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Per-booking times (HH:MM) — fall back to hotel defaults when null.
    check_in_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    check_out_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    adults: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    children: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    room_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    advance_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    security_deposit: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    due_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    special_requests: Mapped[str | None] = mapped_column(Text, nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    emergency_contact_relation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parking_slot: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    rooms: Mapped[list[BookingRoom]] = relationship(
        back_populates="booking", cascade="all, delete-orphan"
    )


class BookingRoom(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "booking_rooms"
    __table_args__ = (
        UniqueConstraint("booking_id", "room_id", name="uq_booking_room"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id"), nullable=False, index=True
    )
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("room_types.id"), nullable=False
    )
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    booking: Mapped[Booking] = relationship(back_populates="rooms")


class CheckIn(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "checkins"

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, unique=True
    )
    checked_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expected_checkout_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_early: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    early_fee: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class CheckOut(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "checkouts"

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    checked_out_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_early: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    late_fee: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    nights: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    final_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    due_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    refund_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    payment_due_authorized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payment_due_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverse_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_reversed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class RoomTransfer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "room_transfers"

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    from_room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id"), nullable=False
    )
    to_room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id"), nullable=False
    )
    transferred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
