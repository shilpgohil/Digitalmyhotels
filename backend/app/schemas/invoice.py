from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class InvoiceItemOut(ORMModel):
    id: UUID
    description: str
    quantity: int
    rate: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal


class InvoiceOut(ORMModel):
    id: UUID
    booking_id: UUID
    invoice_number: str
    invoice_date: date
    status: str
    guest_name: str
    guest_address: str | None
    subtotal: Decimal
    discount_amount: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    cancelled_at: datetime | None
    cancel_reason: str | None
    created_at: datetime
    items: list[InvoiceItemOut] = []


class InvoiceGenerateRequest(BaseModel):
    booking_id: UUID
    interstate: bool = False


class InvoiceCancelRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class InvoiceListOut(BaseModel):
    items: list[InvoiceOut]
    total: int
