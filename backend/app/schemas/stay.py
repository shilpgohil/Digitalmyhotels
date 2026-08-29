from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class CoGuestIn(BaseModel):
    guest_id: UUID
    purpose_of_visit: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)


class CheckInRequest(BaseModel):
    booking_id: UUID
    checked_in_at: datetime | None = None
    expected_checkout_at: datetime | None = None
    co_guests: list[CoGuestIn] = Field(default_factory=list, max_length=20)
    purpose_of_visit: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    is_early: bool = False
    early_fee: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: str | None = Field(default=None, max_length=2000)
    # Digital acknowledgement of hotel terms (SRS §8).
    terms_acknowledged: bool = False


class CheckInOut(BaseModel):
    id: UUID
    booking_id: UUID
    booking_number: str
    checked_in_at: datetime
    expected_checkout_at: datetime | None
    is_early: bool
    early_fee: Decimal
    registration_numbers: list[str]


class CurrentGuestOut(BaseModel):
    booking_id: UUID
    booking_number: str
    primary_guest_name: str
    primary_guest_phone_masked: str
    rooms: list[str]
    checked_in_at: datetime
    expected_checkout_at: datetime | None
    check_out_date: date
    payment_status: str
    due_amount: Decimal
    guest_count: int


class CurrentGuestsListOut(BaseModel):
    items: list[CurrentGuestOut]
    total: int


class RoomTransferRequest(BaseModel):
    booking_id: UUID
    from_room_id: UUID
    to_room_id: UUID
    reason: str | None = Field(default=None, max_length=1000)


class RoomTransferOut(BaseModel):
    id: UUID
    booking_id: UUID
    from_room_number: str
    to_room_number: str
    transferred_at: datetime
    reason: str | None


class CheckOutRequest(BaseModel):
    booking_id: UUID
    checked_out_at: datetime | None = None
    is_late: bool = False
    late_fee: Decimal = Field(default=Decimal("0.00"), ge=0)
    # Checkout with outstanding balance requires explicit authorization.
    allow_due: bool = False
    due_reason: str | None = Field(default=None, max_length=1000)


class CheckOutOut(BaseModel):
    id: UUID
    booking_id: UUID
    booking_number: str
    checked_out_at: datetime
    nights: int
    final_total: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    refund_amount: Decimal
    is_late: bool
    late_fee: Decimal
    payment_due_authorized: bool


class CheckoutReversalRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
