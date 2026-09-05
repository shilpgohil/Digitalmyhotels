from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BookingRoomOut(BaseModel):
    room_id: UUID
    room_number: str
    room_type_name: str
    rate: Decimal
    is_current: bool


class BookingOut(ORMModel):
    id: UUID
    booking_number: str
    status: str
    payment_status: str
    source: str
    guest_type: str | None = None
    check_in_date: date
    check_out_date: date
    check_in_time: str | None = None
    check_out_time: str | None = None
    adults: int
    children: int
    room_count: int
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    advance_amount: Decimal
    security_deposit: Decimal
    due_amount: Decimal
    special_requests: str | None
    emergency_contact_name: str | None = None
    emergency_contact_relation: str | None = None
    emergency_contact_phone: str | None = None
    vehicle_number: str | None = None
    vehicle_type: str | None = None
    parking_slot: str | None = None
    primary_guest_id: UUID | None
    primary_guest_name: str | None = None
    primary_guest_phone: str | None = None
    rooms: list[BookingRoomOut] = []
    created_at: datetime


class BookingGuestDocOut(BaseModel):
    id: UUID
    document_type: str
    side: str | None


class BookingGuestOut(BaseModel):
    """Registered guest on a booking, with ID documents — view drawer data."""

    guest_id: UUID
    full_name: str
    phone_masked: str
    # Full contact + address for the completed-bookings detail view (client
    # explicitly asked for the real number and address, not the masked form).
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    is_primary: bool
    registration_number: str
    purpose_of_visit: str | None
    company_name: str | None
    id_proof_type: str | None
    documents: list[BookingGuestDocOut]


class RoomRateOverride(BaseModel):
    """Staff-edited room rate (per night; for day-use it's the whole stay)."""

    room_id: UUID
    rate: Decimal = Field(ge=0, le=Decimal("9999999999.99"))


class BookingCreate(BaseModel):
    primary_guest_id: UUID
    room_ids: list[UUID] = Field(min_length=1, max_length=10)
    rate_overrides: list[RoomRateOverride] = Field(default_factory=list, max_length=10)
    check_in_date: date
    check_out_date: date
    adults: int = Field(default=1, ge=1, le=40)
    children: int = Field(default=0, ge=0, le=40)
    source: str = Field(default="walk_in", max_length=64)
    guest_type: str | None = Field(default=None, max_length=32)
    check_in_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    check_out_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    special_requests: str | None = Field(default=None, max_length=2000)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    security_deposit: Decimal = Field(default=Decimal("0.00"), ge=0)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_relation: str | None = Field(default=None, max_length=100)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    vehicle_number: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=40)
    parking_slot: str | None = Field(default=None, max_length=40)
    confirm: bool = True

    @model_validator(mode="after")
    def check_dates(self) -> "BookingCreate":
        if self.check_out_date < self.check_in_date:
            raise ValueError("Check-out date must be after check-in date")
        if self.check_out_date == self.check_in_date:
            # Day-use booking: same-day is allowed ONLY with explicit times
            # and checkout strictly after check-in (hourly pricing applies).
            if not (
                self.check_in_time
                and self.check_out_time
                and self.check_out_time > self.check_in_time
            ):
                raise ValueError(
                    "Same-day (day-use) bookings require check-in and check-out "
                    "times, with check-out time after check-in time"
                )
        # The service layer will enforce no-past guard so the schema allows today
        # (edge case: booking created at midnight right before check-in).
        if self.rate_overrides:
            override_ids = {o.room_id for o in self.rate_overrides}
            if not override_ids.issubset(set(self.room_ids)):
                raise ValueError("rate_overrides may only reference rooms in room_ids")
            if len(override_ids) != len(self.rate_overrides):
                raise ValueError("Duplicate room in rate_overrides")
        return self


class BookingUpdate(BaseModel):
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    check_out_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    adults: int | None = Field(default=None, ge=1, le=40)
    children: int | None = Field(default=None, ge=0, le=40)
    special_requests: str | None = Field(default=None, max_length=2000)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_relation: str | None = Field(default=None, max_length=100)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    vehicle_number: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=40)
    parking_slot: str | None = Field(default=None, max_length=40)


class BookingCancel(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class BookingListOut(BaseModel):
    items: list[BookingOut]
    total: int
