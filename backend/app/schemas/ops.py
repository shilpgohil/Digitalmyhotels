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
    # Free-text "handover to" name (client Figma). Persisted in the snapshot
    # JSONB (no dedicated column) and populated by the API layer.
    to_name: str | None = None
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
    to_name: str | None = Field(default=None, max_length=200)
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


class DailyTrendItem(BaseModel):
    """One day's revenue + activity — used on the hotel dashboard."""
    date: date
    revenue: Decimal
    checkins: int
    checkouts: int


class DailyTrendOut(BaseModel):
    items: list[DailyTrendItem]
    total_revenue: Decimal
    total_checkins: int
    total_checkouts: int


class MonthlyTrendItem(BaseModel):
    """One month's platform stats — used on the super-admin dashboard."""
    month: str           # "YYYY-MM"
    hotels_added: int
    revenue: Decimal
    checkins: int


class PlatformTrendOut(BaseModel):
    items: list[MonthlyTrendItem]


class ArrivalsItem(BaseModel):
    booking_id: str
    booking_number: str
    guest_name: str
    rooms: list[str]
    check_in_time: str | None
    advance_paid: Decimal
    due_amount: Decimal


class ArrivalsOut(BaseModel):
    items: list[ArrivalsItem]
    total: int


# ── Smart Dashboard full payload ──────────────────────────────────────────────

class SmartInsight(BaseModel):
    """A rule-generated natural language insight for the hotel dashboard."""

    id: str                # stable string id for deduplication on frontend
    level: str             # "alert" | "warning" | "success" | "info"
    icon: str              # lucide-react icon name used on frontend
    title: str
    body: str              # the full insight sentence
    metric: str | None = None   # optional highlighted metric (e.g. "₹12,400")
    link: str | None = None     # deep-link for "take action" CTA


class HotelKpis(BaseModel):
    """Core hotel KPIs for the trailing 30-day window."""

    revpar: Decimal          # Revenue Per Available Room  = revenue / total_rooms
    adr: Decimal             # Average Daily Rate          = revenue / occupied_room_nights
    alos: Decimal            # Average Length of Stay      = total_nights / bookings
    lead_days: Decimal       # Average booking lead time (days: booking_date → check_in_date)
    no_show_rate: Decimal    # No-show % out of all confirmed+noshow bookings
    # Week-on-week % change for display (positive = better, negative = worse)
    revpar_wow: Decimal      # RevPAR vs same window 7 days prior
    revenue_wow: Decimal     # Revenue % change vs last week


class TrendPoint30(BaseModel):
    date: date
    revenue: Decimal
    checkins: int
    checkouts: int
    occupancy_pct: Decimal   # % of rooms occupied that night


class GuestMixItem(BaseModel):
    guest_type: str          # "Business" | "Leisure" | etc.
    count: int
    revenue: Decimal


class RoomTypeRevenue(BaseModel):
    room_type: str
    revenue: Decimal
    room_nights: int
    adr: Decimal


class WeekPatternItem(BaseModel):
    dow: str                 # "Mon" | "Tue" etc.
    avg_checkins: Decimal
    avg_revenue: Decimal


class SmartDashboardOut(BaseModel):
    """Single-call response for the hotel dashboard — all insight data."""

    insights: list[SmartInsight]
    kpis: HotelKpis
    trend_30d: list[TrendPoint30]
    guest_mix: list[GuestMixItem]
    room_type_revenue: list[RoomTypeRevenue]
    week_pattern: list[WeekPatternItem]
    today_occupancy_pct: Decimal
    total_rooms: int
    available_rooms: int
    in_house_count: int
    arrivals_today: int
    overdue_count: int


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


class RestaurantBillingRowOut(BaseModel):
    booking_number: str
    guest_name: str
    taxable_value: Decimal
    gst_rate: Decimal          # percent, e.g. 5.00
    gst_payable: Decimal
    final_price: Decimal
    charged_on: date


class RestaurantBillingOut(BaseModel):
    from_date: date
    to_date: date
    items: list[RestaurantBillingRowOut]
    total_amount: Decimal
    total_taxable: Decimal
    total_gst: Decimal


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
