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
  total_rooms?: number | null;
  map_id?: string | null;
  /** Staff-attendance geofence (client 09/2026) */
  geofence_enabled?: boolean;
  latitude?: string | null;
  longitude?: string | null;
  geofence_radius_m?: number;
  attendance_grace_minutes?: number;
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
  access_mode: "full" | "checkin_expense" | "checkin_only";
  collect_emergency_contact: boolean;
  collect_vehicle_details: boolean;
  /** "Powered by DigitalMyHotels" invoice branding (plan §3.8). */
  show_powered_by: boolean;
}

export interface HotelImageOut {
  id: string;
  position: number;
}

export interface GstSettingsOut {
  /** Client 09/2026 GST modes:
   *  - "no_gst": GST flow hidden everywhere in the partner system
   *  - "included_by_hotel": GST inside the price, never shown to customer
   *  - "included_by_customer": GST added on top and displayed */
  gst_mode: "no_gst" | "included_by_hotel" | "included_by_customer";
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
  max_adults: number | null;
  max_children: number | null;
  status: RoomStatus;
  is_active: boolean;
  notes: string | null;
  room_type_id: string;
  room_type_name: string | null;
  amenities: string[];
  // ── Derived reservation context (room-status redesign, 15/09) ─────────────
  /** A confirmed booking's stay window includes today (guest expected). */
  arriving_today: boolean;
  /** "HH:MM" expected arrival time for today's booking. */
  arrival_time: string | null;
  /** ISO date of the earliest FUTURE confirmed booking on this room. */
  next_booking_date: string | null;
  /** "HH:MM" check-in time of that future booking. */
  next_booking_time: string | null;
  /** Current in-house guest checks out today. */
  departing_today: boolean;
  /** "HH:MM" expected checkout time today. */
  departure_time: string | null;
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
  /** For currently-occupied rooms: ISO date of current guest's checkout. */
  current_checkout_date: string | null;
  /** For currently-occupied rooms: "HH:MM" checkout time (hotel local time). */
  current_checkout_time: string | null;
  /** Next confirmed booking starting on/after the requested checkout —
      "Booked from Sep 24, 14:00 — free for your dates". */
  next_booking_date: string | null;
  /** "HH:MM" check-in time of that next booking. */
  next_booking_time: string | null;
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
  /** "HH:MM" checkout time on the occupied_until date (hotel local). */
  occupied_until_time: string | null;
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
