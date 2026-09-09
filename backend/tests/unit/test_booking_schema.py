"""BookingCreate accepts the live guest_type / source values the UI sends."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.booking import BookingCreate

TODAY = date.today()
_BASE = {
    "primary_guest_id": "00000000-0000-0000-0000-000000000001",
    "room_ids": ["00000000-0000-0000-0000-000000000002"],
    "check_in_date": TODAY,
    "check_out_date": TODAY + timedelta(days=1),
}


@pytest.mark.parametrize("guest_type", ["business", "personal", "family", "group", "other"])
def test_guest_type_accepts_live_ui_values(guest_type: str) -> None:
    body = BookingCreate.model_validate({**_BASE, "guest_type": guest_type})
    assert body.guest_type == guest_type


@pytest.mark.parametrize("guest_type", ["Business", "Leisure", "Wedding", "invalid", "PERSONAL"])
def test_guest_type_rejects_title_case_and_unknown(guest_type: str) -> None:
    with pytest.raises(ValidationError):
        BookingCreate.model_validate({**_BASE, "guest_type": guest_type})


def test_guest_type_optional() -> None:
    body = BookingCreate.model_validate(_BASE)
    assert body.guest_type is None


@pytest.mark.parametrize("source", ["walk_in", "advance", "online", "phone", "other"])
def test_source_accepts_allowed_values(source: str) -> None:
    body = BookingCreate.model_validate({**_BASE, "source": source})
    assert body.source == source


def test_source_rejects_unknown() -> None:
    with pytest.raises(ValidationError):
        BookingCreate.model_validate({**_BASE, "source": "ota"})
