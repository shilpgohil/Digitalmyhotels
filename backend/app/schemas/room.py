from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RoomTypeOut(ORMModel):
    id: UUID
    code: str
    name: str
    description: str | None
    base_price: Decimal
    extra_guest_price: Decimal
    max_occupancy: int
    is_active: bool


class RoomTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    base_price: Decimal = Field(ge=0, le=Decimal("9999999999.99"))
    extra_guest_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    max_occupancy: int = Field(default=2, ge=1, le=20)


class RoomTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    base_price: Decimal | None = Field(default=None, ge=0)
    extra_guest_price: Decimal | None = Field(default=None, ge=0)
    max_occupancy: int | None = Field(default=None, ge=1, le=20)
    is_active: bool | None = None


class RoomOut(ORMModel):
    id: UUID
    room_number: str
    floor: str | None
    bed_type: str | None = None
    status: str
    is_active: bool
    notes: str | None
    room_type_id: UUID
    room_type_name: str | None = None
    amenities: list[str] = []


class RoomCreate(BaseModel):
    room_number: str = Field(min_length=1, max_length=32)
    floor: str | None = Field(default=None, max_length=32)
    bed_type: str | None = Field(default=None, max_length=40)
    room_type_id: UUID
    notes: str | None = Field(default=None, max_length=2000)
    amenities: list[str] = Field(default_factory=list, max_length=30)


class RoomUpdate(BaseModel):
    room_number: str | None = Field(default=None, min_length=1, max_length=32)
    floor: str | None = Field(default=None, max_length=32)
    bed_type: str | None = Field(default=None, max_length=40)
    room_type_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
    amenities: list[str] | None = Field(default=None, max_length=30)


class RoomStatusUpdate(BaseModel):
    status: str = Field(
        pattern="^(available|reserved|occupied|cleaning_required|cleaning_in_progress|"
        "clean_ready|inspection_required|maintenance|out_of_service)$"
    )
    reason: str | None = Field(default=None, max_length=500)


class RoomListOut(BaseModel):
    items: list[RoomOut]
    total: int


class RoomTypeListOut(BaseModel):
    items: list[RoomTypeOut]
    total: int


class RoomStatusSummaryOut(BaseModel):
    total: int
    counts: dict[str, int]


# ── Date-aware room availability ─────────────────────────────────────────────

class RoomAvailableItem(BaseModel):
    """A room that is free for the entire requested date range."""
    id: UUID
    room_number: str
    floor: str | None
    bed_type: str | None
    status: str
    is_active: bool
    room_type_id: UUID
    room_type_name: str | None
    room_type_base_price: Decimal
    max_occupancy: int
    amenities: list[str]


class RoomUnavailableItem(RoomAvailableItem):
    """A room that cannot be booked for the requested date range."""
    # "booked"  — has an overlapping active booking
    # "occupied" — currently checked-in, no future booking info yet
    # "cleaning" — cleaning_required / cleaning_in_progress / inspection_required
    # "maintenance" — maintenance status
    # "out_of_service" — out_of_service status
    unavailable_reason: str
    # For "booked": the latest checkout date among overlapping bookings.
    # Sorted ascending → earliest-free rooms appear first (best suggestions).
    occupied_until: date | None
    overlapping_booking_count: int


class RoomAvailabilityOut(BaseModel):
    """Response for GET /rooms/availability."""
    check_in_date: date
    check_out_date: date
    available: list[RoomAvailableItem]
    unavailable: list[RoomUnavailableItem]
    total_rooms: int
