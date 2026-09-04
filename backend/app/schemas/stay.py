from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.booking import BookingCreate


class CoGuestIn(BaseModel):
    guest_id: UUID
    purpose_of_visit: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)


class ForeignGuestIn(BaseModel):
    """Form C fields for a foreign national (FRRO compliance)."""

    passport_number: str = Field(min_length=3, max_length=32)
    passport_place_of_issue: str | None = Field(default=None, max_length=120)
    passport_expiry: date | None = None
    visa_number: str | None = Field(default=None, max_length=40)
    visa_type: str | None = Field(default=None, max_length=40)
    visa_place_of_issue: str | None = Field(default=None, max_length=120)
    visa_expiry: date | None = None
    place_of_birth: str | None = Field(default=None, max_length=120)
    country_of_birth: str | None = Field(default=None, max_length=120)
    nationality: str | None = Field(default=None, max_length=120)
    arrived_in_india_on: date | None = None
    arrival_place: str | None = Field(default=None, max_length=120)
    coming_from_city: str | None = Field(default=None, max_length=120)
    coming_from_country: str | None = Field(default=None, max_length=120)
    next_destination: str | None = Field(default=None, max_length=120)
    next_destination_country: str | None = Field(default=None, max_length=120)
    purpose_of_visit: str | None = Field(default=None, max_length=200)


class ForeignGuestOut(ForeignGuestIn):
    guest_id: UUID


class SettlementPreviewOut(BaseModel):
    """Bill preview — identical math to the actual checkout."""

    room_subtotal: Decimal
    gst_amount: Decimal
    charges_total: Decimal
    late_fee: Decimal
    discount: Decimal
    final_total: Decimal
    advance_paid: Decimal
    security_deposit: Decimal
    effective_paid: Decimal
    due: Decimal
    refund: Decimal


class CheckinPaymentIn(BaseModel):
    """Advance collected at the desk during check-in (only sent when the
    staff ticks "Payment collected")."""

    amount: Decimal = Field(gt=0)
    method: str = Field(pattern="^(cash|upi|card|bank_transfer|other)$")


class CheckinChargeIn(BaseModel):
    """Charge applied at check-in time (service chips, extra charges)."""

    description: str = Field(min_length=2, max_length=255)
    amount: Decimal = Field(gt=0)
    category: str = Field(
        default="other",
        pattern="^(food|restaurant|laundry|room_service|extra_bed|minibar|transport|damage|other)$",
    )


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
    # Form C data when the primary guest is a foreign national.
    foreign_guest: ForeignGuestIn | None = None
    # Atomic extras — applied inside the SAME transaction as the check-in so a
    # network failure can never leave a guest checked in with missing charges
    # or an unrecorded payment.
    charges: list[CheckinChargeIn] = Field(default_factory=list, max_length=20)
    advance_payment: CheckinPaymentIn | None = None


class CheckInOut(BaseModel):
    id: UUID
    booking_id: UUID
    booking_number: str
    checked_in_at: datetime
    expected_checkout_at: datetime | None
    is_early: bool
    early_fee: Decimal
    registration_numbers: list[str]


class BookAndCheckInRequest(BaseModel):
    """Walk-in flow: create the booking and check the guest in atomically.

    Both operations run in one request/transaction — if check-in validation
    fails, the booking creation rolls back too (no orphan bookings).
    """

    booking: BookingCreate
    checked_in_at: datetime | None = None
    co_guests: list[CoGuestIn] = Field(default_factory=list, max_length=20)
    purpose_of_visit: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    terms_acknowledged: bool = False
    foreign_guest: ForeignGuestIn | None = None
    charges: list[CheckinChargeIn] = Field(default_factory=list, max_length=20)
    advance_payment: CheckinPaymentIn | None = None


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
