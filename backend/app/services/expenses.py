from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.models.expense import Expense, ExpenseCategory, RecurringExpense, Vendor
from app.schemas.expense import (
    ExpenseCategoryCreate,
    ExpenseCreate,
    RecurringExpenseCreate,
    VendorCreate,
)
from app.services.audit import write_audit

# Allowed transitions of the approval workflow.
EXPENSE_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"submitted"}),
    "submitted": frozenset({"approved", "rejected"}),
    "approved": frozenset({"paid"}),
    "rejected": frozenset({"submitted"}),
    "paid": frozenset(),
}

DEFAULT_CATEGORIES = (
    "Electricity",
    "Water",
    "Internet",
    "Staff Salary",
    "Maintenance",
    "Cleaning",
    "Laundry",
    "Food",
    "Supplies",
    "Marketing",
    "Transportation",
    "Other",
)


# --- Categories -------------------------------------------------------------


async def list_categories(
    db: AsyncSession, tenant: TenantContext, *, seed_defaults: bool = True
) -> list[ExpenseCategory]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(ExpenseCategory).where(ExpenseCategory.hotel_id == hotel_id)
    )
    categories = list(result.scalars().all())
    if not categories and seed_defaults:
        for name in DEFAULT_CATEGORIES:
            db.add(ExpenseCategory(hotel_id=hotel_id, name=name))
        await db.flush()
        result = await db.execute(
            select(ExpenseCategory).where(ExpenseCategory.hotel_id == hotel_id)
        )
        categories = list(result.scalars().all())
    return sorted(categories, key=lambda c: c.name)


async def create_category(
    db: AsyncSession, tenant: TenantContext, body: ExpenseCategoryCreate
) -> ExpenseCategory:
    hotel_id = tenant.require_hotel()
    category = ExpenseCategory(hotel_id=hotel_id, name=body.name.strip())
    db.add(category)
    await db.flush()
    return category


# --- Vendors ---------------------------------------------------------------


async def list_vendors(db: AsyncSession, tenant: TenantContext) -> list[Vendor]:
    result = await db.execute(
        select(Vendor)
        .where(Vendor.hotel_id == tenant.require_hotel())
        .order_by(Vendor.name)
    )
    return list(result.scalars().all())


async def create_vendor(
    db: AsyncSession, tenant: TenantContext, body: VendorCreate
) -> Vendor:
    vendor = Vendor(hotel_id=tenant.require_hotel(), **body.model_dump())
    db.add(vendor)
    await db.flush()
    return vendor


# --- Expenses ----------------------------------------------------------------


async def get_expense(db: AsyncSession, tenant: TenantContext, expense_id: UUID) -> Expense:
    result = await db.execute(
        select(Expense).where(
            Expense.id == expense_id, Expense.hotel_id == tenant.require_hotel()
        )
    )
    expense = result.scalar_one_or_none()
    if expense is None:
        raise NotFoundError("Expense not found")
    return expense


async def list_expenses(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    status: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    category_id: UUID | None = None,
    payment_method: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Expense], int]:
    hotel_id = tenant.require_hotel()
    stmt = select(Expense).where(Expense.hotel_id == hotel_id)
    if status:
        stmt = stmt.where(Expense.status == status)
    if from_date:
        stmt = stmt.where(Expense.expense_date >= from_date)
    if to_date:
        stmt = stmt.where(Expense.expense_date <= to_date)
    if category_id:
        stmt = stmt.where(Expense.category_id == category_id)
    if payment_method:
        stmt = stmt.where(Expense.payment_method == payment_method)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total


async def expense_summary(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
) -> dict[str, object]:
    """Totals for the stat cards: all-time / today / this-month / entry count.

    Rejected expenses are excluded. 'Today' and 'this month' are calendar
    boundaries in the HOTEL's timezone (expense_date is a plain date, so only
    the boundary dates need timezone awareness — same approach as reports).

    When from_date/to_date are provided (the page's time-period filter),
    total_amount / entries / pending_amount are scoped to that window so the
    stat cards mirror the filtered ledger (client 09/2026). today/month cards
    keep their fixed calendar semantics.
    """
    hotel_id = tenant.require_hotel()

    from app.models.hotel import Hotel

    hotel_tz = (
        await db.execute(select(Hotel.timezone).where(Hotel.id == hotel_id))
    ).scalar_one_or_none() or "Asia/Kolkata"
    try:
        tz = ZoneInfo(hotel_tz)
    except (KeyError, ValueError):
        tz = ZoneInfo("Asia/Kolkata")
    today = datetime.now(tz).date()
    month_start = today.replace(day=1)

    # Use separate scalar queries for each stat — cleaner, avoids complex
    # cross-product CASE expressions that can have SQLAlchemy dialect quirks.
    # Committed = APPROVED + PAID (not submitted/pending).

    base_committed = (
        select(func.coalesce(func.sum(Expense.amount), 0))
        .where(
            Expense.hotel_id == hotel_id,
            Expense.status.in_(("approved", "paid")),
        )
    )

    # Optional date-window scoping (from the page's time-period filter).
    ranged_committed = base_committed
    if from_date is not None:
        ranged_committed = ranged_committed.where(Expense.expense_date >= from_date)
    if to_date is not None:
        ranged_committed = ranged_committed.where(Expense.expense_date <= to_date)

    total_amount = await db.scalar(ranged_committed)

    # Per-mode breakdown (CASH / UPI stat cards — Figma 09/2026).
    cash_amount = await db.scalar(
        ranged_committed.where(Expense.payment_method == "cash")
    )
    upi_amount = await db.scalar(
        ranged_committed.where(Expense.payment_method == "upi")
    )

    today_amount = await db.scalar(
        base_committed.where(Expense.expense_date == today)
    )

    month_amount = await db.scalar(
        base_committed.where(Expense.expense_date >= month_start)
    )

    entries_q = select(func.count(Expense.id)).where(
        Expense.hotel_id == hotel_id,
        Expense.status != "rejected",
    )
    if from_date is not None:
        entries_q = entries_q.where(Expense.expense_date >= from_date)
    if to_date is not None:
        entries_q = entries_q.where(Expense.expense_date <= to_date)
    entries = await db.scalar(entries_q)

    # SUBMITTED only — shown on "Pending Approval" stat card
    pending_q = select(func.coalesce(func.sum(Expense.amount), 0)).where(
        Expense.hotel_id == hotel_id,
        Expense.status == "submitted",
    )
    if from_date is not None:
        pending_q = pending_q.where(Expense.expense_date >= from_date)
    if to_date is not None:
        pending_q = pending_q.where(Expense.expense_date <= to_date)
    pending_amount = await db.scalar(pending_q)

    return {
        "total_amount": total_amount or 0,
        "today_amount": today_amount or 0,
        "month_amount": month_amount or 0,
        "entries": entries or 0,
        "pending_amount": pending_amount or 0,
        "cash_amount": cash_amount or 0,
        "upi_amount": upi_amount or 0,
    }


async def create_expense(
    db: AsyncSession,
    tenant: TenantContext,
    body: ExpenseCreate,
    *,
    correlation_id: str | None = None,
) -> Expense:
    from sqlalchemy.exc import IntegrityError as _IntegrityError

    hotel_id = tenant.require_hotel()
    from app.services.subscriptions import assert_transactions_allowed as _ata
    await _ata(db, hotel_id)

    # Validate that category/vendor belong to this hotel (guard against
    # stale UUIDs that were deleted between the dropdown render and submit).
    if body.category_id:
        cat_row = await db.execute(
            select(ExpenseCategory).where(
                ExpenseCategory.id == body.category_id,
                ExpenseCategory.hotel_id == hotel_id,
            )
        )
        if cat_row.scalar_one_or_none() is None:
            raise ValidationAppError("Category not found for this hotel", code="category_not_found")

    if body.vendor_id:
        vendor_row = await db.execute(
            select(Vendor).where(
                Vendor.id == body.vendor_id,
                Vendor.hotel_id == hotel_id,
            )
        )
        if vendor_row.scalar_one_or_none() is None:
            raise ValidationAppError("Vendor not found for this hotel", code="vendor_not_found")

    expense = Expense(
        hotel_id=hotel_id,
        category_id=body.category_id,
        vendor_id=body.vendor_id,
        expense_date=body.expense_date,
        amount=body.amount,
        taxable_amount=body.taxable_amount,
        cgst_amount=body.cgst_amount,
        sgst_amount=body.sgst_amount,
        igst_amount=body.igst_amount,
        payment_method=body.payment_method,
        description=body.description,
        bill_number=body.bill_number,
        bill_date=body.bill_date,
        status="submitted" if body.submit else "draft",
        created_by_id=tenant.user_id,
    )
    db.add(expense)
    try:
        await db.flush()
    except _IntegrityError as exc:
        await db.rollback()
        raise ValidationAppError(
            "Could not save expense — a referenced record no longer exists",
            code="expense_integrity_error",
        ) from exc
    await write_audit(
        db,
        action="expenses.created",
        entity_type="expense",
        entity_id=expense.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"amount": str(body.amount), "status": expense.status},
        correlation_id=correlation_id,
    )
    return expense


async def transition_expense(
    db: AsyncSession,
    tenant: TenantContext,
    expense_id: UUID,
    target: str,
    *,
    reason: str | None = None,
    correlation_id: str | None = None,
) -> Expense:
    expense = await get_expense(db, tenant, expense_id)
    allowed = EXPENSE_TRANSITIONS.get(expense.status, frozenset())
    if target not in allowed:
        raise ValidationAppError(
            f"Expense cannot move from '{expense.status}' to '{target}'",
            code="invalid_expense_transition",
        )
    old = expense.status
    expense.status = target
    if target == "approved":
        expense.approved_by_id = tenant.user_id
        expense.approved_at = datetime.now(UTC)
        expense.rejection_reason = None
    elif target == "rejected":
        if not reason:
            raise ValidationAppError("Rejection requires a reason", code="reason_required")
        expense.rejection_reason = reason
    elif target == "paid":
        expense.payment_status = "paid"
        expense.payment_date = date.today()
    await write_audit(
        db,
        action=f"expenses.{target}",
        entity_type="expense",
        entity_id=expense.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"status": old},
        after={"status": target, "reason": reason},
        correlation_id=correlation_id,
    )
    from app.models.user import User as _User
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire

    submitter_id = expense.created_by_id
    approver = await db.get(_User, tenant.user_id)
    approver_name = approver.full_name if approver else "Staff"
    desc = expense.description or "Expense"
    amount_str = str(expense.amount)
    hotel_id = tenant.require_hotel()

    if target == "submitted":
        await _fire(db, hotel_id=hotel_id, event=NE.EXPENSE_SUBMITTED, data={
            "amount": amount_str, "description": desc, "submitted_by": approver_name,
        })
    elif target == "approved":
        await _fire(db, hotel_id=hotel_id, event=NE.EXPENSE_APPROVED, user_id=submitter_id, data={
            "amount": amount_str, "description": desc,
        })
    elif target == "rejected":
        await _fire(db, hotel_id=hotel_id, event=NE.EXPENSE_REJECTED, user_id=submitter_id, data={
            "amount": amount_str, "description": desc, "reason": reason or "—",
        })
    return expense


ALLOWED_ATTACHMENT_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024


async def attach_receipt(
    db: AsyncSession,
    tenant: TenantContext,
    expense_id: UUID,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    correlation_id: str | None = None,
) -> Expense:
    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise ValidationAppError(
            "Attachment must be PNG, JPEG, WebP or PDF", code="invalid_attachment_type"
        )
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationAppError(
            "Attachment must be 5 MB or smaller", code="attachment_too_large"
        )
    expense = await get_expense(db, tenant, expense_id)

    from app.integrations.storage.base import get_storage, new_object_key

    hotel_id = tenant.require_hotel()
    key = new_object_key(f"hotels/{hotel_id}/expenses/{expense.id}", filename)
    await get_storage().put_bytes(key=key, data=data, content_type=content_type)
    expense.attachment_object_key = key
    await db.flush()
    await write_audit(
        db,
        action="expenses.attachment_added",
        entity_type="expense",
        entity_id=expense.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"filename": filename},
        correlation_id=correlation_id,
    )
    return expense


async def get_receipt(
    db: AsyncSession, tenant: TenantContext, expense_id: UUID
) -> tuple[bytes, str]:
    expense = await get_expense(db, tenant, expense_id)
    if not expense.attachment_object_key:
        raise NotFoundError("No attachment on this expense")

    from app.integrations.storage.base import get_storage

    data = await get_storage().get_bytes(expense.attachment_object_key)
    suffix = expense.attachment_object_key.rsplit(".", 1)[-1].lower()
    media = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "pdf": "application/pdf",
    }.get(suffix, "application/octet-stream")
    return data, media


# --- Recurring expenses --------------------------------------------------------


def _advance(run_date: date, frequency: str, custom_days: int | None) -> date:
    if frequency == "monthly":
        return run_date + relativedelta(months=1)
    if frequency == "quarterly":
        return run_date + relativedelta(months=3)
    if frequency == "yearly":
        return run_date + relativedelta(years=1)
    return run_date + relativedelta(days=custom_days or 30)


async def list_recurring(db: AsyncSession, tenant: TenantContext) -> list[RecurringExpense]:
    result = await db.execute(
        select(RecurringExpense)
        .where(RecurringExpense.hotel_id == tenant.require_hotel())
        .order_by(RecurringExpense.next_run_date)
    )
    return list(result.scalars().all())


async def create_recurring(
    db: AsyncSession, tenant: TenantContext, body: RecurringExpenseCreate
) -> RecurringExpense:
    recurring = RecurringExpense(
        hotel_id=tenant.require_hotel(),
        next_run_date=body.start_date,
        **body.model_dump(),
    )
    db.add(recurring)
    await db.flush()
    return recurring


async def run_due_recurring(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    as_of: date | None = None,
    correlation_id: str | None = None,
) -> list[Expense]:
    """Generate draft expenses for due recurring templates. Idempotent per due date."""
    hotel_id = tenant.require_hotel()
    today = as_of or date.today()
    result = await db.execute(
        select(RecurringExpense)
        .where(
            RecurringExpense.hotel_id == hotel_id,
            RecurringExpense.is_active.is_(True),
            RecurringExpense.next_run_date <= today,
        )
        .with_for_update()
    )
    created: list[Expense] = []
    for template in result.scalars().all():
        while template.next_run_date <= today:
            if template.end_date and template.next_run_date > template.end_date:
                template.is_active = False
                break
            expense = Expense(
                hotel_id=hotel_id,
                category_id=template.category_id,
                vendor_id=template.vendor_id,
                expense_date=template.next_run_date,
                amount=template.amount,
                payment_method="cash",
                description=f"[Recurring] {template.name}",
                status="draft",
                created_by_id=tenant.user_id,
            )
            db.add(expense)
            created.append(expense)
            template.next_run_date = _advance(
                template.next_run_date, template.frequency, template.custom_interval_days
            )
    await db.flush()
    if created:
        await write_audit(
            db,
            action="expenses.recurring_generated",
            entity_type="expense",
            actor_id=tenant.user_id,
            hotel_id=hotel_id,
            after={"count": len(created)},
            correlation_id=correlation_id,
        )
    return created
