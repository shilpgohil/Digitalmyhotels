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
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
