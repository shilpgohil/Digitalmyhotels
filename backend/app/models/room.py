from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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


class RoomType(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "room_types"
    __table_args__ = (
        UniqueConstraint("hotel_id", "code", name="uq_room_type_hotel_code"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Day-use (hourly) rate; NULL means day-use bookings fall back to the
    # full-night base_price for the whole stay.
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    extra_guest_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )
    max_occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    rooms: Mapped[list[Room]] = relationship(back_populates="room_type")


class Room(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "rooms"
    __table_args__ = (
        UniqueConstraint("hotel_id", "room_number", name="uq_room_hotel_number"),
        CheckConstraint(
            "status IN ('available','reserved','occupied','cleaning_required',"
            "'cleaning_in_progress','clean_ready','inspection_required',"
            "'maintenance','out_of_service')",
            name="room_status",
        ),
        # Status summary + grid filters always scope by hotel first.
        Index("ix_rooms_hotel_status", "hotel_id", "status"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("room_types.id"), nullable=False, index=True
    )
    room_number: Mapped[str] = mapped_column(String(32), nullable=False)
    floor: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bed_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(
        String(40), default="available", nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    room_type: Mapped[RoomType] = relationship(back_populates="rooms")
    amenities: Mapped[list[RoomAmenity]] = relationship(
        back_populates="room", cascade="all, delete-orphan"
    )


class RoomAmenity(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "room_amenities"
    __table_args__ = (
        UniqueConstraint("room_id", "name", name="uq_room_amenity_name"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    room: Mapped[Room] = relationship(back_populates="amenities")
