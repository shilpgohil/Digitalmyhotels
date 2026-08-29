from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HousekeepingTaskOut(ORMModel):
    id: UUID
    room_id: UUID
    room_number: str | None = None
    booking_id: UUID | None
    status: str
    assigned_to_id: UUID | None
    started_at: datetime | None
    completed_at: datetime | None
    notes: str | None
    created_at: datetime


class HousekeepingAssign(BaseModel):
    assigned_to_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=2000)


class MaintenanceOut(ORMModel):
    id: UUID
    room_id: UUID
    room_number: str | None = None
    reason: str
    notes: str | None
    status: str
    expected_completion: datetime | None
    resolved_at: datetime | None
    created_at: datetime


class MaintenanceCreate(BaseModel):
    room_id: UUID
    reason: str = Field(min_length=3, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    expected_completion: datetime | None = None


class DailyClosingOut(ORMModel):
    id: UUID
    business_date: date
    status: str
    checkins_count: int
    checkouts_count: int
    current_guests_count: int
    occupancy_percent: Decimal
    cash_collected: Decimal
    upi_collected: Decimal
    total_revenue: Decimal
    total_expenses: Decimal
    refunds_total: Decimal
    dues_total: Decimal
    cash_balance: Decimal
    notes: str | None
    snapshot: dict | None
    closed_at: datetime | None
    reopened_at: datetime | None
    reopen_reason: str | None


class DailyClosingClose(BaseModel):
    cash_balance: Decimal | None = None
    notes: str | None = Field(default=None, max_length=2000)


class DailyClosingReopen(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class ShiftHandoverOut(ORMModel):
    id: UUID
    from_user_id: UUID
    to_user_id: UUID | None
    opening_cash: Decimal
    closing_cash: Decimal
    payments_collected: Decimal
    pending_payments: Decimal
    notes: str | None
    room_issues: str | None
    pending_issues: str | None
    confirmed: bool
    confirmed_at: datetime | None
    created_at: datetime


class ShiftHandoverCreate(BaseModel):
    to_user_id: UUID | None = None
    opening_cash: Decimal = Field(ge=0)
    closing_cash: Decimal = Field(ge=0)
    notes: str | None = Field(default=None, max_length=2000)
    room_issues: str | None = Field(default=None, max_length=2000)
    pending_issues: str | None = Field(default=None, max_length=2000)


class ReportQuery(BaseModel):
    from_date: date
    to_date: date


class OccupancyReportOut(BaseModel):
    from_date: date
    to_date: date
    total_rooms: int
    occupied_nights: int
    available_nights: int
    occupancy_percent: Decimal


class RevenueReportOut(BaseModel):
    from_date: date
    to_date: date
    room_revenue: Decimal
    charge_revenue: Decimal
    total_revenue: Decimal
    refunds: Decimal
    net_revenue: Decimal


class ExpenseReportOut(BaseModel):
    from_date: date
    to_date: date
    total: Decimal
    by_status: dict[str, Decimal]
    by_category: dict[str, Decimal]


class PaymentMethodReportOut(BaseModel):
    from_date: date
    to_date: date
    cash: Decimal
    upi: Decimal
    refunds_cash: Decimal
    refunds_upi: Decimal


class GstReportOut(BaseModel):
    from_date: date
    to_date: date
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    invoice_count: int


class GstBookingRowOut(BaseModel):
    booking_number: str
    guest_name: str
    invoice_number: str
    invoice_date: date
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    total: Decimal
    status: str


class GstByBookingOut(BaseModel):
    from_date: date
    to_date: date
    items: list[GstBookingRowOut]
    total_taxable: Decimal
    total_gst: Decimal
    total_amount: Decimal


class RoomUtilizationRowOut(BaseModel):
    room_number: str
    room_type_name: str
    floor: str | None
    occupied_nights: int
    available_nights: int
    occupancy_percent: Decimal
    revenue: Decimal


class RoomUtilizationOut(BaseModel):
    from_date: date
    to_date: date
    items: list[RoomUtilizationRowOut]
    by_room_type: dict[str, Decimal]   # room_type_name → avg occupancy %
