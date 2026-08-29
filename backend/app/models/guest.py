from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Guest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "guests"
    __table_args__ = (
        UniqueConstraint("hotel_id", "normalized_phone", name="uq_guest_hotel_phone"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    id_proof_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Store only last 4 for search; full ID encrypted/minimized separately if needed
    id_last4: Mapped[str | None] = mapped_column(String(4), nullable=True, index=True)
    id_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_verification_status: Mapped[str] = mapped_column(
        String(32), default="unverified", nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class GuestDocument(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "guest_documents"

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    guest_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    side: Mapped[str | None] = mapped_column(String(16), nullable=True)  # front|back|selfie


class GuestRegistration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "guest_registrations"
    __table_args__ = (
        UniqueConstraint("hotel_id", "registration_number", name="uq_registration_hotel_number"),
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
    guest_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guests.id"), nullable=False, index=True
    )
    registration_number: Mapped[str] = mapped_column(String(64), nullable=False)
    is_primary: Mapped[bool] = mapped_column(default=False, nullable=False)
    purpose_of_visit: Mapped[str | None] = mapped_column(String(200), nullable=True)
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
