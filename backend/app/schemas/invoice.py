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
    # Booking number shown alongside invoice number in the invoices list
    # (ss12: "Invoice ID wrong" — client needs to correlate INV-00013 ↔ BH-0013).
    booking_number: str | None = None
    guest_phone: str | None = None
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


class PublicInvoiceOut(BaseModel):
    """Public read-only invoice summary for customer viewing & 1-click PDF download."""

    id: UUID
    invoice_number: str
    invoice_date: date
    status: str
    booking_number: str | None = None
    guest_name: str
    guest_address: str | None = None
    guest_phone: str | None = None
    hotel_name: str
    hotel_address: str | None = None
    hotel_phone: str | None = None
    hotel_gstin: str | None = None
    room_numbers: str | None = None
    check_in_date: date | None = None
    check_in_time: str | None = None
    check_out_date: date | None = None
    check_out_time: str | None = None
    nights: int | None = None
    subtotal: Decimal
    discount_amount: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    items: list[InvoiceItemOut] = []
    pdf_url: str



class InvoiceGenerateRequest(BaseModel):
    booking_id: UUID
    interstate: bool = False


class InvoiceCancelRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class InvoiceListOut(BaseModel):
    items: list[InvoiceOut]
    total: int
