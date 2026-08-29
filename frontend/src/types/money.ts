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
  created_at: string;
}

export interface ExpenseCategoryOut {
  id: string;
  name: string;
  is_active: boolean;
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
}

export interface ShiftHandoverOut {
  id: string;
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
  price: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
}
