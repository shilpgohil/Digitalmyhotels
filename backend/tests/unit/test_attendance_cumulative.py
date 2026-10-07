from datetime import UTC, datetime, timedelta
import uuid

from app.models.staff import AttendanceRecord
from app.services.attendance import _working_minutes


def test_working_minutes_none():
    assert _working_minutes(None) is None


def test_working_minutes_not_checked_in():
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=uuid.uuid4(),
        staff_profile_id=uuid.uuid4(),
        work_date=datetime.now(UTC).date(),
        check_in_at=None,
    )
    assert _working_minutes(rec) is None


def test_working_minutes_single_active_session():
    now = datetime.now(UTC)
    two_hours_ago = now - timedelta(minutes=120)
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=uuid.uuid4(),
        staff_profile_id=uuid.uuid4(),
        work_date=now.date(),
        check_in_at=two_hours_ago,
        check_out_at=None,
        accumulated_minutes=0,
    )
    mins = _working_minutes(rec)
    assert mins is not None
    assert 119 <= mins <= 121


def test_working_minutes_checked_out_session():
    now = datetime.now(UTC)
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=uuid.uuid4(),
        staff_profile_id=uuid.uuid4(),
        work_date=now.date(),
        check_in_at=now - timedelta(hours=5),
        check_out_at=now - timedelta(hours=1),
        accumulated_minutes=240,  # 4 hours
    )
    assert _working_minutes(rec) == 240


def test_working_minutes_cumulative_split_shift_active():
    """Morning session was 4 hours (240m). Staff re-checked in 45 minutes ago."""
    now = datetime.now(UTC)
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=uuid.uuid4(),
        staff_profile_id=uuid.uuid4(),
        work_date=now.date(),
        first_check_in_at=now - timedelta(hours=8),
        check_in_at=now - timedelta(minutes=45),
        check_out_at=None,
        accumulated_minutes=240,
    )
    mins = _working_minutes(rec)
    assert mins is not None
    assert 284 <= mins <= 286
