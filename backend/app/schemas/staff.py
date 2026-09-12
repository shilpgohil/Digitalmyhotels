"""Staff attendance schemas (client 09/2026 staff check-in flow)."""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


DEPARTMENTS = ("reception", "housekeeping", "fnb", "maintenance", "management", "other")
EMPLOYMENT_TYPES = ("full_time", "part_time", "contract")
STAFF_STATUSES = ("active", "on_leave", "inactive")
# Access tiers from the Add New Staff mockup radio cards.
STAFF_ACCESS_ROLES = ("manager", "receptionist", "general_staff", "housekeeping")


class StaffCreate(BaseModel):
    # Personal
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str = Field(min_length=7, max_length=32)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=16)
    # Employment
    department: str = Field(pattern="^(reception|housekeeping|fnb|maintenance|management|other)$")
    designation: str | None = Field(default=None, max_length=120)
    employment_type: str = Field(default="full_time", pattern="^(full_time|part_time|contract)$")
    joining_date: date
    shift_start: time | None = None
    shift_end: time | None = None
    weekly_off: int | None = Field(default=None, ge=0, le=6)
    base_salary: Decimal | None = Field(default=None, ge=0)
    # Login & access
    access_role: str = Field(pattern="^(manager|receptionist|general_staff|housekeeping)$")
    temp_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def _shift_order(self) -> StaffCreate:
        if self.shift_start and self.shift_end and self.shift_end <= self.shift_start:
            raise ValueError("Shift end must be after shift start")
        return self


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=16)
    department: str | None = Field(
        default=None, pattern="^(reception|housekeeping|fnb|maintenance|management|other)$"
    )
    designation: str | None = Field(default=None, max_length=120)
    employment_type: str | None = Field(
        default=None, pattern="^(full_time|part_time|contract)$"
    )
    joining_date: date | None = None
    shift_start: time | None = None
    shift_end: time | None = None
    weekly_off: int | None = Field(default=None, ge=0, le=6)
    base_salary: Decimal | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(active|on_leave|inactive)$")
    access_role: str | None = Field(
        default=None, pattern="^(manager|receptionist|general_staff|housekeeping)$"
    )


class StaffOut(BaseModel):
    id: UUID
    user_id: UUID
    staff_code: str
    full_name: str
    email: str | None
    phone: str | None
    date_of_birth: date | None
    gender: str | None
    department: str
    designation: str | None
    employment_type: str
    joining_date: date
    shift_start: time | None
    shift_end: time | None
    weekly_off: int | None
    status: str
    role_code: str | None
    has_photo: bool = False
    # Present only for callers with staff.salary_view.
    base_salary: Decimal | None = None
    # Today's attendance chip for the Staff List.
    today_status: str | None = None


class StaffListOut(BaseModel):
    items: list[StaffOut]
    total: int


class CheckInIn(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    selfie_key: str | None = Field(default=None, max_length=512)


class FrontDeskRecordIn(BaseModel):
    action: str = Field(pattern="^(in|out)$")


class AttendanceCorrectionIn(BaseModel):
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    status: str | None = Field(
        default=None, pattern="^(present|late|absent|leave|off|holiday)$"
    )
    note: str = Field(min_length=3, max_length=1000)


class AttendanceRecordOut(ORMModel):
    id: UUID
    staff_profile_id: UUID
    work_date: date
    check_in_at: datetime | None
    check_out_at: datetime | None
    check_in_distance_m: Decimal | None
    check_out_distance_m: Decimal | None
    method_in: str | None
    method_out: str | None
    status: str
    late_minutes: int | None
    early_out_minutes: int | None
    note: str | None


class AttendanceRowOut(BaseModel):
    """A staff member's row on Today's Attendance / History tables."""

    record_id: UUID | None
    staff_profile_id: UUID
    staff_code: str
    full_name: str
    department: str
    work_date: date
    check_in_at: datetime | None
    check_out_at: datetime | None
    working_minutes: int | None
    late_minutes: int | None
    early_out_minutes: int | None
    status: str  # present|late|absent|leave|off|holiday|working|checked_out|not_checked_in
    method_in: str | None = None
    method_out: str | None = None


class TodayStatsOut(BaseModel):
    total: int
    present: int
    working: int
    checked_out: int
    absent: int
    late: int


class TodayAttendanceOut(BaseModel):
    stats: TodayStatsOut
    items: list[AttendanceRowOut]


class HistoryOut(BaseModel):
    items: list[AttendanceRowOut]
    total: int


class CalendarDayOut(BaseModel):
    day: date
    status: str | None  # None = no record / not scheduled
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    late_minutes: int | None = None


class CalendarOut(BaseModel):
    month: str  # YYYY-MM
    days: list[CalendarDayOut]
    present_days: int
    late_days: int
    absent_days: int
    leave_days: int


class AnomalyRowOut(BaseModel):
    staff_profile_id: UUID
    staff_code: str
    full_name: str
    department: str
    work_date: date
    check_in_at: datetime | None
    check_out_at: datetime | None
    expected_in: time | None
    late_minutes: int | None
    early_out_minutes: int | None
    missing_out: bool


class AnomaliesOut(BaseModel):
    late_count: int
    early_count: int
    missing_count: int
    avg_late_minutes: int
    items: list[AnomalyRowOut]


class RecordDetailOut(BaseModel):
    """Full evidence view of one attendance record (manager day-detail)."""

    id: UUID
    staff_profile_id: UUID
    staff_code: str
    full_name: str
    department: str
    work_date: date
    status: str
    check_in_at: datetime | None
    check_out_at: datetime | None
    method_in: str | None
    method_out: str | None
    check_in_distance_m: Decimal | None
    check_in_accuracy_m: Decimal | None
    check_out_distance_m: Decimal | None
    check_out_accuracy_m: Decimal | None
    late_minutes: int | None
    early_out_minutes: int | None
    working_minutes: int | None
    has_selfie: bool
    performed_by_name: str | None
    note: str | None


class LeaveCreate(BaseModel):
    from_date: date
    to_date: date
    leave_type: str = Field(default="annual", pattern="^(annual|sick|unpaid|other)$")
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _range(self) -> LeaveCreate:
        if self.to_date < self.from_date:
            raise ValueError("End date must be on or after start date")
        if (self.to_date - self.from_date).days > 60:
            raise ValueError("Leave range cannot exceed 60 days")
        return self


class LeaveDecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    note: str | None = Field(default=None, max_length=1000)


class LeaveOut(ORMModel):
    id: UUID
    staff_profile_id: UUID
    from_date: date
    to_date: date
    leave_type: str
    reason: str | None
    status: str
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime
    # Enriched (not ORM columns):
    staff_code: str | None = None
    full_name: str | None = None
    department: str | None = None


class LeaveListOut(BaseModel):
    items: list[LeaveOut]
    total: int


class SelfTodayOut(BaseModel):
    """Self-service state for /my-attendance and the profile check-in card."""

    staff_profile_id: UUID | None
    staff_code: str | None
    full_name: str
    department: str | None
    geofence_enabled: bool
    work_date: date
    check_in_at: datetime | None
    check_out_at: datetime | None
    working_minutes: int | None
    status: str  # not_checked_in | working | late | checked_out
