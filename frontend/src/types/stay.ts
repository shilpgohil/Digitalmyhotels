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
  check_out_date: string;
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
  postal_code?: string;
  gender?: string;
  date_of_birth?: string;
  id_proof_type?: string;
  id_number?: string;
}

export interface CheckInCreateOut {
  id: string;
  booking_id: string;
  booking_number: string;
  checked_in_at: string;
  registration_numbers: string[];
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
