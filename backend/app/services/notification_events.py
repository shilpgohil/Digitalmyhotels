"""Notification event dispatcher.

Single place that maps every hotel lifecycle event to a coloured, deep-linked
notification visible to the whole hotel team.

All roles can SEE all hotel notifications (awareness is key for hotel ops).
Deep-link permission enforcement is handled on the frontend: if the user
lacks the required permission, they land on their home page instead.

Usage:
    await fire(db, hotel_id=hotel.id, event=NE.CHECKIN_COMPLETED, data={...})
"""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.notifications import create_notification


class NE(StrEnum):
    """Notification event codes (NE = Notification Event)."""

    # Front desk
    BOOKING_CREATED = "booking.created"
    BOOKING_CONFIRMED = "booking.confirmed"
    BOOKING_CANCELLED = "booking.cancelled"
    BOOKING_NOSHOW = "booking.no_show"
    CHECKIN_COMPLETED = "stay.checked_in"
    CHECKOUT_COMPLETED = "stay.checked_out"
    CHECKOUT_REVERSED = "stay.checkout_reversed"
    ROOM_TRANSFERRED = "stay.room_transferred"

    # Housekeeping
    ROOM_CLEANING_REQUIRED = "housekeeping.cleaning_required"
    ROOM_CLEANED = "housekeeping.room_available"
    MAINTENANCE_OPENED = "maintenance.opened"
    MAINTENANCE_RESOLVED = "maintenance.resolved"

    # Finance
    PAYMENT_COLLECTED = "payments.collected"
    REFUND_PROCESSED = "payments.refunded"
    INVOICE_GENERATED = "invoices.generated"
    INVOICE_CANCELLED = "invoices.cancelled"
    EXPENSE_SUBMITTED = "expenses.submitted"
    EXPENSE_APPROVED = "expenses.approved"
    EXPENSE_REJECTED = "expenses.rejected"
    DUE_ON_CHECKOUT = "payments.due_on_checkout"

    # Operations
    DAY_CLOSED = "ops.day_closed"
    DAY_REOPENED = "ops.day_reopened"
    HANDOVER_CREATED = "ops.handover_created"
    HANDOVER_CONFIRMED = "ops.handover_confirmed"

    # Admin
    TEAM_MEMBER_ADDED = "admin.team_added"
    TEAM_MEMBER_DISABLED = "admin.team_disabled"
    UPI_CHANGED = "admin.upi_changed"

    # Platform
    SUBSCRIPTION_EXPIRING = "platform.sub_expiring"
    SUBSCRIPTION_EXPIRED = "platform.sub_expired"


# ---------------------------------------------------------------------------
# Event → notification template mapping
# ---------------------------------------------------------------------------

_TEMPLATES: dict[NE, dict] = {
    NE.BOOKING_CREATED: {
        "category": "front_desk",
        "title": "New booking created",
        "body": "Booking {booking_number} for {guest_name} — {check_in_date} to {check_out_date}",
        "deep_link": "/bookings?q={booking_number}",
    },
    NE.BOOKING_CONFIRMED: {
        "category": "front_desk",
        "title": "Booking confirmed",
        "body": "{booking_number} ({guest_name}) confirmed. Check-in: {check_in_date}",
        "deep_link": "/bookings?q={booking_number}",
    },
    NE.BOOKING_CANCELLED: {
        "category": "front_desk",
        "title": "Booking cancelled",
        "body": "{booking_number} ({guest_name}) cancelled. Reason: {reason}",
        "deep_link": "/bookings?q={booking_number}",
    },
    NE.BOOKING_NOSHOW: {
        "category": "front_desk",
        "title": "No-show recorded",
        "body": "{booking_number} ({guest_name}) marked as no-show.",
        "deep_link": "/bookings?q={booking_number}",
    },
    NE.CHECKIN_COMPLETED: {
        "category": "front_desk",
        "title": "Guest checked in",
        "body": "{guest_name} checked into Room {rooms} ({booking_number})",
        "deep_link": "/current-guests",
    },
    NE.CHECKOUT_COMPLETED: {
        "category": "front_desk",
        "title": "Guest checked out",
        "body": "{guest_name} checked out from Room {rooms}. Balance: ₹{due_amount}",
        "deep_link": "/current-guests",
    },
    NE.CHECKOUT_REVERSED: {
        "category": "front_desk",
        "title": "Checkout reversed",
        "body": (
            "{booking_number} ({guest_name}) checkout was reversed. "
            "Guest is back in-house."
        ),
        "deep_link": "/current-guests",
    },
    NE.ROOM_TRANSFERRED: {
        "category": "front_desk",
        "title": "Room transfer done",
        "body": "{guest_name} moved from Room {from_room} → Room {to_room}",
        "deep_link": "/current-guests",
    },
    NE.ROOM_CLEANING_REQUIRED: {
        "category": "housekeeping",
        "title": "Room needs cleaning",
        "body": "Room {room_number} is ready for housekeeping after {guest_name}'s checkout",
        "deep_link": "/housekeeping",
    },
    NE.ROOM_CLEANED: {
        "category": "housekeeping",
        "title": "Room is clean and available",
        "body": "Room {room_number} cleaned and marked available — ready to assign",
        "deep_link": "/housekeeping",
    },
    NE.MAINTENANCE_OPENED: {
        "category": "housekeeping",
        "title": "Maintenance opened",
        "body": "Room {room_number}: {reason}",
        "deep_link": "/housekeeping",
    },
    NE.MAINTENANCE_RESOLVED: {
        "category": "housekeeping",
        "title": "Maintenance resolved",
        "body": "Room {room_number} maintenance resolved — room is available",
        "deep_link": "/housekeeping",
    },
    NE.PAYMENT_COLLECTED: {
        "category": "finance",
        "title": "Payment collected",
        "body": "₹{amount} ({method}) collected for {booking_number} by {collected_by}",
        "deep_link": "/payments",
    },
    NE.REFUND_PROCESSED: {
        "category": "finance",
        "title": "Refund processed",
        "body": "₹{amount} ({method}) refunded for {booking_number}",
        "deep_link": "/payments",
    },
    NE.INVOICE_GENERATED: {
        "category": "finance",
        "title": "Invoice generated",
        "body": "Invoice {invoice_number} for {guest_name} — ₹{total_amount}",
        "deep_link": "/invoices",
    },
    NE.INVOICE_CANCELLED: {
        "category": "finance",
        "title": "Invoice cancelled",
        "body": "Invoice {invoice_number} cancelled. Reason: {reason}",
        "deep_link": "/invoices",
    },
    NE.EXPENSE_SUBMITTED: {
        "category": "finance",
        "title": "Expense needs approval",
        "body": "₹{amount} — {description}. Submitted by {submitted_by}",
        "deep_link": "/expenses",
    },
    NE.EXPENSE_APPROVED: {
        "category": "finance",
        "title": "Expense approved",
        "body": "Your expense ₹{amount} — {description} was approved",
        "deep_link": "/expenses",
    },
    NE.EXPENSE_REJECTED: {
        "category": "finance",
        "title": "Expense rejected",
        "body": "Your expense ₹{amount} — {description} was rejected. Reason: {reason}",
        "deep_link": "/expenses",
    },
    NE.DUE_ON_CHECKOUT: {
        "category": "finance",
        "title": "Checkout with outstanding balance",
        "body": (
            "{guest_name} checked out with ₹{due_amount} outstanding ({booking_number})"
        ),
        "deep_link": "/payments",
    },
    NE.DAY_CLOSED: {
        "category": "operations",
        "title": "Day closed",
        "body": "Daily closing for {business_date} completed. Revenue: ₹{total_revenue}",
        "deep_link": "/daily-closing",
    },
    NE.DAY_REOPENED: {
        "category": "operations",
        "title": "Day reopened ⚠️",
        "body": "Daily closing for {business_date} was reopened. Reason: {reason}",
        "deep_link": "/daily-closing",
    },
    NE.HANDOVER_CREATED: {
        "category": "operations",
        "title": "Shift handover created",
        "body": "New shift handover created. Pending confirmation.",
        "deep_link": "/shift-handover",
    },
    NE.HANDOVER_CONFIRMED: {
        "category": "operations",
        "title": "Shift handover confirmed",
        "body": "Shift handover confirmed by {confirmed_by}.",
        "deep_link": "/shift-handover",
    },
    NE.TEAM_MEMBER_ADDED: {
        "category": "admin",
        "title": "New team member added",
        "body": "{member_name} joined as {role}",
        "deep_link": "/team",
    },
    NE.TEAM_MEMBER_DISABLED: {
        "category": "admin",
        "title": "Team member account disabled",
        "body": "{member_name}'s account was disabled",
        "deep_link": "/team",
    },
    NE.UPI_CHANGED: {
        "category": "admin",
        "title": "UPI configuration updated",
        "body": "Hotel UPI payment configuration was changed by {changed_by}",
        "deep_link": "/settings#payments",
    },
    NE.SUBSCRIPTION_EXPIRING: {
        "category": "platform",
        "title": "Subscription expiring soon",
        "body": "Your hotel subscription expires on {expiry_date}. Renew to avoid interruption.",
        "deep_link": "/plan",
    },
    NE.SUBSCRIPTION_EXPIRED: {
        "category": "platform",
        "title": "Subscription expired",
        "body": "Your hotel subscription has expired. New bookings and payments are blocked.",
        "deep_link": "/plan",
    },
}


def _render(template: str, data: dict) -> str:
    """Simple {key} substitution — missing keys left as-is."""
    for k, v in data.items():
        template = template.replace("{" + k + "}", str(v) if v is not None else "—")
    return template


async def fire(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    event: NE,
    data: dict | None = None,
    user_id: UUID | None = None,
) -> None:
    """Create a hotel-wide notification for the given event.

    `data` fills title/body/deep_link templates.
    `user_id` pins the notification to a specific user (e.g. expense submitter).
    When `user_id` is None the notification is visible to the whole hotel team.
    """
    tmpl = _TEMPLATES.get(event)
    if not tmpl:
        return
    d = data or {}
    await create_notification(
        db,
        hotel_id=hotel_id,
        user_id=user_id,
        type=event.value,
        category=tmpl["category"],
        title=_render(tmpl["title"], d),
        body=_render(tmpl["body"], d),
        deep_link=_render(tmpl["deep_link"], d),
    )
