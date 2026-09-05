export interface GuestOut {
  id: string;
  full_name: string;
  normalized_phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  gender: string | null;
  date_of_birth: string | null;
  id_proof_type: string | null;
  id_last4: string | null;
  id_verification_status: string;
  notes: string | null;
}

export interface GuestSearchResult {
  id: string;
  full_name: string;
  phone_masked: string;
  id_last4: string | null;
}

export interface GuestAutofill {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  gender: string | null;
  date_of_birth: string | null;
  id_proof_type: string | null;
  id_last4: string | null;
}

export interface BookingRoomOut {
  room_id: string;
  room_number: string;
  room_type_name: string;
  rate: string;
  is_current: boolean;
}

export interface BookingOut {
  id: string;
  booking_number: string;
  status: BookingStatus;
  payment_status: string;
  source: string;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  room_count: number;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  advance_amount: string;
  security_deposit: string;
  due_amount: string;
  special_requests: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relation: string | null;
  emergency_contact_phone: string | null;
  vehicle_number: string | null;
  vehicle_type: string | null;
  parking_slot: string | null;
  primary_guest_id: string | null;
  primary_guest_name: string | null;
  primary_guest_phone: string | null;
  rooms: BookingRoomOut[];
  created_at: string;
  guest_type?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
}

/** One uploaded document of a booking guest (GET /api/v1/bookings/{id}/guests). */
export interface BookingGuestDocOut {
  id: string;
  document_type: string;
  side: string | null;
}

/** Registered guest of a booking (GET /api/v1/bookings/{id}/guests). */
export interface BookingGuestOut {
  guest_id: string;
  full_name: string;
  phone_masked: string;
  /** Full contact number (unmasked) — completed-bookings detail view. */
  phone: string | null;
  /** Guest address — completed-bookings detail view. */
  address: string | null;
  is_primary: boolean;
  registration_number: string;
  purpose_of_visit: string | null;
  company_name: string | null;
  id_proof_type: string | null;
  documents: BookingGuestDocOut[];
}

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface CurrentGuestOut {
  booking_id: string;
  booking_number: string;
  primary_guest_name: string;
  primary_guest_phone_masked: string;
  rooms: string[];
  checked_in_at: string;
  expected_checkout_at: string | null;
  check_in_date: string;
  check_out_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  payment_status: string;
  due_amount: string;
  guest_count: number;
}

export interface GuestCreatePayload {
  full_name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  gender?: string;
  date_of_birth?: string;
  id_proof_type?: string;
  id_number?: string;
}

/** Staff-edited room rate — per night, or whole stay for day use. */
export interface RoomRateOverride {
  room_id: string;
  rate: string;
}

/** Booking payload nested inside BookAndCheckInRequest (mirrors backend BookingCreate). */
export interface BookingCreatePayload {
  primary_guest_id: string;
  room_ids: string[];
  rate_overrides?: RoomRateOverride[];
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  guest_type?: string | null;
  /** "HH:MM" */
  check_in_time?: string | null;
  /** "HH:MM" */
  check_out_time?: string | null;
  special_requests?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relation?: string | null;
  emergency_contact_phone?: string | null;
  vehicle_number?: string | null;
  vehicle_type?: string | null;
  parking_slot?: string | null;
}

/**
 * Form C details for a foreign national (FRRO compliance).
 * Mirrors backend ForeignGuestIn — dates are YYYY-MM-DD strings.
 */
export interface ForeignGuestIn {
  passport_number: string;
  passport_place_of_issue?: string | null;
  passport_expiry?: string | null;
  visa_number?: string | null;
  visa_type?: string | null;
  visa_place_of_issue?: string | null;
  visa_expiry?: string | null;
  place_of_birth?: string | null;
  country_of_birth?: string | null;
  nationality?: string | null;
  arrived_in_india_on?: string | null;
  arrival_place?: string | null;
  coming_from_city?: string | null;
  coming_from_country?: string | null;
  next_destination?: string | null;
  next_destination_country?: string | null;
  purpose_of_visit?: string | null;
}

/** Co-guest sent with a check-in — optionally with their own Form C details. */
export interface CoGuestIn {
  guest_id: string;
  foreign_guest?: ForeignGuestIn | null;
}

/** Extra charge applied atomically inside the check-in transaction. */
export interface CheckInChargeIn {
  description: string;
  amount: string;
  category?: string;
}

/** Advance payment recorded atomically inside the check-in transaction. */
export interface CheckInAdvancePaymentIn {
  amount: string;
  method: string;
}

/** POST /api/v1/checkins/book-and-checkin — walk-in flow: book + check in atomically. */
export interface BookAndCheckInRequest {
  booking: BookingCreatePayload;
  checked_in_at?: string | null;
  co_guests: CoGuestIn[];
  purpose_of_visit?: string | null;
  company_name?: string | null;
  notes?: string | null;
  terms_acknowledged: boolean;
  foreign_guest?: ForeignGuestIn | null;
  charges?: CheckInChargeIn[];
  advance_payment?: CheckInAdvancePaymentIn | null;
}

/** POST /api/v1/checkins — existing-booking check-in (mirrors backend CheckInRequest). */
export interface CheckInRequest {
  booking_id: string;
  checked_in_at?: string | null;
  expected_checkout_at?: string | null;
  co_guests: CoGuestIn[];
  purpose_of_visit?: string | null;
  company_name?: string | null;
  is_early?: boolean;
  early_fee?: string;
  notes?: string | null;
  terms_acknowledged: boolean;
  foreign_guest?: ForeignGuestIn | null;
  charges?: CheckInChargeIn[];
  advance_payment?: CheckInAdvancePaymentIn | null;
  /** Staff correction of expected checkout time ("HH:MM"), stored on the booking. */
  check_out_time?: string | null;
}

export interface CheckInCreateOut {
  id: string;
  booking_id: string;
  booking_number: string;
  checked_in_at: string;
  registration_numbers: string[];
}

/**
 * GET /api/v1/checkouts/{booking_id}/preview — server-computed settlement.
 * All values are decimal strings. `final_total` = room_subtotal + GST-on-rooms
 * + charges_total (tax-inclusive) + late_fee − discount. `gst_amount` combines
 * room GST and charge taxes. `effective_paid` = advance_paid + security_deposit.
 * `due`/`refund` are already clamped to ≥ 0.
 */
export interface SettlementPreviewOut {
  room_subtotal: string;
  gst_amount: string;
  charges_total: string;
  late_fee: string;
  discount: string;
  final_total: string;
  advance_paid: string;
  security_deposit: string;
  effective_paid: string;
  due: string;
  refund: string;
}

export interface CheckOutOut {
  id: string;
  booking_id: string;
  booking_number: string;
  checked_out_at: string;
  nights: number;
  final_total: string;
  paid_amount: string;
  due_amount: string;
  refund_amount: string;
  is_late: boolean;
  late_fee: string;
  payment_due_authorized: boolean;
}
