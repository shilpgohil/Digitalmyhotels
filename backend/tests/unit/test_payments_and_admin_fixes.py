"""Unit tests for password reuse check, payment method labels, and active/trial filtering."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import uuid

import pytest

from app.core.errors import ValidationAppError
from app.core.security import hash_password
from app.services.auth import change_password
from app.services.payments import payment_method_label
from app.services.super_admin import _hotel_status_counts, list_hotels


class TestChangePasswordReuseGuard:
    @pytest.mark.asyncio
    async def test_rejects_same_password(self) -> None:
        user = SimpleNamespace(
            id=uuid.uuid4(),
            password_hash=hash_password("Admin@123"),
            must_reset_password=True,
        )
        db = AsyncMock()
        with pytest.raises(ValidationAppError) as exc_info:
            await change_password(db, user, "Admin@123", "Admin@123")  # type: ignore[arg-type]
        assert exc_info.value.code == "password_reuse"


class TestPaymentMethodLabel:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("cash", "Cash"),
            ("upi", "UPI"),
            ("card", "Card"),
            ("credit_card", "Credit Card"),
            ("debit_card", "Debit Card"),
            ("bank_transfer", "Net Banking"),
            ("net_banking", "Net Banking"),
            ("other", "Other"),
            ("manual", "Other"),
        ],
    )
    def test_known_methods(self, raw: str, expected: str) -> None:
        assert payment_method_label(raw) == expected


class TestSuperAdminActiveHotelsIncludesTrial:
    @pytest.mark.asyncio
    async def test_list_hotels_active_includes_trial_in_sql(self) -> None:
        from sqlalchemy.dialects import postgresql

        captured: list[str] = []

        class FakeScalars:
            def all(self):
                return []

        class FakeResult:
            def scalars(self):
                return FakeScalars()

            def scalar_one_or_none(self):
                return None

            def one(self):
                return SimpleNamespace(total=0, active=0, suspended=0, trial=0, expired=0)

        async def fake_execute(stmt):
            captured.append(
                str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
            )
            return FakeResult()

        async def fake_scalar(_stmt):
            return 0

        db = MagicMock()
        db.execute = AsyncMock(side_effect=fake_execute)
        db.scalar = AsyncMock(side_effect=fake_scalar)

        await list_hotels(db, status="active", limit=10, offset=0)
        assert any("'active'" in sql and "'trial'" in sql for sql in captured)

    @pytest.mark.asyncio
    async def test_counts_active_includes_trial(self) -> None:
        from sqlalchemy.dialects import postgresql

        captured: list[str] = []

        class FakeResult:
            def one(self):
                return SimpleNamespace(total=2, active=2, suspended=0, trial=1, expired=0)

        async def fake_execute(stmt):
            captured.append(
                str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
            )
            return FakeResult()

        db = MagicMock()
        db.execute = AsyncMock(side_effect=fake_execute)
        counts = await _hotel_status_counts(db)
        assert counts["active"] == 2
        assert any("'active'" in sql and "'trial'" in sql for sql in captured)
