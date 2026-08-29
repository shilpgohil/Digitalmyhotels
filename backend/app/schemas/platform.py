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
    plan_code: str = "standard"
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
