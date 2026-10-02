"""Selfie archival and retention unit tests."""

from __future__ import annotations

from datetime import date
import hashlib

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
