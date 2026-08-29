"""Rich demo dataset for Meridian Court.

Run from backend/:  python -m scripts.seed_demo
Requires `python -m scripts.seed` to have run first (roles, hotel, owner).

Everything goes through the REAL service layer so every booking number,
room transition, ledger entry, GST amount and invoice is produced by the
same business rules the app enforces. Historical records are then
backdated (timestamps only) so dashboards and reports span the month.

Idempotent: skips if the marker guest already exists.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select

sys.path.insert(0, ".")

from app.core.permissions import RoleCode  # noqa: E402
from app.core.tenant import TenantContext  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    CheckIn,
    CheckOut,
    Hotel,
    HotelCharge,
    HotelServiceItem,
    Invoice,
    Payment,
    User,
)
from app.models.ops import HousekeepingTask  # noqa: E402
from app.repositories.hotels import get_or_create_gst_settings  # noqa: E402
from app.schemas.booking import BookingCreate  # noqa: E402
from app.schemas.expense import ExpenseCreate, RecurringExpenseCreate, VendorCreate  # noqa: E402
from app.schemas.guest import GuestCreate  # noqa: E402
from app.schemas.payment import ChargeCreate, PaymentCreate  # noqa: E402
from app.schemas.room import RoomCreate, RoomTypeCreate  # noqa: E402
from app.schemas.stay import CheckInRequest, CheckOutRequest  # noqa: E402
from app.services import bookings as bookings_service  # noqa: E402
from app.services import charges as charges_service  # noqa: E402
from app.services import expenses as expenses_service  # noqa: E402
from app.services import guests as guests_service  # noqa: E402
from app.services import housekeeping as hk_service  # noqa: E402
from app.services import invoices as invoices_service  # noqa: E402
from app.services import payments as payments_service  # noqa: E402
from app.services import rooms as rooms_service  # noqa: E402
from app.services import stay as stay_service  # noqa: E402
from app.services.subscriptions import (  # noqa: E402
    assign_plan,
    get_active_subscription,
    get_plan_by_code,
)

TODAY = date.today()
MARKER_PHONE = "9800000001"

ROOM_TYPES = [
    ("STD", "Standard Room", Decimal("1500.00"), Decimal("300.00"), 2),
    ("DLX", "Deluxe Room", Decimal("2500.00"), Decimal("500.00"), 3),
    ("STE", "Executive Suite", Decimal("4000.00"), Decimal("800.00"), 4),
]

ROOMS = [
    # (number, floor, type_code, bed_type)
    ("101", "1", "STD", "Queen Size"), ("102", "1", "STD", "Queen Size"),
    ("103", "1", "STD", "Twin"), ("104", "1", "DLX", "King Size"),
    ("105", "1", "DLX", "King Size"), ("201", "2", "STD", "Queen Size"),
    ("202", "2", "STD", "Twin"), ("203", "2", "DLX", "King Size"),
    ("204", "2", "DLX", "King Size"), ("205", "2", "STE", "King Size"),
    ("301", "3", "STD", "Queen Size"), ("302", "3", "DLX", "King Size"),
    ("303", "3", "DLX", "King Size"), ("304", "3", "STE", "King Size"),
    ("305", "3", "STE", "King Size"), ("401", "4", "DLX", "King Size"),
    ("402", "4", "STE", "King Size"), ("403", "4", "STD", "Twin"),
]

GUESTS = [
    ("Arjun Mehta", MARKER_PHONE, "Mumbai", "Aadhaar Card", "561234567890"),
    ("Sara Iyer", "9800000002", "Chennai", "Aadhaar Card", "561234567891"),
    ("Rahul Verma", "9800000003", "Delhi", "Passport", "P1234567"),
    ("Neha Shah", "9800000004", "Ahmedabad", "Aadhaar Card", "561234567892"),
    ("Karan Patel", "9800000005", "Surat", "Driving License", "GJ0520210001"),
    ("Priya Desai", "9800000006", "Pune", "Aadhaar Card", "561234567893"),
    ("Vikram Singh", "9800000007", "Jaipur", "Aadhaar Card", "561234567894"),
    ("Ananya Rao", "9800000008", "Bengaluru", "Passport", "P7654321"),
    ("Alok Sharma", "9800000009", "Lucknow", "Aadhaar Card", "561234567895"),
    ("Divya Nair", "9800000010", "Kochi", "Aadhaar Card", "561234567896"),
    ("Rohan Kulkarni", "9800000011", "Nagpur", "Driving License", "MH3120190042"),
    ("Ishita Bose", "9800000012", "Kolkata", "Aadhaar Card", "561234567897"),
]

SERVICES = [
    ("Airport Pickup", Decimal("600.00")),
    ("Extra Mattress", Decimal("200.00")),
    ("Breakfast Included", Decimal("250.00")),
    ("Dinner Included", Decimal("400.00")),
    ("Late Checkout", Decimal("300.00")),
]

VENDORS = [
    ("Local Mandi", "9822200001", None),
    ("CleanCo Distributors", "9822200002", "24AAHCC1234F1Z2"),
    ("FixIt Plumbers", "9822200003", None),
]


def _dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=UTC)


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        hotel = (
            await db.execute(select(Hotel).where(Hotel.slug == "meridian-court"))
        ).scalar_one_or_none()
        owner = (
            await db.execute(select(User).where(User.email == "owner@meridiancourt.in"))
        ).scalar_one_or_none()
        if hotel is None or owner is None:
            print("Base seed missing — run `python -m scripts.seed` first.")
            return

        tenant = TenantContext(
            user_id=owner.id, hotel_id=hotel.id, role=RoleCode.OWNER, is_super_admin=False
        )

        marker = await guests_service.list_guests(db, tenant, query="Arjun Mehta")
        if marker[1] > 0:
            print("Demo data already present — nothing to do.")
            return

        # --- Hotel configuration -------------------------------------------
        gst = await get_or_create_gst_settings(db, hotel.id)
        gst.is_gst_registered = True
        gst.gstin = "24AACHM1234F1Z5"
        gst.legal_name = "Meridian Court Hospitality Pvt Ltd"
        gst.trade_name = "The Meridian Court"
        gst.state = "Gujarat"
        gst.state_code = "24"

        for name, price in SERVICES:
            db.add(HotelServiceItem(hotel_id=hotel.id, name=name, price=price))

        sub = await get_active_subscription(db, hotel.id)
        if sub is None:
            plan = await get_plan_by_code(db, "standard")
            await assign_plan(db, hotel_id=hotel.id, plan=plan, trial=False)
            hotel.status = "active"
        await db.commit()

        # --- Rooms ----------------------------------------------------------
        type_by_code = {}
        for code, name, base, extra, occupancy in ROOM_TYPES:
            room_type = await rooms_service.create_room_type(
                db,
                tenant,
                RoomTypeCreate(
                    code=code,
                    name=name,
                    base_price=base,
                    extra_guest_price=extra,
                    max_occupancy=occupancy,
                ),
            )
            type_by_code[code] = room_type
        rooms = []
        for number, floor, code, bed in ROOMS:
            room = await rooms_service.create_room(
                db,
                tenant,
                RoomCreate(
                    room_number=number,
                    floor=floor,
                    bed_type=bed,
                    room_type_id=type_by_code[code].id,
                    amenities=["Wi-Fi", "AC", "TV"],
                ),
            )
            rooms.append(room)
        await db.commit()

        # --- Guests ----------------------------------------------------------
        guests = []
        for full_name, phone, city, id_type, id_number in GUESTS:
            guest = await guests_service.create_guest(
                db,
                tenant,
                GuestCreate(
                    full_name=full_name,
                    phone=phone,
                    city=city,
                    state=None,
                    country="India",
                    id_proof_type=id_type,
                    id_number=id_number,
                ),
            )
            guests.append(guest)
        await db.commit()

        # --- Completed stays over the past month ----------------------------
        # Each stay: booking → check-in → (charge) → payment → checkout →
        # invoice → housekeeping completed → backdate timestamps.
        past_rooms = rooms[:6]
        for index in range(10):
            room = past_rooms[index % len(past_rooms)]
            guest = guests[index % len(guests)]
            start = TODAY - timedelta(days=28 - index * 3)
            nights = 2 if index % 3 else 3
            end = start + timedelta(days=nights)
            booking = await bookings_service.create_booking(
                db,
                tenant,
                BookingCreate(
                    primary_guest_id=guest.id,
                    room_ids=[room.id],
                    check_in_date=start,
                    check_out_date=end,
                    adults=2 if index % 2 else 1,
                    children=1 if index % 4 == 0 else 0,
                    source="walk_in" if index % 2 else "phone",
                ),
            )
            await stay_service.check_in(
                db,
                tenant,
                CheckInRequest(booking_id=booking.id, terms_acknowledged=True),
            )
            if index % 2 == 0:
                await charges_service.add_charge(
                    db,
                    tenant,
                    ChargeCreate(
                        booking_id=booking.id,
                        category="food",
                        description="Dinner — room service",
                        quantity=2,
                        rate=Decimal("350.00"),
                    ),
                )
            await db.refresh(booking)
            with_dues = index == 4  # one authorized-dues checkout
            pay_amount = booking.due_amount if not with_dues else booking.due_amount / 2
            await payments_service.collect_payment(
                db,
                tenant,
                PaymentCreate(
                    booking_id=booking.id,
                    amount=pay_amount.quantize(Decimal("0.01")),
                    method="upi" if index % 2 else "cash",
                    reference=f"UTR2026{1000 + index}" if index % 2 else None,
                ),
            )
            await stay_service.check_out(
                db,
                tenant,
                CheckOutRequest(
                    booking_id=booking.id,
                    allow_due=with_dues,
                    due_reason="Corporate account — billed monthly" if with_dues else None,
                ),
            )
            await invoices_service.generate_invoice(db, tenant, booking.id)
            task = (
                await db.execute(
                    select(HousekeepingTask).where(
                        HousekeepingTask.booking_id == booking.id,
                        HousekeepingTask.status != "completed",
                    )
                )
            ).scalars().first()
            if task:
                await hk_service.complete_task(db, tenant, task.id)
            await db.commit()

            # Backdate the historical records.
            checkin_row = (
                await db.execute(select(CheckIn).where(CheckIn.booking_id == booking.id))
            ).scalar_one()
            checkin_row.checked_in_at = _dt(start, 14)
            checkout_row = (
                await db.execute(select(CheckOut).where(CheckOut.booking_id == booking.id))
            ).scalars().first()
            if checkout_row:
                checkout_row.checked_out_at = _dt(end, 11)
            for payment in (
                await db.execute(select(Payment).where(Payment.booking_id == booking.id))
            ).scalars():
                payment.paid_at = _dt(start, 15)
            for charge in (
                await db.execute(select(HotelCharge).where(HotelCharge.booking_id == booking.id))
            ).scalars():
                charge.created_at = _dt(start, 20)
            invoice_row = (
                await db.execute(select(Invoice).where(Invoice.booking_id == booking.id))
            ).scalars().first()
            if invoice_row:
                invoice_row.invoice_date = end
            await db.commit()

        # --- In-house stays right now ---------------------------------------
        for offset, (room, guest) in enumerate(zip(rooms[6:9], guests[6:9], strict=False)):
            start = TODAY - timedelta(days=offset)
            booking = await bookings_service.create_booking(
                db,
                tenant,
                BookingCreate(
                    primary_guest_id=guest.id,
                    room_ids=[room.id],
                    check_in_date=start,
                    check_out_date=TODAY + timedelta(days=2 + offset),
                    adults=2,
                    emergency_contact_name="Family contact",
                    emergency_contact_phone="9899900011",
                    vehicle_number=f"GJ01AB{1200 + offset}",
                    vehicle_type="Car",
                    parking_slot=f"P-{offset + 1}",
                ),
            )
            await stay_service.check_in(
                db,
                tenant,
                CheckInRequest(booking_id=booking.id, terms_acknowledged=True),
            )
            await db.refresh(booking)
            await payments_service.collect_payment(
                db,
                tenant,
                PaymentCreate(
                    booking_id=booking.id,
                    amount=(booking.due_amount / 2).quantize(Decimal("0.01")),
                    method="upi",
                    purpose="advance",
                    reference=f"UTR2026{2000 + offset}",
                ),
            )
            await db.commit()

        # --- Upcoming confirmed bookings --------------------------------------
        for offset, (room, guest) in enumerate(zip(rooms[9:12], guests[9:12], strict=False)):
            await bookings_service.create_booking(
                db,
                tenant,
                BookingCreate(
                    primary_guest_id=guest.id,
                    room_ids=[room.id],
                    check_in_date=TODAY + timedelta(days=2 + offset),
                    check_out_date=TODAY + timedelta(days=4 + offset),
                    adults=2,
                    source="phone",
                ),
            )
        await db.commit()

        # --- Expenses, vendors, recurring --------------------------------------
        categories = await expenses_service.list_categories(db, tenant)
        cat_by_name = {c.name: c for c in categories}
        vendor_rows = []
        for name, phone, gstin in VENDORS:
            vendor = await expenses_service.create_vendor(
                db, tenant, VendorCreate(name=name, phone=phone, gstin=gstin)
            )
            vendor_rows.append(vendor)

        expense_specs = [
            ("Food", "Daily vegetable & dairy restock", Decimal("3800.00"), 26, "paid", 0),
            ("Supplies", "Detergent & room amenities", Decimal("2150.00"), 22, "paid", 1),
            ("Laundry", "Bedsheet & towel laundry service", Decimal("3200.00"), 18, "paid", 1),
            ("Maintenance", "Plumbing fix — Room 108", Decimal("1800.00"), 14, "approved", 2),
            ("Staff Salary", "Housekeeping staff advance", Decimal("12000.00"), 10, "paid", None),
            ("Electricity", "Monthly electricity bill", Decimal("18500.00"), 8, "approved", None),
            ("Marketing", "Instagram ad campaign", Decimal("5000.00"), 6, "submitted", None),
            ("Internet", "Broadband monthly", Decimal("1499.00"), 4, "paid", None),
            ("Water", "Tanker supply", Decimal("900.00"), 2, "submitted", None),
            ("Transportation", "Guest airport drop fuel", Decimal("650.00"), 1, "draft", None),
        ]
        for cat_name, desc, amount, days_ago, target, vendor_idx in expense_specs:
            expense = await expenses_service.create_expense(
                db,
                tenant,
                ExpenseCreate(
                    category_id=cat_by_name.get(cat_name).id if cat_name in cat_by_name else None,
                    vendor_id=vendor_rows[vendor_idx].id if vendor_idx is not None else None,
                    expense_date=TODAY - timedelta(days=days_ago),
                    amount=amount,
                    payment_method="upi" if days_ago % 2 else "cash",
                    description=desc,
                    submit=target != "draft",
                ),
            )
            if target in ("approved", "paid"):
                await expenses_service.transition_expense(db, tenant, expense.id, "approved")
            if target == "paid":
                await expenses_service.transition_expense(db, tenant, expense.id, "paid")
        await expenses_service.create_recurring(
            db,
            tenant,
            RecurringExpenseCreate(
                name="Broadband subscription",
                amount=Decimal("1499.00"),
                frequency="monthly",
                start_date=TODAY.replace(day=1),
                category_id=cat_by_name["Internet"].id if "Internet" in cat_by_name else None,
            ),
        )
        await db.commit()

        print("Demo data seeded for Meridian Court:")
        print(f"  {len(ROOMS)} rooms across {len(ROOM_TYPES)} types")
        print(f"  {len(GUESTS)} guests · 10 completed stays · 3 in-house · 3 upcoming")
        print(f"  {len(expense_specs)} expenses · {len(VENDORS)} vendors · 1 recurring template")
        print("  GST registered · standard subscription active · 5 service items")


if __name__ == "__main__":
    asyncio.run(seed())
