export interface HotelOut {
  id: string;
  name: string;
  slug: string;
  logo_object_key: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  timezone: string;
  status: string;
}

export interface HotelSettingsOut {
  check_in_time: string;
  check_out_time: string;
  cancellation_policy: string | null;
  no_show_policy: string | null;
  invoice_prefix: string;
  invoice_next_number: number;
  booking_prefix: string;
  booking_next_number: number;
  tax_inclusive_pricing: boolean;
  currency: string;
  early_checkin_grace_minutes: number;
  late_checkout_grace_minutes: number;
  early_checkin_fee_per_hour: string;
  late_checkout_fee_per_hour: string;
  access_mode: "full" | "checkin_only";
}

export interface GstSettingsOut {
  is_gst_registered: boolean;
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address: string | null;
  state: string | null;
  state_code: string | null;
  default_cgst_rate: string;
  default_sgst_rate: string;
  default_igst_rate: string;
  version: number;
}

export interface PaymentConfigOut {
  upi_id: string | null;
  config_version: number;
  has_logo: boolean;
  qr_version: number;
}

export interface PaymentQrOut {
  qr_available: boolean;
  qr_version: number;
  payment_label: string;
}

export interface RoomTypeOut {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_price: string;
  extra_guest_price: string;
  hourly_rate: string | null;
  max_occupancy: number;
  is_active: boolean;
}

export interface RoomOut {
  id: string;
  room_number: string;
  floor: string | null;
  bed_type: string | null;
  status: RoomStatus;
  is_active: boolean;
  notes: string | null;
  room_type_id: string;
  room_type_name: string | null;
  amenities: string[];
}

// ── Date-aware availability ───────────────────────────────────────────────────

export interface RoomAvailableItem {
  id: string;
  room_number: string;
  floor: string | null;
  bed_type: string | null;
  status: RoomStatus;
  is_active: boolean;
  room_type_id: string;
  room_type_name: string | null;
  room_type_base_price: string;
  room_type_hourly_rate: string | null;
  max_occupancy: number;
  amenities: string[];
}

export type UnavailableReason =
  | "booked"
  | "occupied"
  | "cleaning"
  | "maintenance"
  | "out_of_service";

export interface RoomUnavailableItem extends RoomAvailableItem {
  unavailable_reason: UnavailableReason;
  /** ISO date string — when this room will next be free (for booked rooms). */
  occupied_until: string | null;
  overlapping_booking_count: number;
}

export interface RoomAvailabilityOut {
  check_in_date: string;
  check_out_date: string;
  available: RoomAvailableItem[];
  unavailable: RoomUnavailableItem[];
  total_rooms: number;
}

export type RoomStatus =
  | "available"
  | "reserved"
  | "occupied"
  | "cleaning_required"
  | "cleaning_in_progress"
  | "clean_ready"
  | "inspection_required"
  | "maintenance"
  | "out_of_service";

export interface RoomStatusSummaryOut {
  total: number;
  counts: Partial<Record<RoomStatus, number>>;
}

export interface TeamMemberOut {
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role_code: string;
  role_name: string;
  status: string;
  is_active: boolean;
  last_login_at: string | null;
}

export interface ListOut<T> {
  items: T[];
  total: number;
}
