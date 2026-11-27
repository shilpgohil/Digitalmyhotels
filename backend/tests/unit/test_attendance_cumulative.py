import uuid
from datetime import UTC, datetime, timedelta

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


def test_recheckin_preserves_initial_lateness_and_formats_local_note():
    """On-time morning arrival returning from lunch must stay 'present' (not 300m late)."""
    from datetime import time
    from zoneinfo import ZoneInfo

    from app.models.staff import StaffProfile
    from app.services.attendance import _apply_check_in, _apply_check_out, _prepare_recheckin

    ist = ZoneInfo("Asia/Kolkata")
    profile = StaffProfile(
        id=uuid.uuid4(),
        hotel_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        staff_code="STF-001",
        department="housekeeping",
        joining_date=datetime(2026, 11, 26, tzinfo=ist).date(),
        shift_start=time(9, 0),
        shift_end=time(18, 0),
    )
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=profile.hotel_id,
        staff_profile_id=profile.id,
        work_date=datetime(2026, 11, 26, tzinfo=ist).date(),
        accumulated_minutes=0,
    )

    # 1. Initial check-in at 09:05 IST (within 10m grace -> on time).
    t_in_1_local = datetime(2026, 11, 26, 9, 5, tzinfo=ist)
    is_re_1 = _apply_check_in(
        rec,
        profile,
        now_utc=t_in_1_local.astimezone(UTC),
        now_local=t_in_1_local,
        method="front_desk",
        grace_minutes=10,
    )
    assert is_re_1 is False
    assert rec.status == "present"
    assert rec.late_minutes is None
    assert rec.first_check_in_at == t_in_1_local.astimezone(UTC)

    # 2. Lunch check-out at 13:05 IST (240 mins worked).
    t_out_1_local = datetime(2026, 11, 26, 13, 5, tzinfo=ist)
    _apply_check_out(
        rec,
        profile,
        now_utc=t_out_1_local.astimezone(UTC),
        now_local=t_out_1_local,
        method="front_desk",
    )
    assert rec.accumulated_minutes == 240

    # 3. Re-check-in at 14:00 IST -> must keep status="present", late_minutes=None, IST prev out.
    _prepare_recheckin(rec, label="re-check-in via front desk", tz=ist)
    assert rec.check_out_at is None
    assert "prev out: 13:05" in (rec.note or "")

    t_in_2_local = datetime(2026, 11, 26, 14, 0, tzinfo=ist)
    is_re_2 = _apply_check_in(
        rec,
        profile,
        now_utc=t_in_2_local.astimezone(UTC),
        now_local=t_in_2_local,
        method="front_desk",
        grace_minutes=10,
    )
    assert is_re_2 is True
    assert rec.status == "present"
    assert rec.late_minutes is None
    assert rec.first_check_in_at == t_in_1_local.astimezone(UTC)
    assert rec.check_in_at == t_in_2_local.astimezone(UTC)

    # 4. Evening check-out at 18:00 IST (another 240 mins -> 480 total).
    t_out_2_local = datetime(2026, 11, 26, 18, 0, tzinfo=ist)
    _apply_check_out(
        rec,
        profile,
        now_utc=t_out_2_local.astimezone(UTC),
        now_local=t_out_2_local,
        method="front_desk",
    )
    assert rec.accumulated_minutes == 480
    assert _working_minutes(rec) == 480


def test_correct_attendance_blocks_self_edit_across_all_roles():
    """Owner, Manager, Admin, and Receptionist can NEVER edit their own attendance."""
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import pytest

    from app.core.errors import ForbiddenError
    from app.core.permissions import RoleCode
    from app.core.tenant import TenantContext
    from app.models.staff import StaffProfile
    from app.schemas.staff import AttendanceCorrectionIn
    from app.services.attendance import _apply_correction

    hotel = SimpleNamespace(id=uuid.uuid4(), timezone="Asia/Kolkata", attendance_grace_minutes=10)
    actor_user_id = uuid.uuid4()
    own_profile = StaffProfile(
        id=uuid.uuid4(),
        hotel_id=hotel.id,
        user_id=actor_user_id,
        staff_code="STF-002",
        department="management",
        joining_date=datetime.now(UTC).date(),
    )
    rec = AttendanceRecord(
        id=uuid.uuid4(),
        hotel_id=hotel.id,
        staff_profile_id=own_profile.id,
        work_date=datetime.now(UTC).date(),
        accumulated_minutes=0,
    )
    body = AttendanceCorrectionIn(
        check_in_at=datetime.now(UTC) - timedelta(hours=8),
        check_out_at=datetime.now(UTC),
        status="present",
        note="Forgot to check out",
    )

    for role in (RoleCode.OWNER, RoleCode.MANAGER, RoleCode.ADMIN, RoleCode.RECEPTIONIST):
        tenant = TenantContext(
            user_id=actor_user_id,
            hotel_id=hotel.id,
            role=role,
            is_super_admin=False,
        )
        with pytest.raises(ForbiddenError) as exc:
            asyncio.run(_apply_correction(AsyncMock(), tenant, hotel, rec, own_profile, body))  # type: ignore[arg-type]
        assert exc.value.code == "cannot_edit_own_attendance"
