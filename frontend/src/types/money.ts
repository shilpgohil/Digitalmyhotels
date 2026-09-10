export interface PaymentOut {
  id: string;
  booking_id: string;
  amount: string;
  method: "cash" | "upi";
  status: string;
  purpose: string;
  reference: string | null;
  paid_at: string;
  notes: string | null;
  corrects_payment_id: string | null;
  correction_reason: string | null;
}

/** One booking-level row in the Payments page "Billing History" table. */
export interface BillingHistoryRow {
  booking_id: string;
  booking_number: string;
  guest_name: string | null;
  room_rent: string;
  gst: string;
  discount: string;
  advance: string;
  balance: string;
  mode: string | null;
  payment_status: string;
}

export interface BillingHistoryOut {
  items: BillingHistoryRow[];
  total: number;
}

export interface ChargeOut {
  id: string;
  booking_id: string;
  category: string;
  description: string;
  quantity: number;
  rate: string;
  taxable_amount: string;
  tax_amount: string;
  total_amount: string;
  created_at: string;
  voided_at: string | null;
}

export interface LedgerEntryOut {
  id: string;
  booking_id: string;
  entry_type: "debit" | "credit";
  amount: string;
  balance_after: string;
  description: string;
  reference_type: string | null;
  created_at: string;
}

export interface LedgerOut {
  items: LedgerEntryOut[];
  balance: string;
}

export interface InvoiceItemOut {
  id: string;
  description: string;
  quantity: number;
  rate: string;
  taxable_amount: string;
  tax_amount: string;
  total_amount: string;
}

export interface InvoiceOut {
  id: string;
  booking_id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  guest_name: string;
  guest_address: string | null;
  subtotal: string;
  discount_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  items: InvoiceItemOut[];
}

export interface ExpenseOut {
  id: string;
  category_id: string | null;
  vendor_id: string | null;
  expense_date: string;
  amount: string;
  payment_method: string;
  payment_status: string;
  status: string;
  description: string | null;
  bill_number: string | null;
  rejection_reason: string | null;
  has_attachment: boolean;
  created_at: string;
}

export interface ExpenseCategoryOut {
  id: string;
  name: string;
  is_active: boolean;
}

/** Stat-card totals for the expenses page (rejected excluded). */
export interface ExpenseSummaryOut {
  total_amount: string;
  today_amount: string;
  month_amount: string;
  entries: number;
}

export interface RecurringExpenseOut {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  start_date: string;
  next_run_date: string;
  is_active: boolean;
}

export interface HousekeepingTaskOut {
  id: string;
  room_id: string;
  room_number: string | null;
  booking_id: string | null;
  status: string;
  assigned_to_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceOut {
  id: string;
  room_id: string;
  reason: string;
  notes: string | null;
  status: string;
  created_at: string;
}

export interface DailyClosingOut {
  id: string;
  business_date: string;
  status: string;
  checkins_count: number;
  checkouts_count: number;
  current_guests_count: number;
  occupancy_percent: string;
  cash_collected: string;
  upi_collected: string;
  total_revenue: string;
  total_expenses: string;
  refunds_total: string;
  dues_total: string;
  cash_balance: string;
  notes: string | null;
  closed_at: string | null;
  /** Payments made today for bookings whose check-in was on a prior day.
   *  Desk should review before closing — these are legitimate (e.g. dues at
   *  checkout) but worth explicit sign-off. */
  backdated_payments_count: number;
  backdated_payments_amount: string;
}

export interface ShiftHandoverOut {
  id: string;
  /** Free-text "handover to" full name (may be absent on older rows). */
  to_name: string | null;
  opening_cash: string;
  closing_cash: string;
  payments_collected: string;
  pending_payments: string;
  notes: string | null;
  confirmed: boolean;
  created_at: string;
}

export interface OccupancyReportOut {
  from_date: string;
  to_date: string;
  total_rooms: number;
  occupied_nights: number;
  available_nights: number;
  occupancy_percent: string;
}

export interface RevenueReportOut {
  from_date: string;
  to_date: string;
  room_revenue: string;
  charge_revenue: string;
  total_revenue: string;
  refunds: string;
  net_revenue: string;
}

export interface PaymentMethodReportOut {
  from_date: string;
  to_date: string;
  cash: string;
  upi: string;
  refunds_cash: string;
  refunds_upi: string;
}

export interface GstReportOut {
  from_date: string;
  to_date: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  invoice_count: number;
}

export interface ExpenseReportOut {
  from_date: string;
  to_date: string;
  total: string;
  by_status: Record<string, string>;
  by_category: Record<string, string>;
}

export interface PlatformDashboardOut {
  total_hotels: number;
  active_hotels: number;
  inactive_hotels: number;
  trial_hotels: number;
  expired_hotels: number;
  total_users: number;
  expiring_soon: number;
  recently_expired: number;
  today_checkins: number;
  total_revenue: string;
}

export interface HotelAdminOut {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  subscription_status: string | null;
  subscription_plan_name: string | null;
  expiry_date: string | null;
  owner_name: string | null;
  owner_email: string | null;
}

export interface HotelAdminListOut {
  items: HotelAdminOut[];
  total: number;
  active: number;
  suspended: number;
  expired: number;
  trial: number;
  limit: number;
  offset: number;
}

export interface SubscriptionPlanOut {
  id: string;
  code: string;
  name: string;
  /** Feature list, one per line — edited by the Super Admin, rendered on the
   *  hotel's Choose Your Plan page (falls back to i18n defaults when empty). */
  description: string | null;
  price: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
}

/** Partner-side renewal request (subscription payment awaiting verification). */
export interface RenewalRequestOut {
  id: string;
  hotel_id: string;
  plan_id: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Super-admin view of a renewal request (with hotel/plan labels). */
export interface RenewalRequestAdminOut {
  id: string;
  hotel_id: string;
  hotel_name: string;
  plan_id: string;
  plan_name: string;
  duration_days: number;
  amount: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

export interface RenewalRequestAdminListOut {
  items: RenewalRequestAdminOut[];
  total: number;
}

/** Platform collection UPI details for the renewal payment modal. */
export interface SubscriptionPaymentInfoOut {
  configured: boolean;
  upi_id: string | null;
  payee_name: string | null;
}
