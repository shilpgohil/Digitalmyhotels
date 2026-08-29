from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.ops import (
    HousekeepingAssign,
    HousekeepingTaskOut,
    MaintenanceCreate,
    MaintenanceOut,
)
from app.services import housekeeping as hk_service

router = APIRouter(prefix="/housekeeping", tags=["housekeeping"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("/tasks", response_model=list[HousekeepingTaskOut])
async def list_tasks(
    status: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.HOUSEKEEPING_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> list[HousekeepingTaskOut]:
    return await hk_service.list_tasks(db, tenant, status=status)


@router.post("/tasks/{task_id}/start", response_model=HousekeepingTaskOut)
async def start_task(
    task_id: UUID,
    body: HousekeepingAssign,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOUSEKEEPING_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> HousekeepingTaskOut:
    return await hk_service.start_task(
        db, tenant, task_id, body, correlation_id=_correlation(request)
    )


@router.post("/tasks/{task_id}/complete", response_model=HousekeepingTaskOut)
async def complete_task(
    task_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOUSEKEEPING_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> HousekeepingTaskOut:
    return await hk_service.complete_task(
        db, tenant, task_id, correlation_id=_correlation(request)
    )


@router.get("/maintenance", response_model=list[MaintenanceOut])
async def list_maintenance(
    tenant: TenantContext = Depends(require_permissions(Permission.MAINTENANCE_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> list[MaintenanceOut]:
    items = await hk_service.list_maintenance(db, tenant)
    return [MaintenanceOut.model_validate(i) for i in items]


@router.post("/maintenance", response_model=MaintenanceOut, status_code=201)
async def open_maintenance(
    body: MaintenanceCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.MAINTENANCE_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> MaintenanceOut:
    record = await hk_service.open_maintenance(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return MaintenanceOut.model_validate(record)


@router.post("/maintenance/{record_id}/resolve", response_model=MaintenanceOut)
async def resolve_maintenance(
    record_id: UUID,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.MAINTENANCE_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> MaintenanceOut:
    record = await hk_service.resolve_maintenance(
        db, tenant, record_id, correlation_id=_correlation(request)
    )
    return MaintenanceOut.model_validate(record)
