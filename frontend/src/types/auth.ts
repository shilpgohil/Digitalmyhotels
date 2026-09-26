export interface UserOut {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  must_reset_password: boolean;
  last_login_at: string | null;
}

export interface MembershipOut {
  id: string;
  hotel_id: string;
  role_code: string;
  role_name: string;
  status: string;
  /**
   * Hotel-level feature gate (plan §feature-modes):
   *   "checkin_only"    → check-in / check-out only
   *   "checkin_expense" → all financial features, no staff/attendance
   *   "full"            → all features including staff management
   *
   * Returned by /auth/me so the sidebar never needs a separate settings call.
   */
  access_mode: "checkin_only" | "checkin_expense" | "full";
  hotel_status?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserOut;
  memberships: MembershipOut[];
}

export interface MeResponse {
  user: UserOut;
  memberships: MembershipOut[];
  permissions: string[];
}
