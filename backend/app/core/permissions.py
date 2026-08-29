"""Permission codes and role defaults for DigitalMyHotels."""

from __future__ import annotations

from enum import StrEnum


class Permission(StrEnum):
    # Platform
    PLATFORM_MANAGE_HOTELS = "platform.manage_hotels"
    PLATFORM_MANAGE_SUBSCRIPTIONS = "platform.manage_subscriptions"
    PLATFORM_VIEW_REPORTS = "platform.view_reports"

    # Hotel settings / team
    HOTEL_VIEW = "hotel.view"
    HOTEL_MANAGE_SETTINGS = "hotel.manage_settings"
    HOTEL_MANAGE_TEAM = "hotel.manage_team"
    HOTEL_MANAGE_UPI = "hotel.manage_upi"
    HOTEL_VIEW_UPI_ID = "hotel.view_upi_id"
    HOTEL_VIEW_PAYMENT_QR = "hotel.view_payment_qr"

    # Rooms
    ROOMS_VIEW = "rooms.view"
    ROOMS_MANAGE = "rooms.manage"
    ROOMS_UPDATE_STATUS = "rooms.update_status"

    # Guests / bookings / stay
    GUESTS_VIEW = "guests.view"
    GUESTS_MANAGE = "guests.manage"
    BOOKINGS_VIEW = "bookings.view"
    BOOKINGS_MANAGE = "bookings.manage"
    CHECKIN = "stay.checkin"
    CHECKOUT = "stay.checkout"
    ROOM_TRANSFER = "stay.room_transfer"

    # Money
    PAYMENTS_COLLECT = "payments.collect"
    PAYMENTS_VIEW = "payments.view"
    PAYMENTS_REFUND = "payments.refund"
    PAYMENTS_CORRECT = "payments.correct"
    INVOICES_MANAGE = "invoices.manage"
    GST_MANAGE = "gst.manage"
    EXPENSES_CREATE = "expenses.create"
    EXPENSES_APPROVE = "expenses.approve"
    EXPENSES_VIEW = "expenses.view"
    FINANCIAL_REPORTS = "reports.financial"

    # Ops
    HOUSEKEEPING_MANAGE = "housekeeping.manage"
    MAINTENANCE_MANAGE = "maintenance.manage"
    DAILY_CLOSING = "ops.daily_closing"
    SHIFT_HANDOVER = "ops.shift_handover"
    REPORTS_VIEW = "reports.view"
    AUDIT_VIEW = "audit.view"
    NOTIFICATIONS_VIEW = "notifications.view"


class RoleCode(StrEnum):
    SUPER_ADMIN = "super_admin"
    OWNER = "owner"
    MANAGER = "manager"
    ADMIN = "admin"
    HOUSEKEEPING = "housekeeping"


ROLE_PERMISSIONS: dict[RoleCode, frozenset[Permission]] = {
    RoleCode.SUPER_ADMIN: frozenset(Permission),
    RoleCode.OWNER: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.HOTEL_MANAGE_SETTINGS,
            Permission.HOTEL_MANAGE_TEAM,
            Permission.HOTEL_MANAGE_UPI,
            Permission.HOTEL_VIEW_UPI_ID,
            Permission.HOTEL_VIEW_PAYMENT_QR,
            Permission.ROOMS_VIEW,
            Permission.ROOMS_MANAGE,
            Permission.ROOMS_UPDATE_STATUS,
            Permission.GUESTS_VIEW,
            Permission.GUESTS_MANAGE,
            Permission.BOOKINGS_VIEW,
            Permission.BOOKINGS_MANAGE,
            Permission.CHECKIN,
            Permission.CHECKOUT,
            Permission.ROOM_TRANSFER,
            Permission.PAYMENTS_COLLECT,
            Permission.PAYMENTS_VIEW,
            Permission.PAYMENTS_REFUND,
            Permission.PAYMENTS_CORRECT,
            Permission.INVOICES_MANAGE,
            Permission.GST_MANAGE,
            Permission.EXPENSES_CREATE,
            Permission.EXPENSES_APPROVE,
            Permission.EXPENSES_VIEW,
            Permission.FINANCIAL_REPORTS,
            Permission.HOUSEKEEPING_MANAGE,
            Permission.MAINTENANCE_MANAGE,
            Permission.DAILY_CLOSING,
            Permission.SHIFT_HANDOVER,
            Permission.REPORTS_VIEW,
            Permission.AUDIT_VIEW,
            Permission.NOTIFICATIONS_VIEW,
        }
    ),
    RoleCode.MANAGER: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.HOTEL_MANAGE_SETTINGS,
            # MANAGER cannot configure UPI or manage room types — owner only.
            Permission.HOTEL_VIEW_PAYMENT_QR,   # can view QR for payment collection
            Permission.ROOMS_VIEW,
            # Permission.ROOMS_MANAGE intentionally absent — only owner creates/edits room types
            Permission.ROOMS_UPDATE_STATUS,
            Permission.GUESTS_VIEW,
            Permission.GUESTS_MANAGE,
            Permission.BOOKINGS_VIEW,
            Permission.BOOKINGS_MANAGE,
            Permission.CHECKIN,
            Permission.CHECKOUT,
            Permission.ROOM_TRANSFER,
            Permission.PAYMENTS_COLLECT,
            Permission.PAYMENTS_VIEW,
            Permission.PAYMENTS_REFUND,
            Permission.PAYMENTS_CORRECT,
            Permission.INVOICES_MANAGE,
            Permission.GST_MANAGE,
            Permission.EXPENSES_CREATE,
            Permission.EXPENSES_APPROVE,
            Permission.EXPENSES_VIEW,
            Permission.FINANCIAL_REPORTS,
            Permission.HOUSEKEEPING_MANAGE,
            Permission.MAINTENANCE_MANAGE,
            Permission.DAILY_CLOSING,
            Permission.SHIFT_HANDOVER,
            Permission.REPORTS_VIEW,
            Permission.AUDIT_VIEW,
            Permission.NOTIFICATIONS_VIEW,
        }
    ),
    RoleCode.ADMIN: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.HOTEL_MANAGE_UPI,
            Permission.HOTEL_VIEW_UPI_ID,
            Permission.HOTEL_VIEW_PAYMENT_QR,
            Permission.ROOMS_VIEW,
            Permission.ROOMS_UPDATE_STATUS,
            Permission.GUESTS_VIEW,
            Permission.GUESTS_MANAGE,
            Permission.BOOKINGS_VIEW,
            Permission.BOOKINGS_MANAGE,
            Permission.CHECKIN,
            Permission.CHECKOUT,
            Permission.ROOM_TRANSFER,
            Permission.PAYMENTS_COLLECT,
            Permission.PAYMENTS_VIEW,
            Permission.INVOICES_MANAGE,
            Permission.EXPENSES_CREATE,
            Permission.EXPENSES_VIEW,   # can create → must also be able to view
            Permission.HOUSEKEEPING_MANAGE,
            Permission.SHIFT_HANDOVER,
            Permission.REPORTS_VIEW,
            Permission.NOTIFICATIONS_VIEW,
        }
    ),
    RoleCode.HOUSEKEEPING: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.HOTEL_VIEW_PAYMENT_QR,  # QR only — never raw UPI ID
            Permission.ROOMS_VIEW,
            Permission.ROOMS_UPDATE_STATUS,
            Permission.HOUSEKEEPING_MANAGE,
            Permission.MAINTENANCE_MANAGE,
            Permission.NOTIFICATIONS_VIEW,
        }
    ),
}


def permissions_for_role(role: RoleCode | str) -> frozenset[Permission]:
    code = RoleCode(role) if not isinstance(role, RoleCode) else role
    return ROLE_PERMISSIONS.get(code, frozenset())


def has_permission(role: RoleCode | str, permission: Permission | str) -> bool:
    perm = Permission(permission) if not isinstance(permission, Permission) else permission
    return perm in permissions_for_role(role)
