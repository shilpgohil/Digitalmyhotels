"""Unit test: RecurringExpense schemas validate and default payment_method properly."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.expense import RecurringExpenseCreate, RecurringExpenseOut


def test_recurring_expense_out_defaults_payment_method() -> None:
    now = date.today()
    out = RecurringExpenseOut.model_validate({
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "WiFi",
        "amount": Decimal("1000.00"),
        "frequency": "monthly",
        "start_date": now,
        "end_date": None,
        "next_run_date": now,
        "is_active": True,
        "category_id": None,
        "vendor_id": None,
    })
    assert out.payment_method == "cash"


def test_recurring_expense_create_defaults_payment_method_to_cash() -> None:
    rec = RecurringExpenseCreate(
        name="Monthly WiFi",
        amount=Decimal("1500.00"),
        frequency="monthly",
        start_date=date.today(),
    )
    assert rec.payment_method == "cash"


@pytest.mark.parametrize(
    "mode",
    ["cash", "upi", "card", "credit_card", "debit_card", "bank_transfer", "other"],
)
def test_recurring_expense_create_accepts_valid_payment_modes(mode: str) -> None:
    rec = RecurringExpenseCreate(
        name="Electricity Bill",
        amount=Decimal("4500.00"),
        frequency="monthly",
        start_date=date.today(),
        payment_method=mode,
    )
    assert rec.payment_method == mode


def test_recurring_expense_create_rejects_invalid_payment_mode() -> None:
    with pytest.raises(ValidationError):
        RecurringExpenseCreate(
            name="Electricity Bill",
            amount=Decimal("4500.00"),
            frequency="monthly",
            start_date=date.today(),
            payment_method="bitcoin",
        )
