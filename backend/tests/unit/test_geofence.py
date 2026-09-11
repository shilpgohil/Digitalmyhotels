"""Geofence enforcement unit tests — the security-critical path."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.errors import ValidationAppError
from app.domain.geo import haversine_m
from app.services.attendance import MAX_ACCURACY_GRACE_M, enforce_geofence

# Hotel Shilp Gohil-ish coordinates (Ahmedabad).
HOTEL_LAT = 23.046
HOTEL_LNG = 72.531


def make_hotel(*, enabled: bool = True, radius: int = 200, lat=HOTEL_LAT, lng=HOTEL_LNG):
    return SimpleNamespace(
        geofence_enabled=enabled,
        latitude=lat,
        longitude=lng,
        geofence_radius_m=radius,
    )


class TestHaversine:
    def test_zero_distance(self):
        assert haversine_m(HOTEL_LAT, HOTEL_LNG, HOTEL_LAT, HOTEL_LNG) == 0

    def test_known_distance_100m(self):
        # ~0.0009 degrees latitude ≈ 100 m
        d = haversine_m(HOTEL_LAT, HOTEL_LNG, HOTEL_LAT + 0.0009, HOTEL_LNG)
        assert 90 < d < 110

    def test_known_distance_1km(self):
        d = haversine_m(HOTEL_LAT, HOTEL_LNG, HOTEL_LAT + 0.009, HOTEL_LNG)
        assert 950 < d < 1050


class TestEnforceGeofence:
    def test_inside_fence_returns_distance(self):
        d = enforce_geofence(make_hotel(), HOTEL_LAT + 0.0009, HOTEL_LNG, 10)
        assert d is not None and 90 < d < 110

    def test_outside_fence_rejected_with_distance(self):
        # ~1 km away, 200 m radius → blocked.
        with pytest.raises(ValidationAppError) as exc:
            enforce_geofence(make_hotel(), HOTEL_LAT + 0.009, HOTEL_LNG, 5)
        assert exc.value.code == "geofence_violation"
        assert " m from the property" in str(exc.value)

    def test_toggle_off_skips_fence_entirely(self):
        # Disabled → no coordinates needed, returns None.
        assert enforce_geofence(make_hotel(enabled=False), None, None, None) is None
        # Even a far-away position passes when the toggle is off.
        assert enforce_geofence(make_hotel(enabled=False), 0.0, 0.0, None) is None

    def test_unconfigured_coordinates_fail_open(self):
        assert enforce_geofence(make_hotel(lat=None, lng=None), None, None, None) is None

    def test_location_required_when_enabled(self):
        with pytest.raises(ValidationAppError) as exc:
            enforce_geofence(make_hotel(), None, None, None)
        assert exc.value.code == "location_required"

    def test_accuracy_grace_is_capped(self):
        # 1 km away with a 5000 m "accuracy" must NOT pass a 200 m fence:
        # grace caps at MAX_ACCURACY_GRACE_M (100 m) → 200+100 < 1000.
        with pytest.raises(ValidationAppError):
            enforce_geofence(make_hotel(), HOTEL_LAT + 0.009, HOTEL_LNG, 5000)
        assert MAX_ACCURACY_GRACE_M == 100.0

    def test_accuracy_grace_helps_borderline_fix(self):
        # ~250 m away, radius 200, accuracy 80 → 200+80=280 ≥ 250 → allowed.
        d = enforce_geofence(make_hotel(), HOTEL_LAT + 0.00225, HOTEL_LNG, 80)
        assert d is not None and 230 < d < 270

    def test_custom_radius_respected(self):
        # 450 m away passes a 500 m fence, fails a 200 m fence.
        lat = HOTEL_LAT + 0.004
        assert enforce_geofence(make_hotel(radius=500), lat, HOTEL_LNG, 0) is not None
        with pytest.raises(ValidationAppError):
            enforce_geofence(make_hotel(radius=200), lat, HOTEL_LNG, 0)
