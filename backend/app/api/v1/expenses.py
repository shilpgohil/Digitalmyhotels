from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.expense import (
    ExpenseCategoryCreate,
    ExpenseCategoryOut,
    ExpenseCreate,
    ExpenseListOut,
    ExpenseOut,
    ExpenseRejectRequest,
    RecurringExpenseCreate,
    RecurringExpenseOut,
    VendorCreate,
    VendorOut,
)
from app.services import expenses as expenses_service

router = APIRouter(prefix="/expenses", tags=["expenses"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


# --- Categories / vendors -----------------------------------------------------


@router.get("/categories", response_model=list[ExpenseCategoryOut])
async def list_categories(
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_CREATE)),
    db: AsyncSession = Depends(get_db),
) -> list[ExpenseCategoryOut]:
    items = await expenses_service.list_categories(db, tenant)
    return [ExpenseCategoryOut.model_validate(c) for c in items]


@router.post("/categories", response_model=ExpenseCategoryOut, status_code=201)
async def create_category(
    body: ExpenseCategoryCreate,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseCategoryOut:
    category = await expenses_service.create_category(db, tenant, body)
    return ExpenseCategoryOut.model_validate(category)


@router.get("/vendors", response_model=list[VendorOut])
async def list_vendors(
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_CREATE)),
    db: AsyncSession = Depends(get_db),
) -> list[VendorOut]:
    items = await expenses_service.list_vendors(db, tenant)
    return [VendorOut.model_validate(v) for v in items]


@router.post("/vendors", response_model=VendorOut, status_code=201)
async def create_vendor(
    body: VendorCreate,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> VendorOut:
    vendor = await expenses_service.create_vendor(db, tenant, body)
    return VendorOut.model_validate(vendor)


# --- Recurring -----------------------------------------------------------------


@router.get("/recurring", response_model=list[RecurringExpenseOut])
async def list_recurring(
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[RecurringExpenseOut]:
    items = await expenses_service.list_recurring(db, tenant)
    return [RecurringExpenseOut.model_validate(r) for r in items]


@router.post("/recurring", response_model=RecurringExpenseOut, status_code=201)
async def create_recurring(
    body: RecurringExpenseCreate,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> RecurringExpenseOut:
    recurring = await expenses_service.create_recurring(db, tenant, body)
    return RecurringExpenseOut.model_validate(recurring)


@router.post("/recurring/run", response_model=ExpenseListOut)
async def run_recurring(
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseListOut:
    created = await expenses_service.run_due_recurring(
        db, tenant, correlation_id=_correlation(request)
    )
    return ExpenseListOut(
        items=[ExpenseOut.model_validate(e) for e in created], total=len(created)
    )


# --- Expenses -------------------------------------------------------------------


@router.get("", response_model=ExpenseListOut)
async def list_expenses(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseListOut:
    items, total = await expenses_service.list_expenses(
        db, tenant, status=status, limit=limit, offset=offset
    )
    return ExpenseListOut(items=[ExpenseOut.model_validate(e) for e in items], total=total)


@router.post("", response_model=ExpenseOut, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_CREATE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await expenses_service.create_expense(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return ExpenseOut.model_validate(expense)


@router.post("/{expense_id}/submit", response_model=ExpenseOut)
async def submit_expense(
    expense_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_CREATE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await expenses_service.transition_expense(
        db, tenant, expense_id, "submitted", correlation_id=_correlation(request)
    )
    return ExpenseOut.model_validate(expense)


@router.post("/{expense_id}/approve", response_model=ExpenseOut)
async def approve_expense(
    expense_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await expenses_service.transition_expense(
        db, tenant, expense_id, "approved", correlation_id=_correlation(request)
    )
    return ExpenseOut.model_validate(expense)


@router.post("/{expense_id}/reject", response_model=ExpenseOut)
async def reject_expense(
    expense_id: UUID,
    body: ExpenseRejectRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await expenses_service.transition_expense(
        db,
        tenant,
        expense_id,
        "rejected",
        reason=body.reason,
        correlation_id=_correlation(request),
    )
    return ExpenseOut.model_validate(expense)


@router.put("/{expense_id}/attachment", response_model=ExpenseOut)
async def upload_attachment(
    expense_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_CREATE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    data = await file.read()
    expense = await expenses_service.attach_receipt(
        db,
        tenant,
        expense_id,
        filename=file.filename or "receipt",
        content_type=file.content_type or "application/octet-stream",
        data=data,
        correlation_id=_correlation(request),
    )
    return ExpenseOut.model_validate(expense)


@router.get("/{expense_id}/attachment")
async def download_attachment(
    expense_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    data, media_type = await expenses_service.get_receipt(db, tenant, expense_id)
    return Response(content=data, media_type=media_type)


@router.post("/{expense_id}/mark-paid", response_model=ExpenseOut)
async def mark_expense_paid(
    expense_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.EXPENSES_APPROVE)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await expenses_service.transition_expense(
        db, tenant, expense_id, "paid", correlation_id=_correlation(request)
    )
    return ExpenseOut.model_validate(expense)
