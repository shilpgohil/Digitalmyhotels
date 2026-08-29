import pytest

from app.core.errors import ConflictError
from app.domain.room_status import (
    RoomStatus,
    assert_transition,
    can_transition,
    is_allocatable,
)


class TestCoreLifecycle:
    def test_booking_flow_transitions(self) -> None:
        # Confirmed booking → Reserved → Check-in → Occupied → Checkout → Cleaning
        assert can_transition(RoomStatus.AVAILABLE, RoomStatus.RESERVED)
        assert can_transition(RoomStatus.RESERVED, RoomStatus.OCCUPIED)
        assert can_transition(RoomStatus.OCCUPIED, RoomStatus.CLEANING_REQUIRED)
        assert can_transition(RoomStatus.CLEANING_REQUIRED, RoomStatus.CLEANING_IN_PROGRESS)
        assert can_transition(RoomStatus.CLEANING_IN_PROGRESS, RoomStatus.CLEAN_READY)
        assert can_transition(RoomStatus.CLEAN_READY, RoomStatus.AVAILABLE)

    def test_occupied_room_cannot_jump_to_available(self) -> None:
        assert not can_transition(RoomStatus.OCCUPIED, RoomStatus.AVAILABLE)
        with pytest.raises(ConflictError):
            assert_transition(RoomStatus.OCCUPIED, RoomStatus.AVAILABLE)

    def test_occupied_room_cannot_be_reserved(self) -> None:
        assert not can_transition(RoomStatus.OCCUPIED, RoomStatus.RESERVED)

    def test_maintenance_paths(self) -> None:
        assert can_transition(RoomStatus.AVAILABLE, RoomStatus.MAINTENANCE)
        assert can_transition(RoomStatus.MAINTENANCE, RoomStatus.AVAILABLE)
        assert can_transition(RoomStatus.MAINTENANCE, RoomStatus.OUT_OF_SERVICE)

    def test_same_status_is_noop(self) -> None:
        assert can_transition(RoomStatus.AVAILABLE, RoomStatus.AVAILABLE)


class TestAllocatability:
    def test_only_available_and_clean_ready_are_allocatable(self) -> None:
        assert is_allocatable(RoomStatus.AVAILABLE)
        assert is_allocatable(RoomStatus.CLEAN_READY)
        for status in (
            RoomStatus.OCCUPIED,
            RoomStatus.RESERVED,
            RoomStatus.MAINTENANCE,
            RoomStatus.OUT_OF_SERVICE,
            RoomStatus.CLEANING_REQUIRED,
        ):
            assert not is_allocatable(status), status
