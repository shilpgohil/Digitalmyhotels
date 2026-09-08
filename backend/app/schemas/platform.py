from datetime import date, datetime
from decimal import Decimal
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
    duration_days: int
    trial_days: int
    is_active: bool


class SubscriptionPlanCreate(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    price: Decimal = Field(ge=0)
    duration_days: int = Field(ge=1, le=3650)
    trial_days: int = Field(default=14, ge=0, le=365)


class SubscriptionPlanUpdate(BaseModel):
    """Partial plan edit — deactivation hides a plan from new assignments
    without deleting it (client 9-08 item 27)."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
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
    owner_name: str | None
    owner_email: str | None
    owner_phone: str | None


class AdminHotelUpdate(BaseModel):
    """Super Admin edit of a hotel's profile (client 9-08 items 28/30)."""

    name: str | None = Field(default=None, min_length=2, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    address_line1: str | None = Field(default=None, max_length=255)
    # Backfills the OWNER user's phone so phone login works (item 30).
    owner_phone: str | None = Field(default=None, max_length=32)


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
    access_mode: str = "full"


class PlatformDashboardOut(BaseModel):
    total_hotels: int
    active_hotels: int
    inactive_hotels: int
    trial_hotels: int
    expired_hotels: int
    total_users: int
    expiring_soon: int
    today_checkins: int = 0
    total_revenue: Decimal = Decimal("0.00")
