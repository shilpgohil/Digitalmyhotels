from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.auth import MessageOut
from app.schemas.team import (
    TeamListOut,
    TeamMemberCreate,
    TeamMemberOut,
    TeamMemberStatusUpdate,
    TeamMemberUpdate,
    TeamPasswordReset,
)
from app.services import team as team_service

router = APIRouter(prefix="/team", tags=["team"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


@router.get("", response_model=TeamListOut)
async def list_team(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_TEAM)),
    db: AsyncSession = Depends(get_db),
) -> TeamListOut:
    items, total = await team_service.list_team(db, tenant, limit=limit, offset=offset)
    return TeamListOut(items=items, total=total)


@router.post("", response_model=TeamMemberOut, status_code=201)
async def create_member(
    body: TeamMemberCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_TEAM)),
    db: AsyncSession = Depends(get_db),
) -> TeamMemberOut:
    return await team_service.create_team_member(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.patch("/{membership_id}", response_model=TeamMemberOut)
async def update_member(
    membership_id: UUID,
    body: TeamMemberUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_TEAM)),
    db: AsyncSession = Depends(get_db),
) -> TeamMemberOut:
    return await team_service.update_team_member(
        db, tenant, membership_id, body, correlation_id=_correlation(request)
    )


@router.put("/{membership_id}/status", response_model=TeamMemberOut)
async def set_member_status(
    membership_id: UUID,
    body: TeamMemberStatusUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_TEAM)),
    db: AsyncSession = Depends(get_db),
) -> TeamMemberOut:
    return await team_service.set_member_status(
        db,
        tenant,
        membership_id,
        enabled=body.enabled,
        correlation_id=_correlation(request),
    )


@router.post("/{membership_id}/reset-password", response_model=MessageOut)
async def reset_member_password(
    membership_id: UUID,
    body: TeamPasswordReset,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.HOTEL_MANAGE_TEAM)),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    await team_service.reset_member_password(
        db, tenant, membership_id, body.new_password, correlation_id=_correlation(request)
    )
    return MessageOut(message="Password reset")
