"""Unit tests for time-aware stay overlap mathematics and invariants."""

from __future__ import annotations

from datetime import date


def is_overlap(
    d_in1: date,
    t_in1: str,
    d_out1: date,
    t_out1: str,
    d_in2: date,
    t_in2: str,
    d_out2: date,
    t_out2: str,
) -> bool:
    """Pure interval comparison matching the SQL/SQLAlchemy logic."""
    s1_starts_before_s2_ends = (d_in1 < d_out2) or (
        d_in1 == d_out2 and t_in1 < t_out2
    )
    s2_starts_before_s1_ends = (d_in2 < d_out1) or (
        d_in2 == d_out1 and t_in2 < t_out1
    )
    return s1_starts_before_s2_ends and s2_starts_before_s1_ends


def test_early_checkin_conflict_user_reported_bug() -> None:
    """User bug: Room 216 booked from 07:00 on 29/09/2026.
    Requested stay till 19:50 (or 11:00) on 29/09/2026 MUST overlap.
    """
    req_in = date(2026, 9, 26)
    req_out = date(2026, 9, 29)
    req_time_out = "19:50"

    exist_in = date(2026, 9, 29)
    exist_out = date(2026, 9, 30)
    exist_time_in = "07:00"

    # Requested checkout 19:50 vs Existing check-in 07:00 -> Overlap!
    assert is_overlap(
        req_in, "14:00", req_out, req_time_out,
        exist_in, exist_time_in, exist_out, "11:00",
    ) is True

    # Standard checkout 11:00 vs Existing check-in 07:00 -> Overlap!
    assert is_overlap(
        req_in, "14:00", req_out, "11:00",
        exist_in, exist_time_in, exist_out, "11:00",
    ) is True

    # Early checkout 06:30 vs Existing check-in 07:00 -> No overlap!
    assert is_overlap(
        req_in, "14:00", req_out, "06:30",
        exist_in, exist_time_in, exist_out, "11:00",
    ) is False


def test_standard_consecutive_stays_no_conflict() -> None:
    """Consecutive overnight stays: checkout 11:00, next checkin 14:00."""
    stay1_in = date(2026, 9, 26)
    stay1_out = date(2026, 9, 29)

    stay2_in = date(2026, 9, 29)
    stay2_out = date(2026, 10, 1)

    assert is_overlap(
        stay1_in, "14:00", stay1_out, "11:00",
        stay2_in, "14:00", stay2_out, "11:00",
    ) is False


def test_same_day_day_use_overlaps() -> None:
    """Same calendar day bookings."""
    today = date(2026, 9, 29)

    # 10:00 to 14:00 vs 12:00 to 16:00 -> Overlap
    assert is_overlap(
        today, "10:00", today, "14:00",
        today, "12:00", today, "16:00",
    ) is True

    # 10:00 to 13:00 vs 14:00 to 18:00 -> No overlap
    assert is_overlap(
        today, "10:00", today, "13:00",
        today, "14:00", today, "18:00",
    ) is False

    # Day-use morning 08:00 to 12:00 vs Overnight arrival 14:00 -> No overlap
    assert is_overlap(
        today, "08:00", today, "12:00",
        today, "14:00", date(2026, 9, 30), "11:00",
    ) is False
