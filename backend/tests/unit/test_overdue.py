"""Unit tests for the checkout-overdue rule (mirrors the frontend badge)."""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.services.overdue import is_checkout_overdue

IST = "Asia/Kolkata"


def _utc(y: int, mo: int, d: int, h: int, mi: int) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def test_not_overdue_before_checkout_time() -> None:
    # Due 2026-09-04 12:00 IST == 06:30 UTC; at 06:00 UTC not yet overdue.
    assert not is_checkout_overdue(
        date(2026, 9, 4), "12:00", IST, now_utc=_utc(2026, 9, 4, 6, 0)
    )


def test_overdue_after_checkout_time() -> None:
    # At 07:00 UTC (12:30 IST) the 12:00 IST checkout has passed.
    assert is_checkout_overdue(
        date(2026, 9, 4), "12:00", IST, now_utc=_utc(2026, 9, 4, 7, 0)
    )


def test_missing_time_falls_back_to_end_of_day() -> None:
    # No time → 23:59 local. At 17:00 UTC (22:30 IST) NOT overdue…
    assert not is_checkout_overdue(
        date(2026, 9, 4), None, IST, now_utc=_utc(2026, 9, 4, 17, 0)
    )
    # …but at 18:30 UTC (00:00 IST next day) it is.
    assert is_checkout_overdue(
        date(2026, 9, 4), None, IST, now_utc=_utc(2026, 9, 4, 18, 30)
    )


def test_past_date_is_overdue_regardless_of_time() -> None:
    assert is_checkout_overdue(
        date(2026, 9, 1), "12:00", IST, now_utc=_utc(2026, 9, 4, 0, 0)
    )


def test_future_date_never_overdue() -> None:
    assert not is_checkout_overdue(
        date(2026, 9, 10), "00:01", IST, now_utc=_utc(2026, 9, 4, 12, 0)
    )


def test_invalid_timezone_falls_back_safely() -> None:
    assert is_checkout_overdue(
        date(2026, 9, 1), "12:00", "Not/AZone", now_utc=_utc(2026, 9, 4, 0, 0)
    )


def test_garbage_time_falls_back_to_end_of_day() -> None:
    assert not is_checkout_overdue(
        date(2026, 9, 4), "garbage", IST, now_utc=_utc(2026, 9, 4, 12, 0)
    )
