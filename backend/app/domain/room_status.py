"""Room status state machine.

Single source of truth for room lifecycle transitions. Services must go
through `assert_transition` rather than assigning statuses directly.
"""

from __future__ import annotations

from enum import StrEnum

from app.core.errors import ConflictError


class RoomStatus(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    OCCUPIED = "occupied"
    CLEANING_REQUIRED = "cleaning_required"
    CLEANING_IN_PROGRESS = "cleaning_in_progress"
    CLEAN_READY = "clean_ready"
    INSPECTION_REQUIRED = "inspection_required"
    MAINTENANCE = "maintenance"
    OUT_OF_SERVICE = "out_of_service"


# from -> allowed targets
TRANSITIONS: dict[RoomStatus, frozenset[RoomStatus]] = {
    RoomStatus.AVAILABLE: frozenset(
        {
            RoomStatus.RESERVED,
            RoomStatus.OCCUPIED,
            RoomStatus.MAINTENANCE,
            RoomStatus.OUT_OF_SERVICE,
        }
    ),
    RoomStatus.RESERVED: frozenset(
        {RoomStatus.OCCUPIED, RoomStatus.AVAILABLE, RoomStatus.MAINTENANCE}
    ),
    RoomStatus.OCCUPIED: frozenset(
        # Room transfer frees an occupied room straight to cleaning.
        {RoomStatus.CLEANING_REQUIRED}
    ),
    RoomStatus.CLEANING_REQUIRED: frozenset(
        {RoomStatus.CLEANING_IN_PROGRESS, RoomStatus.MAINTENANCE, RoomStatus.OUT_OF_SERVICE}
    ),
    RoomStatus.CLEANING_IN_PROGRESS: frozenset(
        {RoomStatus.CLEAN_READY, RoomStatus.INSPECTION_REQUIRED, RoomStatus.MAINTENANCE}
    ),
    RoomStatus.CLEAN_READY: frozenset(
        {RoomStatus.AVAILABLE, RoomStatus.INSPECTION_REQUIRED}
    ),
    RoomStatus.INSPECTION_REQUIRED: frozenset(
        {RoomStatus.AVAILABLE, RoomStatus.CLEANING_REQUIRED, RoomStatus.MAINTENANCE}
    ),
    RoomStatus.MAINTENANCE: frozenset(
        {RoomStatus.AVAILABLE, RoomStatus.CLEANING_REQUIRED, RoomStatus.OUT_OF_SERVICE}
    ),
    RoomStatus.OUT_OF_SERVICE: frozenset(
        {RoomStatus.AVAILABLE, RoomStatus.MAINTENANCE}
    ),
}

# Statuses in which a room can be allocated to a new booking/check-in.
ALLOCATABLE = frozenset({RoomStatus.AVAILABLE, RoomStatus.CLEAN_READY})


def can_transition(current: RoomStatus | str, target: RoomStatus | str) -> bool:
    cur = RoomStatus(current)
    tgt = RoomStatus(target)
    if cur == tgt:
        return True
    return tgt in TRANSITIONS.get(cur, frozenset())


def assert_transition(current: RoomStatus | str, target: RoomStatus | str) -> None:
    if not can_transition(current, target):
        raise ConflictError(
            f"Room cannot move from '{current}' to '{target}'",
            code="invalid_room_transition",
        )


def is_allocatable(status: RoomStatus | str) -> bool:
    return RoomStatus(status) in ALLOCATABLE
