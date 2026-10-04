"""Selfie archival and retention unit tests."""

from __future__ import annotations

import hashlib
from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.hotel import HotelSettingsUpdate
from app.schemas.platform import AdminHotelUpdate
from app.schemas.staff import CalendarDayOut


class TestSelfieFingerprinting:
    def test_sha256_hash_deterministic(self) -> None:
        sample_bytes = b"fake-jpeg-binary-image-data-for-checkin"
        expected = hashlib.sha256(sample_bytes).hexdigest()
        assert len(expected) == 64
        assert expected == hashlib.sha256(sample_bytes).hexdigest()

    def test_hotel_settings_retention_days_validation(self) -> None:
        # Valid retention days: between 7 and 90
        update = HotelSettingsUpdate(attendance_selfie_retention_days=30)
        assert update.attendance_selfie_retention_days == 30

        update_max = HotelSettingsUpdate(attendance_selfie_retention_days=90)
        assert update_max.attendance_selfie_retention_days == 90

        # Invalid retention days: < 7 or > 90
        with pytest.raises(ValidationError):
            HotelSettingsUpdate(attendance_selfie_retention_days=5)

        with pytest.raises(ValidationError):
            HotelSettingsUpdate(attendance_selfie_retention_days=100)

    def test_admin_hotel_update_retention_days_validation(self) -> None:
        update = AdminHotelUpdate(attendance_selfie_retention_days=60)
        assert update.attendance_selfie_retention_days == 60

        with pytest.raises(ValidationError):
            AdminHotelUpdate(attendance_selfie_retention_days=3)

    def test_calendar_day_selfie_flushed_field(self) -> None:
        day = CalendarDayOut(day=date(2026, 10, 1), status="present", selfie_flushed=True)
        assert day.selfie_flushed is True

    def test_attendance_schemas_checkout_selfie_fields(self) -> None:
        from uuid import uuid4
        from app.schemas.staff import AttendanceRecordOut, AttendanceRowOut, RecordDetailOut

        sha = "b" * 64
        rec = AttendanceRecordOut(
            id=uuid4(),
            staff_profile_id=uuid4(),
            work_date=date(2026, 10, 4),
            check_in_at=None,
            check_out_at=None,
            check_in_distance_m=None,
            check_out_distance_m=None,
            method_in=None,
            method_out=None,
            status="present",
            late_minutes=None,
            early_out_minutes=None,
            note=None,
            has_selfie=True,
            has_checkout_selfie=True,
            check_out_selfie_sha256=sha,
        )
        assert rec.has_checkout_selfie is True
        assert rec.check_out_selfie_sha256 == sha

        row = AttendanceRowOut(
            record_id=uuid4(),
            staff_profile_id=uuid4(),
            staff_code="STF-01",
            full_name="John Doe",
            department="front_desk",
            work_date=date(2026, 10, 4),
            check_in_at=None,
            check_out_at=None,
            working_minutes=480,
            late_minutes=0,
            early_out_minutes=0,
            status="present",
            has_checkout_selfie=True,
            check_out_selfie_sha256=sha,
        )
        assert row.has_checkout_selfie is True
        assert row.check_out_selfie_sha256 == sha

        detail = RecordDetailOut(
            id=uuid4(),
            staff_profile_id=uuid4(),
            staff_code="STF-01",
            full_name="John Doe",
            department="front_desk",
            work_date=date(2026, 10, 4),
            status="present",
            check_in_at=None,
            check_out_at=None,
            method_in="self_geo",
            method_out="self_geo",
            check_in_distance_m=None,
            check_in_accuracy_m=None,
            check_out_distance_m=None,
            check_out_accuracy_m=None,
            late_minutes=None,
            early_out_minutes=None,
            working_minutes=480,
            has_selfie=True,
            has_checkout_selfie=True,
            check_out_selfie_sha256=sha,
            performed_by_name=None,
            note=None,
        )
        assert detail.has_checkout_selfie is True
        assert detail.check_out_selfie_sha256 == sha
