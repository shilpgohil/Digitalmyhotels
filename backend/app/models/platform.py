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
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SubscriptionPlan(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "subscription_plans"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Discounted / actual price the hotel pays.
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Optional MRP / original price — shown as strikethrough on the hotel
    # plan page alongside the discounted price and an auto-calculated
    # "Save X%" badge.  NULL means no discount shown.
    mrp_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    trial_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Subscription(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            # 'expiring_soon' = future expiry within 7 days (still active).
            # 'in_grace'      = past expiry_date, within grace window (wind-down).
            # 'expired'       = past both expiry_date and grace window (blocked).
            "status IN ('trial','active','expiring_soon','in_grace','expired','suspended')",
            name="subscription_status",
        ),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="trial", nullable=False, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    grace_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    payment_status: Mapped[str] = mapped_column(String(32), default="unpaid", nullable=False)
    # How the hotel paid for this subscription period.
    # Canonical values: upi | cash | bank_transfer | card | other
    # NULL = unknown / not recorded (legacy rows created before this column).
    payment_mode: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    allow_view_after_expiry: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    block_transactions_after_expiry: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )


class SubscriptionRenewalRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Partner-initiated renewal: hotel pays the platform UPI, super admin verifies."""

    __tablename__ = "subscription_renewal_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','approved','rejected')",
            name="renewal_request_status",
        ),
    )

    hotel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=False
    )
    # Snapshot of the plan price at request time — plans may be repriced later.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False, index=True
    )
    # Payment mode the hotel used when submitting this request
    # (upi | cash | bank_transfer | card | other). NULL = not specified.
    payment_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PlatformConfig(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Single-row table holding platform-wide settings that the Super Admin
    can update from the SA panel (e.g. platform UPI for subscription payments).
    Exactly one row is created on first write; reads fall back to environment
    variables when the row does not yet exist (backwards-compat for deploys
    that already have PLATFORM_UPI_ID set via env).
    """

    __tablename__ = "platform_config"

    # UPI VPA the hotel owners pay into when purchasing / renewing plans.
    # NULL = not yet configured (frontend shows "Contact team" fallback).
    platform_upi_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    platform_upi_payee_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # B2 object key for the DigitalMyHotels brand logo composited in the
    # centre of the platform subscription payment QR.  NULL = no logo.
    platform_logo_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)


class Notification(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "notifications"
    __table_args__ = (
        # Fast unread-count queries per hotel.
        Index("ix_notif_hotel_read", "hotel_id", "is_read"),
    )

    hotel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    # Category drives colour-coding in the UI.
    # front_desk | housekeeping | finance | operations | admin | platform
    category: Mapped[str] = mapped_column(
        String(32), default="front_desk", nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Deep link the user is taken to when they tap the notification.
    # Permission-guarded in the frontend: if the user lacks the required
    # permission for that URL they are redirected to their home page instead.
    deep_link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # LEGACY shared flag — kept for user-targeted rows and backwards compat.
    # Hotel-wide notifications now track read state PER USER via
    # NotificationRead (client 9-08 items 2/35: one employee reading an alert
    # must not mark it read for everyone).
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class PasswordResetRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Hierarchical password-reset request (client 9-08 items 34).

    Staff requests are routed to their hotel's administrators; hotel
    owner/administrator requests are routed to the platform Super Admin.
    Resolution happens through the existing manual reset actions, which mark
    the request completed.
    """

    __tablename__ = "password_reset_requests"
    __table_args__ = (
        CheckConstraint(
            "audience IN ('hotel_admin','super_admin')",
            name="pwreq_audience",
        ),
        CheckConstraint(
            "status IN ('pending','completed','dismissed')",
            name="pwreq_status",
        ),
        Index("ix_pwreq_pending", "audience", "status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hotel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="CASCADE"), nullable=True, index=True
    )
    audience: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class NotificationRead(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Per-user read receipt for a notification."""

    __tablename__ = "notification_reads"
    __table_args__ = (
        Index(
            "uq_notification_read_user",
            "notification_id",
            "user_id",
            unique=True,
        ),
    )

    notification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuditLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "audit_logs"
    __table_args__ = (
        # Audit explorer lists newest-first per hotel.
        Index("ix_audit_hotel_created", "hotel_id", "created_at"),
    )

    hotel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("hotels.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(120), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
