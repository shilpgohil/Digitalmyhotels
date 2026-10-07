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


def test_discount_reason_accepted_in_booking_create() -> None:
    body = BookingCreate.model_validate({**_BASE, "discount_reason": "VIP repeat guest discount"})
    assert body.discount_reason == "VIP repeat guest discount"


def test_discount_reason_in_booking_out() -> None:
    import uuid
    from datetime import datetime
    from decimal import Decimal
    from app.schemas.booking import BookingOut

    data = {
        "id": uuid.uuid4(),
        "booking_number": "BK-0049",
        "status": "checked_out",
        "payment_status": "paid",
        "source": "walk_in",
        "check_in_date": TODAY,
        "check_out_date": TODAY + timedelta(days=1),
        "adults": 1,
        "children": 0,
        "room_count": 1,
        "discount_amount": Decimal("200.00"),
        "discount_reason": "Special manager discount",
        "tax_amount": Decimal("24.00"),
        "total_amount": Decimal("1000.00"),
        "advance_amount": Decimal("0.00"),
        "security_deposit": Decimal("0.00"),
        "due_amount": Decimal("0.00"),
        "special_requests": None,
        "primary_guest_id": uuid.uuid4(),
        "created_at": datetime.now(),
    }
    out = BookingOut.model_validate(data)
    assert out.discount_reason == "Special manager discount"

