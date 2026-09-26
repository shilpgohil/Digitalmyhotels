from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class NotificationOut(ORMModel):
    id: UUID
    hotel_id: UUID | None
    type: str
    category: str = "front_desk"
    title: str
    body: str
    deep_link: str | None = None
    is_read: bool
    read_at: datetime | None
    created_at: datetime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    total: int
    unread: int
    # Categories this user's role may see — the bell renders its filter chips
    # from this list so Housekeeping never sees finance/admin chips.
    allowed_categories: list[str] = []


class AuditLogOut(ORMModel):
    id: UUID
    hotel_id: UUID | None
    actor_id: UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    before: dict | None
    after: dict | None
    correlation_id: str | None
    created_at: datetime


class AuditLogListOut(BaseModel):
    items: list[AuditLogOut]
    total: int


class SubscriptionPlanOut(ORMModel):
    id: UUID
    code: str
    name: str
    description: str | None
    price: Decimal
    # Optional MRP / original price — shown as strikethrough on the hotel
    # plan page.  NULL = no discount pricing shown.
    mrp_price: Decimal | None = None
    duration_days: int
    trial_days: int
    is_active: bool


class SubscriptionPlanCreate(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    price: Decimal = Field(ge=0)
    mrp_price: Decimal | None = Field(default=None, ge=0)
    duration_days: int = Field(ge=1, le=3650)
    trial_days: int = Field(default=14, ge=0, le=365)


class SubscriptionPlanUpdate(BaseModel):
    """Partial plan edit — deactivation hides a plan from new assignments
    without deleting it (client 9-08 item 27)."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
    mrp_price: Decimal | None = Field(default=None, ge=0)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    trial_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None


class AdminHotelDetailOut(BaseModel):
    id: UUID
    name: str
    city: str | None
    state: str | None
    phone: str | None
    email: str | None
    address_line1: str | None
    status: str
    created_at: datetime
    # GST info (client 9-10 rows 13/14: show complete hotel details)
    gstin: str | None = None
    is_gst_registered: bool = False
    # Feature gate (plan §feature-modes)
    access_mode: str = "full"
    # Owner
    owner_user_id: UUID | None = None  # enables direct password reset (client 09/2026)
    max_team_members: int = 5  # team cap (plan §7.1)
    owner_name: str | None
    owner_email: str | None
    owner_phone: str | None
    # Subscription summary
    subscription_plan_name: str | None = None
    subscription_status: str | None = None
    subscription_expiry: str | None = None


class AdminHotelUpdate(BaseModel):
    """Super Admin edit of a hotel's profile (client 9-08 items 28/30,
    expanded to include GSTIN per client 9-10 rows 13/14)."""

    name: str | None = Field(default=None, min_length=2, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    address_line1: str | None = Field(default=None, max_length=255)
    gstin: str | None = Field(default=None, max_length=15)
    # Backfills the OWNER user's phone so phone login works (item 30).
    owner_phone: str | None = Field(default=None, max_length=32)
    # Team size cap — super admin can raise per hotel (plan §7.1).
    max_team_members: int | None = Field(default=None, ge=1, le=100)
    # Feature module gate — SA can switch hotels between three tiers.
    access_mode: Literal["checkin_only", "checkin_expense", "full"] | None = None


class AdminCustomerSummaryOut(BaseModel):
    """Masked cross-hotel customer row (Super Admin All Customers, item 36)."""

    guest_id: UUID
    full_name: str
    phone_masked: str
    hotel_id: UUID
    hotel_name: str
    city: str | None
    id_proof_type: str | None
    id_last4: str | None
    created_at: datetime


class AdminCustomerListOut(BaseModel):
    items: list[AdminCustomerSummaryOut]
    total: int


class AdminCustomerDetailOut(BaseModel):
    """Full profile — served only by the audited detail action."""

    guest_id: UUID
    full_name: str
    phone: str | None
    email: str | None
    address: str | None
    city: str | None
    state: str | None
    country: str | None
    postal_code: str | None
    gender: str | None
    date_of_birth: date | None
    id_proof_type: str | None
    id_last4: str | None
    hotel_id: UUID
    hotel_name: str
    created_at: datetime


class SubscriptionOut(ORMModel):
    id: UUID
    hotel_id: UUID
    plan_id: UUID
    status: str
    start_date: date
    expiry_date: date
    grace_days: int
    payment_status: str
    allow_view_after_expiry: bool
    block_transactions_after_expiry: bool


class RenewalRequestCreate(BaseModel):
    plan_id: UUID
    # How the hotel paid (self-reported, SA verifies before approving).
    # Canonical values: upi | cash | bank_transfer | card | other
    payment_mode: str | None = Field(
        default=None,
        pattern="^(upi|cash|bank_transfer|card|other|manual)?$",
    )
    note: str | None = Field(default=None, max_length=500)


class RenewalRequestOut(ORMModel):
    id: UUID
    hotel_id: UUID
    plan_id: UUID
    amount: Decimal
    status: str
    note: str | None
    created_at: datetime
    decided_at: datetime | None


class RenewalRequestAdminOut(BaseModel):
    id: UUID
    hotel_id: UUID
    hotel_name: str
    plan_id: UUID
    plan_name: str
    duration_days: int
    amount: Decimal
    status: str
    payment_mode: str | None = None
    # Partner-entered transaction/receipt reference for super admin verification.
    note: str | None = None
    created_at: datetime
    decided_at: datetime | None = None


class RenewalRequestAdminListOut(BaseModel):
    items: list[RenewalRequestAdminOut]
    total: int


class SubscriptionPaymentInfoOut(BaseModel):
    """Platform collection UPI details for the renewal payment modal."""

    configured: bool
    upi_id: str | None = None
    payee_name: str | None = None


class SubscriptionAssign(BaseModel):
    plan_id: UUID
    start_date: date | None = None
    grace_days: int = Field(default=7, ge=0, le=90)


class SubscriptionExtend(BaseModel):
    """Custom short-period grant (client 09/2026): extend the current plan
    by N days without a paid renewal."""

    days: int = Field(ge=1, le=365)


class HotelAdminOut(ORMModel):
    id: UUID
    name: str
    slug: str
    city: str | None
    state: str | None
    phone: str | None = None
    status: str
    created_at: datetime
    subscription_status: str | None = None
    subscription_plan_name: str | None = None
    expiry_date: date | None = None
    owner_name: str | None = None
    owner_email: str | None = None


class HotelAdminListOut(BaseModel):
    items: list[HotelAdminOut]
    total: int
    active: int
    suspended: int
    expired: int
    trial: int
    limit: int = 20
    offset: int = 0


class CreateHotelRequest(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    city: str | None = None
    state: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    gstin: str | None = Field(default=None, max_length=15)
    address: str | None = Field(default=None, max_length=500)
    owner_full_name: str = Field(min_length=2, max_length=200)
    owner_email: EmailStr
    owner_password: str = Field(min_length=8)
    owner_phone: str | None = None
    # plan_code is optional; if omitted the hotel is created in "trial" state
    # without a subscription row (admin assigns a plan later via RenewDialog).
    plan_code: str | None = None
    access_mode: Literal["checkin_only", "checkin_expense", "full"] = "full"
    # Additional fields per Figma Add-Hotel form
    total_rooms: int | None = Field(default=None, ge=0)
    map_id: str | None = Field(default=None, max_length=255)
    # Team size cap — default 5 (client 15/09, plan §7.1).
    max_team_members: int = Field(default=5, ge=1, le=100)
    # GST type selection
    gst_type: str | None = None  # "included_by_hotel" | "included_by_customer" | "no_gst"
    # Payment setup
    merchant_name: str | None = Field(default=None, max_length=200)
    payment_url: str | None = Field(default=None, max_length=1024)


class PlatformDashboardOut(BaseModel):
    total_hotels: int
    active_hotels: int
    inactive_hotels: int
    trial_hotels: int
    expired_hotels: int
    total_users: int
    expiring_soon: int
    recently_expired: int = 0  # expired in last 30 days
    today_checkins: int = 0
    total_revenue: Decimal = Decimal("0.00")


class AdminRevenueRowOut(BaseModel):
    """Per-hotel revenue summary for the super-admin Total Revenue screen."""

    hotel_id: UUID
    hotel_name: str
    city: str | None = None
    revenue: Decimal
    payments_count: int


class AdminRevenueListOut(BaseModel):
    total_revenue: Decimal
    items: list[AdminRevenueRowOut]
    total: int


# ── Billing History ───────────────────────────────────────────────────────────

class BillingHistorySummaryOut(BaseModel):
    total_collected: Decimal
    this_month: Decimal
    cash: Decimal
    upi: Decimal
    card: Decimal
    other: Decimal


class BillingHistoryRowOut(BaseModel):
    subscription_id: UUID
    hotel_id: UUID
    hotel_name: str
    owner_name: str | None = None
    owner_phone: str | None = None
    payment_date: date
    plan_amount: Decimal
    plan_name: str
    plan_duration_days: int
    expiry_date: date
    payment_mode: str | None = None
    txn_ref: str | None = None


class BillingHistoryListOut(BaseModel):
    summary: BillingHistorySummaryOut
    items: list[BillingHistoryRowOut]
    total: int


# ── Platform Config (SA-managed settings) ────────────────────────────────────

class PlatformConfigOut(BaseModel):
    """SA-readable platform configuration."""
    platform_upi_id: str | None = None
    platform_upi_payee_name: str | None = None
    configured: bool = False


class PlatformConfigUpdate(BaseModel):
    """SA-writable platform configuration."""
    platform_upi_id: str | None = Field(default=None, max_length=200)
    platform_upi_payee_name: str | None = Field(default=None, max_length=200)


# ── SA Manual Payment ─────────────────────────────────────────────────────────

class SARecordPaymentRequest(BaseModel):
    """Super Admin manually records a subscription payment for a hotel.

    Immediately renews/extends the hotel's subscription without requiring
    the hotel to go through the renewal-request workflow. Used for offline
    payments (cash, bank transfer) or corrections.
    """
    hotel_id: UUID
    plan_code: str
    payment_mode: str = Field(
        default="manual",
        pattern="^(upi|cash|bank_transfer|card|manual|other)$",
    )
    txn_ref: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=500)
