/**
 * Permission codes mirrored from the backend (`app/core/permissions.py`).
 * UI gating only — the backend remains the security authority.
 */
export const PERMISSIONS = {
  platformManageHotels: "platform.manage_hotels",
  platformManageSubscriptions: "platform.manage_subscriptions",
  platformViewReports: "platform.view_reports",

  hotelView: "hotel.view",
  hotelManageSettings: "hotel.manage_settings",
  hotelManageTeam: "hotel.manage_team",
  hotelManageUpi: "hotel.manage_upi",
  hotelViewUpiId: "hotel.view_upi_id",
  hotelViewPaymentQr: "hotel.view_payment_qr",

  roomsView: "rooms.view",
  roomsManage: "rooms.manage",
  roomsUpdateStatus: "rooms.update_status",

  guestsView: "guests.view",
  guestsManage: "guests.manage",
  guestsViewFullId: "guests.view_full_id",
  bookingsView: "bookings.view",
  bookingsManage: "bookings.manage",
  checkin: "stay.checkin",
  checkout: "stay.checkout",
  roomTransfer: "stay.room_transfer",

  paymentsCollect: "payments.collect",
  paymentsView: "payments.view",
  paymentsRefund: "payments.refund",
  paymentsCorrect: "payments.correct",
  invoicesManage: "invoices.manage",
  gstManage: "gst.manage",
  expensesCreate: "expenses.create",
  expensesApprove: "expenses.approve",
  expensesView: "expenses.view",
  financialReports: "reports.financial",

  housekeepingManage: "housekeeping.manage",
  maintenanceManage: "maintenance.manage",
  dailyClosing: "ops.daily_closing",
  shiftHandover: "ops.shift_handover",
  reportsView: "reports.view",
  auditView: "audit.view",
  notificationsView: "notifications.view",

  // Staff attendance (client 09/2026 staff check-in flow)
  staffView: "staff.view",
  staffManage: "staff.manage",
  staffSalaryView: "staff.salary_view",
  staffAttendanceSelf: "staff.attendance_self",
  staffAttendanceView: "staff.attendance_view",
  staffAttendanceRecord: "staff.attendance_record",
  staffAttendanceCorrect: "staff.attendance_correct",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ---------------------------------------------------------------------------
// Notification category visibility by role (client 9-08 items 1, 2, 36)
// ---------------------------------------------------------------------------
/** Notification categories that each role is allowed to see.
 *  Owner and Manager see everything. Admin/Reception see operational
 *  categories. Housekeeping sees only housekeeping notifications.
 *  "platform" is never shown in the partner portal (super-admin only). */
const NOTIFICATION_CATEGORIES_ALL = [
  "front_desk",
  "housekeeping",
  "finance",
  "operations",
  "admin",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES_ALL)[number];

const ROLE_NOTIFICATION_CATEGORIES: Record<string, readonly NotificationCategory[]> = {
  owner: NOTIFICATION_CATEGORIES_ALL,
  manager: NOTIFICATION_CATEGORIES_ALL,
  admin: ["front_desk", "housekeeping", "operations"],
  housekeeping: ["housekeeping"],
  receptionist: ["front_desk", "operations"],
  general_staff: ["operations"],
};

/** Returns the notification categories visible for a given role_code.
 *  Falls back to front_desk + operations for unknown roles. */
export function notificationCategoriesForRole(
  roleCode: string,
): readonly string[] {
  return (
    ROLE_NOTIFICATION_CATEGORIES[roleCode] ?? ["front_desk", "operations"]
  );
}

/** Whether the role can see finance/admin-level metrics (RevPAR, ADR, etc.) */
export function canSeeFinanceMetrics(roleCode: string): boolean {
  return roleCode === "owner" || roleCode === "manager";
}
