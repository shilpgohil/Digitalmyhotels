import re
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ExpenseCategoryOut(ORMModel):
    id: UUID
    name: str
    is_active: bool


class ExpenseCategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class VendorOut(ORMModel):
    id: UUID
    name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    gstin: str | None
    category: str | None
    is_active: bool


class VendorCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=320)
    address: str | None = Field(default=None, max_length=2000)
    gstin: str | None = Field(default=None, max_length=15)
    pan: str | None = Field(default=None, max_length=10)
    category: str | None = Field(default=None, max_length=120)

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value: str | None) -> str | None:
        """Field-level GSTIN validation (client: generic error was useless).

        Same rule as hotel GST settings: 2-digit state code + 10-char PAN +
        entity code + 'Z' + checksum char. Empty string is treated as None.
        """
        if value is None or not value.strip():
            return None
        value = value.upper().strip()
        if not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]", value):
            raise ValueError(
                "Invalid GSTIN — expected 15 characters like 22AAAAA0000A1Z5 "
                "(2-digit state code, 10-character PAN, entity code, 'Z', checksum)"
            )
        return value

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.upper().strip()
        if not re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", value):
            raise ValueError("Invalid PAN — expected 10 characters like AAAAA0000A")
        return value


class ExpenseOut(ORMModel):
    id: UUID
    category_id: UUID | None
    vendor_id: UUID | None
    expense_date: date
    payment_date: date | None
    amount: Decimal
    taxable_amount: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    payment_method: str
    payment_status: str
    status: str
    description: str | None
    bill_number: str | None
    bill_date: date | None
    approved_at: datetime | None
    rejection_reason: str | None
    created_at: datetime
    # Internal storage key — excluded from API output; drives has_attachment.
    attachment_object_key: str | None = Field(default=None, exclude=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def has_attachment(self) -> bool:
        """Whether a receipt file is stored for this expense."""
        return self.attachment_object_key is not None


class ExpenseCreate(BaseModel):
    category_id: UUID | None = None
    vendor_id: UUID | None = None
    expense_date: date
    amount: Decimal = Field(gt=0)
    taxable_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    cgst_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    sgst_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    igst_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    payment_method: str = Field(default="cash", pattern="^(cash|upi|card|bank_transfer|other)$")
    description: str | None = Field(default=None, max_length=2000)
    bill_number: str | None = Field(default=None, max_length=64)
    bill_date: date | None = None
    submit: bool = False


class ExpenseRejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class ExpenseListOut(BaseModel):
    items: list[ExpenseOut]
    total: int


class RecurringExpenseOut(ORMModel):
    id: UUID
    name: str
    amount: Decimal
    frequency: str
    start_date: date
    end_date: date | None
    next_run_date: date
    is_active: bool
    category_id: UUID | None
    vendor_id: UUID | None


class RecurringExpenseCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    amount: Decimal = Field(gt=0)
    frequency: str = Field(pattern="^(monthly|quarterly|yearly|custom)$")
    custom_interval_days: int | None = Field(default=None, ge=1, le=365)
    start_date: date
    end_date: date | None = None
    category_id: UUID | None = None
    vendor_id: UUID | None = None
    reminder_days_before: int = Field(default=3, ge=0, le=30)
