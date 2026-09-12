/** Staff attendance types — mirrors backend/app/schemas/staff.py */

export const STAFF_DEPARTMENTS = [
  "reception",
  "housekeeping",
  "fnb",
  "maintenance",
  "management",
  "other",
] as const;
export type StaffDepartment = (typeof STAFF_DEPARTMENTS)[number];

export const STAFF_EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;
export type StaffEmploymentType = (typeof STAFF_EMPLOYMENT_TYPES)[number];

export const STAFF_ACCESS_ROLES = [
  "manager",
  "receptionist",
  "general_staff",
  "housekeeping",
] as const;
export type StaffAccessRole = (typeof STAFF_ACCESS_ROLES)[number];

export interface StaffOut {
  id: string;
  user_id: string;
  staff_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  department: StaffDepartment;
  designation: string | null;
  employment_type: StaffEmploymentType;
  joining_date: string;
  shift_start: string | null;
  shift_end: string | null;
  weekly_off: number | null;
  status: "active" | "on_leave" | "inactive";
  role_code: string | null;
  has_photo: boolean;
  /** Present only when the caller has staff.salary_view. */
  base_salary: string | null;
  today_status: string | null;
}

export interface StaffListOut {
  items: StaffOut[];
  total: number;
}

export interface AttendanceRecordOut {
  id: string;
  staff_profile_id: string;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_distance_m: string | null;
  check_out_distance_m: string | null;
  method_in: string | null;
  method_out: string | null;
  status: string;
  late_minutes: number | null;
  early_out_minutes: number | null;
  note: string | null;
}

export interface AttendanceRowOut {
  record_id: string | null;
  staff_profile_id: string;
  staff_code: string;
  full_name: string;
  department: StaffDepartment;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  working_minutes: number | null;
  late_minutes: number | null;
  early_out_minutes: number | null;
  status: string;
  method_in?: string | null;
  method_out?: string | null;
}

export interface TodayStatsOut {
  total: number;
  present: number;
  working: number;
  checked_out: number;
  absent: number;
  late: number;
}

export interface TodayAttendanceOut {
  stats: TodayStatsOut;
  items: AttendanceRowOut[];
}

export interface HistoryOut {
  items: AttendanceRowOut[];
  total: number;
}

export interface CalendarDayOut {
  day: string;
  status: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number | null;
}

export interface CalendarOut {
  month: string;
  days: CalendarDayOut[];
  present_days: number;
  late_days: number;
  absent_days: number;
  leave_days: number;
}

export interface AnomalyRowOut {
  staff_profile_id: string;
  staff_code: string;
  full_name: string;
  department: StaffDepartment;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  expected_in: string | null;
  late_minutes: number | null;
  early_out_minutes: number | null;
  missing_out: boolean;
}

export interface AnomaliesOut {
  late_count: number;
  early_count: number;
  missing_count: number;
  avg_late_minutes: number;
  items: AnomalyRowOut[];
}

export interface RecordDetailOut {
  id: string;
  staff_profile_id: string;
  staff_code: string;
  full_name: string;
  department: StaffDepartment;
  work_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  method_in: string | null;
  method_out: string | null;
  check_in_distance_m: string | null;
  check_in_accuracy_m: string | null;
  check_out_distance_m: string | null;
  check_out_accuracy_m: string | null;
  late_minutes: number | null;
  early_out_minutes: number | null;
  working_minutes: number | null;
  has_selfie: boolean;
  performed_by_name: string | null;
  note: string | null;
}

export const LEAVE_TYPES = ["annual", "sick", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface LeaveOut {
  id: string;
  staff_profile_id: string;
  from_date: string;
  to_date: string;
  leave_type: LeaveType;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  staff_code: string | null;
  full_name: string | null;
  department: string | null;
}

export interface LeaveListOut {
  items: LeaveOut[];
  total: number;
}

export interface SelfTodayOut {
  staff_profile_id: string | null;
  staff_code: string | null;
  full_name: string;
  department: string | null;
  geofence_enabled: boolean;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  working_minutes: number | null;
  status: "not_checked_in" | "working" | "late" | "checked_out";
}
