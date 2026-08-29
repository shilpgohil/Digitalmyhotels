from datetime import time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HotelOut(ORMModel):
    id: UUID
    name: str
    slug: str
    logo_object_key: str | None
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    country: str
    postal_code: str | None
    phone: str | None
    email: str | None
    website: str | None
    description: str | None
    timezone: str
    status: str


class ServiceItemOut(ORMModel):
    id: UUID
    name: str
    price: Decimal
    is_active: bool


class ServiceItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    price: Decimal = Field(ge=0)


class ServiceItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    price: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class HotelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    website: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    timezone: str | None = Field(default=None, max_length=64)


class HotelSettingsOut(ORMModel):
    check_in_time: time
    check_out_time: time
    cancellation_policy: str | None
    no_show_policy: str | None
    invoice_prefix: str
    invoice_next_number: int
    booking_prefix: str
    booking_next_number: int
    tax_inclusive_pricing: bool
    currency: str
    early_checkin_grace_minutes: int
    late_checkout_grace_minutes: int
    access_mode: str = "full"


class HotelSettingsUpdate(BaseModel):
    check_in_time: time | None = None
    check_out_time: time | None = None
    cancellation_policy: str | None = Field(default=None, max_length=4000)
    no_show_policy: str | None = Field(default=None, max_length=4000)
    invoice_prefix: str | None = Field(default=None, min_length=1, max_length=32)
    booking_prefix: str | None = Field(default=None, min_length=1, max_length=32)
    tax_inclusive_pricing: bool | None = None
    early_checkin_grace_minutes: int | None = Field(default=None, ge=0, le=720)
    late_checkout_grace_minutes: int | None = Field(default=None, ge=0, le=720)


class GstSettingsOut(ORMModel):
    is_gst_registered: bool
    gstin: str | None
    legal_name: str | None
    trade_name: str | None
    address: str | None
    state: str | None
    state_code: str | None
    default_cgst_rate: Decimal
    default_sgst_rate: Decimal
    default_igst_rate: Decimal
    version: int


class GstSettingsUpdate(BaseModel):
    is_gst_registered: bool | None = None
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    legal_name: str | None = Field(default=None, max_length=255)
    trade_name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=2000)
    state: str | None = Field(default=None, max_length=120)
    state_code: str | None = Field(default=None, min_length=2, max_length=2)
    default_cgst_rate: Decimal | None = Field(default=None, ge=0, le=50)
    default_sgst_rate: Decimal | None = Field(default=None, ge=0, le=50)
    default_igst_rate: Decimal | None = Field(default=None, ge=0, le=100)

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.upper().strip()
        import re

        # 15 chars: 2-digit state code, 10-char PAN, entity code, 'Z', checksum
        if not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]", value):
            raise ValueError("Invalid GSTIN format")
        return value

    @field_validator("state_code")
    @classmethod
    def validate_state_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not value.isdigit():
            raise ValueError("State code must be two digits")
        return value


class PaymentConfigOut(BaseModel):
    """Config view for Owner/Manager/Admin — includes the raw UPI ID."""

    upi_id: str | None
    config_version: int
    has_logo: bool
    qr_version: int


class PaymentConfigUpdate(BaseModel):
    upi_id: str = Field(min_length=3, max_length=256)

    @field_validator("upi_id")
    @classmethod
    def validate_upi(cls, value: str) -> str:
        import re

        value = value.strip()
        # handle@psp — conservative UPI VPA validation
        if not re.fullmatch(r"[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,64}", value):
            raise ValueError("Invalid UPI ID format (expected handle@psp)")
        return value


class PaymentQrOut(BaseModel):
    """Worker-safe response — never contains the raw UPI ID."""

    qr_available: bool
    qr_version: int
    payment_label: str
