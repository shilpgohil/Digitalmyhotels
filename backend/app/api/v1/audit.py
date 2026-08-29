from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.models.platform import AuditLog
from app.schemas.platform import AuditLogListOut, AuditLogOut

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogListOut)
async def list_audit_logs(
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.AUDIT_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> AuditLogListOut:
    hotel_id = tenant.require_hotel()
    query = select(AuditLog).where(AuditLog.hotel_id == hotel_id)
    if action:
        query = query.where(AuditLog.action == action)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    query = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    items = list((await db.execute(query)).scalars().all())
    return AuditLogListOut(
        items=[AuditLogOut.model_validate(i) for i in items], total=len(items)
    )
