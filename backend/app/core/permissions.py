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
    # Reveal the full decrypted ID number (Aadhaar/PAN/passport). Audited on
    # every use; never included in list/search/autofill responses.
    GUESTS_VIEW_FULL_ID = "guests.view_full_id"
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

    # Staff attendance (client 09/2026 staff check-in flow)
    STAFF_VIEW = "staff.view"
    STAFF_MANAGE = "staff.manage"
    STAFF_SALARY_VIEW = "staff.salary_view"
    STAFF_ATTENDANCE_SELF = "staff.attendance_self"
    STAFF_ATTENDANCE_VIEW = "staff.attendance_view"
    STAFF_ATTENDANCE_RECORD = "staff.attendance_record"
    STAFF_ATTENDANCE_CORRECT = "staff.attendance_correct"


class RoleCode(StrEnum):
    SUPER_ADMIN = "super_admin"
    OWNER = "owner"
    MANAGER = "manager"
    ADMIN = "admin"
    HOUSEKEEPING = "housekeeping"
    RECEPTIONIST = "receptionist"
    GENERAL_STAFF = "general_staff"


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
            Permission.GUESTS_VIEW_FULL_ID,
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
            Permission.STAFF_VIEW,
            Permission.STAFF_MANAGE,
            Permission.STAFF_SALARY_VIEW,
            Permission.STAFF_ATTENDANCE_SELF,
            Permission.STAFF_ATTENDANCE_VIEW,
            Permission.STAFF_ATTENDANCE_RECORD,
            Permission.STAFF_ATTENDANCE_CORRECT,
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
            Permission.GUESTS_VIEW_FULL_ID,
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
            # Staff module — manager runs day-to-day attendance (no salary).
            Permission.STAFF_VIEW,
            Permission.STAFF_MANAGE,
            Permission.STAFF_ATTENDANCE_SELF,
            Permission.STAFF_ATTENDANCE_VIEW,
            Permission.STAFF_ATTENDANCE_RECORD,
            Permission.STAFF_ATTENDANCE_CORRECT,
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
            # Reception verifies guest identity at the desk — full-ID reveal
            # is part of the confirmed product decision (audited every time).
            Permission.GUESTS_VIEW_FULL_ID,
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
            # Admin/Reception can view staff + record attendance at the desk.
            Permission.STAFF_VIEW,
            Permission.STAFF_ATTENDANCE_SELF,
            Permission.STAFF_ATTENDANCE_VIEW,
            Permission.STAFF_ATTENDANCE_RECORD,
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
            Permission.STAFF_ATTENDANCE_SELF,
        }
    ),
    # Front-desk staff account created from Add New Staff (access tier 2).
    RoleCode.RECEPTIONIST: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.HOTEL_VIEW_PAYMENT_QR,
            Permission.ROOMS_VIEW,
            Permission.ROOMS_UPDATE_STATUS,
            Permission.GUESTS_VIEW,
            Permission.GUESTS_MANAGE,
            Permission.GUESTS_VIEW_FULL_ID,
            Permission.BOOKINGS_VIEW,
            Permission.BOOKINGS_MANAGE,
            Permission.CHECKIN,
            Permission.CHECKOUT,
            Permission.ROOM_TRANSFER,
            Permission.PAYMENTS_COLLECT,
            Permission.PAYMENTS_VIEW,
            Permission.INVOICES_MANAGE,
            Permission.SHIFT_HANDOVER,
            Permission.NOTIFICATIONS_VIEW,
            Permission.STAFF_VIEW,
            Permission.STAFF_ATTENDANCE_SELF,
            Permission.STAFF_ATTENDANCE_VIEW,
            Permission.STAFF_ATTENDANCE_RECORD,
        }
    ),
    # Housekeeping/restaurant workers (access tier 3): own attendance only.
    RoleCode.GENERAL_STAFF: frozenset(
        {
            Permission.HOTEL_VIEW,
            Permission.NOTIFICATIONS_VIEW,
            Permission.STAFF_ATTENDANCE_SELF,
        }
    ),
}


# ── Notification/dashboard category visibility per role ──────────────────────
# Client 9-08 items 1/2/35: Housekeeping sees rooms/tasks/maintenance only;
# Reception sees front-desk operations; finance/admin/platform categories are
# Owner/Manager only. Shared by the notifications API AND the dashboard so the
# two can never disagree.
ALL_NOTIFICATION_CATEGORIES: frozenset[str] = frozenset(
    {"front_desk", "housekeeping", "finance", "operations", "admin", "platform"}
)

ROLE_NOTIFICATION_CATEGORIES: dict[RoleCode, frozenset[str]] = {
    RoleCode.SUPER_ADMIN: ALL_NOTIFICATION_CATEGORIES,
    RoleCode.OWNER: ALL_NOTIFICATION_CATEGORIES,
    RoleCode.MANAGER: ALL_NOTIFICATION_CATEGORIES,
    RoleCode.ADMIN: frozenset({"front_desk", "housekeeping", "operations"}),
    RoleCode.HOUSEKEEPING: frozenset({"housekeeping", "operations"}),
    RoleCode.RECEPTIONIST: frozenset({"front_desk", "operations"}),
    RoleCode.GENERAL_STAFF: frozenset({"operations"}),
}


def notification_categories_for_role(role: RoleCode | str | None) -> frozenset[str]:
    if role is None:
        return ALL_NOTIFICATION_CATEGORIES
    code = RoleCode(role) if not isinstance(role, RoleCode) else role
    return ROLE_NOTIFICATION_CATEGORIES.get(code, frozenset({"front_desk"}))


def permissions_for_role(role: RoleCode | str) -> frozenset[Permission]:
    code = RoleCode(role) if not isinstance(role, RoleCode) else role
    return ROLE_PERMISSIONS.get(code, frozenset())


def has_permission(role: RoleCode | str, permission: Permission | str) -> bool:
    perm = Permission(permission) if not isinstance(permission, Permission) else permission
    return perm in permissions_for_role(role)
