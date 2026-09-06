from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ChargeCreate(BaseModel):
    booking_id: UUID
    category: str = Field(
        pattern="^(food|restaurant|laundry|room_service|extra_bed|minibar|transport|damage|other)$"
    )
    description: str = Field(min_length=2, max_length=255)
    quantity: int = Field(default=1, ge=1, le=999)
    rate: Decimal = Field(ge=0)
    apply_gst: bool = True


class ChargeOut(ORMModel):
    id: UUID
    booking_id: UUID
    category: str
    description: str
    quantity: int
    rate: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    created_at: datetime
    voided_at: datetime | None


class ChargeListOut(BaseModel):
    items: list[ChargeOut]
    total: int


class PaymentCreate(BaseModel):
    booking_id: UUID
    amount: Decimal = Field(gt=0)
    # cash/upi = core methods. card, bank_transfer, other = manual record only.
    method: str = Field(
        pattern="^(cash|upi|card|bank_transfer|other)$"
    )
    purpose: str = Field(default="stay", pattern="^(advance|stay|deposit|charge|other)$")
    reference: str | None = Field(default=None, max_length=128)
    notes: str | None = Field(default=None, max_length=1000)


class PaymentOut(ORMModel):
    id: UUID
    booking_id: UUID
    amount: Decimal
    method: str
    status: str
    purpose: str
    reference: str | None
    paid_at: datetime
    notes: str | None
    corrects_payment_id: UUID | None
    correction_reason: str | None


class PaymentListOut(BaseModel):
    items: list[PaymentOut]
    total: int


class PaymentCorrection(BaseModel):
    corrected_amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class RefundCreate(BaseModel):
    booking_id: UUID
    amount: Decimal = Field(gt=0)
    method: str = Field(pattern="^(cash|upi)$")
    payment_id: UUID | None = None
    reason: str = Field(min_length=3, max_length=1000)


class RefundOut(ORMModel):
    id: UUID
    booking_id: UUID
    payment_id: UUID | None
    amount: Decimal
    method: str
    status: str
    reason: str | None
    refunded_at: datetime


class LedgerEntryOut(ORMModel):
    id: UUID
    booking_id: UUID
    entry_type: str
    amount: Decimal
    balance_after: Decimal
    description: str
    reference_type: str | None
    created_at: datetime


class LedgerOut(BaseModel):
    items: list[LedgerEntryOut]
    balance: Decimal


class BillingHistoryRow(BaseModel):
    """One booking-level row for the Billing History table (whole rupees)."""

    booking_id: UUID
    booking_number: str
    guest_name: str | None
    room_rent: Decimal
    gst: Decimal
    discount: Decimal
    advance: Decimal
    balance: Decimal
    # Method of the most recent completed payment — None when nothing collected.
    mode: str | None
    payment_status: str


class BillingHistoryOut(BaseModel):
    items: list[BillingHistoryRow]
    total: int


class PaymentSummaryOut(BaseModel):
    total_collected: Decimal
    cash: Decimal
    upi: Decimal
    refunds: Decimal
    deposits: Decimal
    paid_bookings: int
    partial_bookings: int
    unpaid_bookings: int
    # ₹ amounts matching the booking-count definitions above (whole rupees):
    # collected on paid bookings, remaining due on partial, due on unpaid.
    paid_amount: Decimal = Decimal("0")
    partial_amount: Decimal = Decimal("0")
    pending_amount: Decimal = Decimal("0")
