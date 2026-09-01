from __future__ import annotations

import uuid
from datetime import time
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Hotel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hotels"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    logo_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country: Mapped[str] = mapped_column(String(120), default="India", nullable=False)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)
    # active | suspended | trial | expired

    settings: Mapped[HotelSettings | None] = relationship(
        back_populates="hotel", uselist=False, cascade="all, delete-orphan"
    )
    payment_config: Mapped[HotelPaymentConfig | None] = relationship(
        back_populates="hotel", uselist=False, cascade="all, delete-orphan"
    )


class HotelSettings(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hotel_settings"

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("hotels.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    check_in_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(14, 0))
    check_out_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(11, 0))
    cancellation_policy: Mapped[str | None] = mapped_column(Text, nullable=True)
    no_show_policy: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_prefix: Mapped[str] = mapped_column(String(32), default="INV", nullable=False)
    invoice_next_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    booking_prefix: Mapped[str] = mapped_column(String(32), default="BK", nullable=False)
    booking_next_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    registration_next_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    tax_inclusive_pricing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="INR", nullable=False)
    early_checkin_grace_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    late_checkout_grace_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    # Per-hour rates for early check-in and late checkout fees.
    # 0.00 means "hotel does not charge for this" — fee auto-calc is skipped.
    early_checkin_fee_per_hour: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=Decimal("0.00"), nullable=False
    )
    late_checkout_fee_per_hour: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=Decimal("0.00"), nullable=False
    )
    # "full" = all features; "checkin_only" = restrict to check-in/out (no expenses).
    access_mode: Mapped[str] = mapped_column(String(32), default="full", nullable=False)

    hotel: Mapped[Hotel] = relationship(back_populates="settings")


class HotelServiceItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Hotel-configurable chargeable services (special requirements price list)."""

    __tablename__ = "hotel_service_items"
    __table_args__ = (
        UniqueConstraint("hotel_id", "name", name="uq_service_item_hotel_name"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class HotelPaymentConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "hotel_payment_config"
    __table_args__ = (UniqueConstraint("hotel_id", name="uq_payment_config_hotel"),)

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False
    )
    # Encrypted UPI ID — never return to worker roles
    upi_id_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    upi_id_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    config_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    logo_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    qr_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    qr_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    hotel: Mapped[Hotel] = relationship(back_populates="payment_config")
