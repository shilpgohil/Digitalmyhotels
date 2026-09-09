from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.guest import (
    GuestAutofillOut,
    GuestCreate,
    GuestListOut,
    GuestOut,
    GuestSearchOut,
    GuestUpdate,
)
from app.services import guests as guests_service

router = APIRouter(prefix="/guests", tags=["guests"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("", response_model=GuestListOut)
async def list_guests(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> GuestListOut:
    items, total = await guests_service.list_guests(
        db, tenant, query=q, limit=limit, offset=offset
    )
    return GuestListOut(items=[guests_service.to_out(g) for g in items], total=total)


@router.get("/search", response_model=GuestSearchOut)
async def search_guests(
    phone: str | None = Query(default=None, max_length=20),
    id_last4: str | None = Query(default=None, min_length=4, max_length=4),
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> GuestSearchOut:
    items = await guests_service.search_guests(db, tenant, phone=phone, id_last4=id_last4)
    return GuestSearchOut(items=items)


@router.post("/{guest_id}/autofill", response_model=GuestAutofillOut)
async def autofill_guest(
    guest_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> GuestAutofillOut:
    return await guests_service.autofill_guest(
        db, tenant, guest_id, correlation_id=_correlation(request)
    )


class GuestIdRevealOut(BaseModel):
    id_number: str | None
    id_proof_type: str | None


@router.post("/{guest_id}/reveal-id", response_model=GuestIdRevealOut)
async def reveal_guest_id(
    guest_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW_FULL_ID)),
    db: AsyncSession = Depends(get_db),
) -> GuestIdRevealOut:
    """Audited reveal of the full decrypted ID number (show/hide toggle).

    POST (not GET) so the reveal is an explicit action that is never cached,
    prefetched or logged in access logs with the response body.
    """
    full_id = await guests_service.reveal_guest_id(
        db, tenant, guest_id, correlation_id=_correlation(request)
    )
    guest = await guests_service.get_guest(db, tenant, guest_id)
    return GuestIdRevealOut(id_number=full_id, id_proof_type=guest.id_proof_type)


@router.get("/{guest_id}", response_model=GuestOut)
async def get_guest(
    guest_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> GuestOut:
    guest = await guests_service.get_guest(db, tenant, guest_id)
    return guests_service.to_out(guest)


@router.post("", response_model=GuestOut, status_code=201)
async def create_guest(
    body: GuestCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> GuestOut:
    guest = await guests_service.create_guest(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return guests_service.to_out(guest)


@router.patch("/{guest_id}", response_model=GuestOut)
async def update_guest(
    guest_id: UUID,
    body: GuestUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> GuestOut:
    guest = await guests_service.update_guest(
        db, tenant, guest_id, body, correlation_id=_correlation(request)
    )
    return guests_service.to_out(guest)


class GuestDocumentOut(BaseModel):
    id: UUID
    document_type: str
    side: str | None
    created_at: datetime


@router.post("/{guest_id}/documents", response_model=GuestDocumentOut, status_code=201)
async def upload_document(
    guest_id: UUID,
    request: Request,
    side: str = Form(...),
    document_type: str = Form(default="id_proof"),
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> GuestDocumentOut:
    data = await file.read()
    doc = await guests_service.add_document(
        db,
        tenant,
        guest_id,
        side=side,
        document_type=document_type,
        filename=file.filename or f"{side}.png",
        content_type=file.content_type or "application/octet-stream",
        data=data,
        correlation_id=_correlation(request),
    )
    return GuestDocumentOut(
        id=doc.id, document_type=doc.document_type, side=doc.side, created_at=doc.created_at
    )


@router.get("/{guest_id}/documents", response_model=list[GuestDocumentOut])
async def list_guest_documents(
    guest_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[GuestDocumentOut]:
    docs = await guests_service.list_documents(db, tenant, guest_id)
    return [
        GuestDocumentOut(
            id=d.id, document_type=d.document_type, side=d.side, created_at=d.created_at
        )
        for d in docs
    ]


@router.get("/{guest_id}/documents/{document_id}/file")
async def download_guest_document(
    guest_id: UUID,
    document_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.GUESTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Serve a guest ID document image.

    Any user with GUESTS_VIEW may fetch the image — but because ID document
    images reveal the full Aadhaar/passport number, callers with the elevated
    GUESTS_VIEW_FULL_ID permission get the access written to the audit log.
    (GUESTS_VIEW alone is enough to view the image; the audit is belt-and-
    braces observability, not an access gate.)
    """
    if tenant.can(Permission.GUESTS_VIEW_FULL_ID):
        from app.services.audit import write_audit

        await write_audit(
            db,
            action="guests.document_downloaded",
            entity_type="guest_document",
            entity_id=document_id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            after={"guest_id": str(guest_id), "document_id": str(document_id)},
            correlation_id=getattr(request.state, "correlation_id", None),
        )
    data, media_type = await guests_service.get_document_bytes(
        db, tenant, guest_id, document_id
    )
    return Response(content=data, media_type=media_type)
