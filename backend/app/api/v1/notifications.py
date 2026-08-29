from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.platform import NotificationListOut, NotificationOut
from app.services import notifications as notifications_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListOut)
async def list_notifications(
    unread_only: bool = Query(default=False),
    category: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.NOTIFICATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> NotificationListOut:
    return await notifications_service.list_notifications(
        db, tenant, unread_only=unread_only, category=category
    )


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.NOTIFICATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> NotificationOut:
    row = await notifications_service.mark_read(db, tenant, notification_id)
    return NotificationOut.model_validate(row)


@router.post("/mark-all-read")
async def mark_all_read(
    tenant: TenantContext = Depends(require_permissions(Permission.NOTIFICATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    count = await notifications_service.mark_all_read(db, tenant)
    return {"marked_read": count}
