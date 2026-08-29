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
