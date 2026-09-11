"""Staff attendance domain — staff profiles + daily attendance records.

Every hotel employee that participates in attendance has a StaffProfile row
linked to their platform User (managers/admins/owners included — their profile
is lazily created on first self check-in). AttendanceRecord is one row per
staff member per hotel-local work date.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class StaffProfile(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "staff_profiles"
    __table_args__ = (
        UniqueConstraint("hotel_id", "user_id", name="uq_staff_hotel_user"),
        UniqueConstraint("hotel_id", "staff_code", name="uq_staff_hotel_code"),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # STF-001 style, sequential per hotel.
    staff_code: Mapped[str] = mapped_column(String(32), nullable=False)
    # reception | housekeeping | fnb | maintenance | management | other
    department: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    designation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # full_time | part_time | contract
    employment_type: Mapped[str] = mapped_column(String(16), nullable=False, default="full_time")
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Permission-gated (staff.salary_view) — serializers must strip it otherwise.
    base_salary: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    shift_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    shift_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    # 0=Sunday … 6=Saturday; NULL = no fixed weekly off.
    weekly_off: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    photo_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # active | on_leave | inactive
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)

    attendance_records: Mapped[list[AttendanceRecord]] = relationship(
        back_populates="staff_profile", cascade="all, delete-orphan"
    )


class AttendanceRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint(
            "hotel_id", "staff_profile_id", "work_date", name="uq_attendance_staff_day"
        ),
        CheckConstraint(
            "check_out_at IS NULL OR check_in_at IS NOT NULL",
            name="ck_attendance_out_requires_in",
        ),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    staff_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Hotel-timezone date the shift belongs to (check-in instant's local date).
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    check_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Geofence evidence — stored for audit even when the fence is disabled.
    check_in_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    check_in_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    check_in_accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 1), nullable=True)
    check_in_distance_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 1), nullable=True)
    check_out_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    check_out_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    check_out_accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 1), nullable=True)
    check_out_distance_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 1), nullable=True)

    # "Face Check-In" evidence selfie (object storage key).
    check_in_selfie_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # self_geo | front_desk | manual
    method_in: Mapped[str | None] = mapped_column(String(16), nullable=True)
    method_out: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Operator for front_desk/manual records.
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # present | late | absent | leave | off | holiday
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="present", index=True)
    late_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    early_out_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    staff_profile: Mapped[StaffProfile] = relationship(back_populates="attendance_records")
