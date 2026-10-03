from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.core.tenant import TenantContext
from app.schemas.booking import BookingOut, BookingRoomOut
from app.schemas.payment import BillingHistoryOut, BillingHistoryRow
from app.services.bookings import export_bookings_csv
from app.services.expenses import export_expenses_csv
from app.services.payments import export_billing_history_csv


@pytest.fixture
def mock_tenant() -> TenantContext:
    return TenantContext(
        user_id=uuid4(),
        hotel_id=uuid4(),
        role="owner",
        is_super_admin=False,
    )


@pytest.mark.asyncio
async def test_export_bookings_csv(mock_tenant: TenantContext) -> None:
    db = AsyncMock()
    mock_booking_out = BookingOut(
        id=uuid4(),
        booking_number="BK-2026-0001",
        status="checked_out",
        payment_status="paid",
        source="walk_in",
        check_in_date=date(2026, 10, 1),
        check_out_date=date(2026, 10, 3),
        adults=2,
        children=0,
        room_count=1,
        discount_amount=Decimal("0.00"),
        tax_amount=Decimal("216.00"),
        total_amount=Decimal("2016.00"),
        advance_amount=Decimal("2016.00"),
        security_deposit=Decimal("0.00"),
        due_amount=Decimal("0.00"),
        special_requests=None,
        primary_guest_id=uuid4(),
        primary_guest_name="Aarav Sharma",
        primary_guest_phone="+919876543210",
        rooms=[
            BookingRoomOut(
                room_id=uuid4(),
                room_number="101",
                room_type_name="Deluxe",
                rate=Decimal("1800.00"),
                is_current=True,
            )
        ],
        created_at=datetime(2026, 10, 1, 10, 30, tzinfo=UTC),
    )

    with (
        patch("app.services.bookings.list_bookings", new_callable=AsyncMock) as mock_list,
        patch("app.services.bookings.to_out_many", new_callable=AsyncMock) as mock_to_out,
    ):
        mock_list.return_value = ([MagicMock()], 1)
        mock_to_out.return_value = [mock_booking_out]

        csv_str = await export_bookings_csv(
            db,
            mock_tenant,
            status="checked_out",
        )

        assert csv_str.startswith("\ufeff")
        lines = csv_str.lstrip("\ufeff").splitlines()
        assert len(lines) == 2
        header = lines[0].split(",")
        assert "Booking #" in header
        assert "Primary Guest" in header
        assert "Total Amount (INR)" in header

        row = lines[1]
        assert "BK-2026-0001" in row
        assert "Aarav Sharma" in row
        assert "\t+919876543210" in row
        assert "101 (Deluxe)" in row
        assert "Checked Out" in row
        assert "2016.00" in row


@pytest.mark.asyncio
async def test_export_expenses_csv(mock_tenant: TenantContext) -> None:
    db = AsyncMock()
    mock_expense = MagicMock(
        expense_date=date(2026, 10, 2),
        bill_number="BILL-9988",
        category_id=uuid4(),
        vendor_id=uuid4(),
        description="Bed linens purchase",
        amount=Decimal("4500.00"),
        taxable_amount=Decimal("3813.56"),
        cgst_amount=Decimal("343.22"),
        sgst_amount=Decimal("343.22"),
        igst_amount=Decimal("0.00"),
        payment_method="upi",
        status="approved",
        payment_status="paid",
        payment_date=date(2026, 10, 2),
    )

    cat_id = mock_expense.category_id
    vendor_id = mock_expense.vendor_id

    # Mock database executes for categories and vendors
    cat_mock_result = MagicMock()
    cat_mock_result.all.return_value = [(cat_id, "Laundry Supplies")]

    vendor_mock_result = MagicMock()
    vendor_mock_result.all.return_value = [(vendor_id, "Sharma Traders")]

    db.execute.side_effect = [cat_mock_result, vendor_mock_result]

    with patch("app.services.expenses.list_expenses", new_callable=AsyncMock) as mock_list:
        mock_list.return_value = ([mock_expense], 1)

        csv_str = await export_expenses_csv(
            db,
            mock_tenant,
            payment_method="upi",
        )

        assert csv_str.startswith("\ufeff")
        lines = csv_str.lstrip("\ufeff").splitlines()
        assert len(lines) == 2
        header = lines[0].split(",")
        assert "Bill #" in header
        assert "Category" in header
        assert "Vendor" in header

        row = lines[1]
        assert "2026-10-02" in row
        assert "\tBILL-9988" in row
        assert "Laundry Supplies" in row
        assert "Sharma Traders" in row
        assert "4500.00" in row
        assert "Upi" in row
        assert "Approved" in row


@pytest.mark.asyncio
async def test_export_billing_history_csv(mock_tenant: TenantContext) -> None:
    db = AsyncMock()
    mock_row = BillingHistoryRow(
        booking_id=uuid4(),
        booking_number="BK-5001",
        guest_name="Priya Patel",
        room_rent=Decimal("2500.00"),
        gst=Decimal("300.00"),
        discount=Decimal("0.00"),
        advance=Decimal("2800.00"),
        balance=Decimal("0.00"),
        mode="upi",
        payment_status="paid",
    )

    with patch("app.services.payments.billing_history", new_callable=AsyncMock) as mock_bh:
        mock_bh.return_value = BillingHistoryOut(items=[mock_row], total=1)

        csv_str = await export_billing_history_csv(
            db,
            mock_tenant,
            payment_mode="upi",
        )

        assert csv_str.startswith("\ufeff")
        lines = csv_str.lstrip("\ufeff").splitlines()
        assert len(lines) == 2
        header = lines[0].split(",")
        assert "Booking #" in header
        assert "Guest Name" in header
        assert "Room Rent (INR)" in header
        assert "Balance Due (INR)" in header

        row = lines[1]
        assert "BK-5001" in row
        assert "Priya Patel" in row
        assert "2500.00" in row
        assert "300.00" in row
        assert "2800.00" in row
        assert "0.00" in row
        assert "Upi" in row
        assert "Paid" in row
