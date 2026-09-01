from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.invoice import (
    InvoiceCancelRequest,
    InvoiceGenerateRequest,
    InvoiceListOut,
    InvoiceOut,
)
from app.services import invoices as invoices_service

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("")
async def list_invoices(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceListOut:
    items, total = await invoices_service.list_invoices(
        db, tenant, status=status, query=q, limit=limit, offset=offset
    )
    return InvoiceListOut(
        items=[InvoiceOut.model_validate(i) for i in items], total=total
    )


@router.post("", status_code=201)
async def generate_invoice(
    body: InvoiceGenerateRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    invoice = await invoices_service.generate_invoice(
        db,
        tenant,
        body.booking_id,
        interstate=body.interstate,
        correlation_id=_correlation(request),
    )
    return InvoiceOut.model_validate(invoice)


@router.get("/{invoice_id}")
async def get_invoice(
    invoice_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    invoice = await invoices_service.get_invoice(db, tenant, invoice_id)
    return InvoiceOut.model_validate(invoice)


@router.get("/{invoice_id}/pdf")
async def invoice_pdf(
    invoice_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    pdf = await invoices_service.render_invoice_pdf(db, tenant, invoice_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="invoice-{invoice_id}.pdf"'},
    )


@router.post("/{invoice_id}/email")
async def email_invoice(
    invoice_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Email the invoice PDF to the guest's email address."""
    to = await invoices_service.email_invoice(
        db, tenant, invoice_id, correlation_id=_correlation(request)
    )
    return {"message": f"Invoice sent to {to}", "to": to}


@router.post("/{invoice_id}/cancel")
async def cancel_invoice(
    invoice_id: UUID,
    body: InvoiceCancelRequest,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.INVOICES_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> InvoiceOut:
    invoice = await invoices_service.cancel_invoice(
        db, tenant, invoice_id, body.reason, correlation_id=_correlation(request)
    )
    return InvoiceOut.model_validate(invoice)
