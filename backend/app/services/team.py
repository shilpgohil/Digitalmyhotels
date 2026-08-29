from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError, ValidationAppError
from app.core.permissions import RoleCode
from app.core.security import hash_password
from app.core.tenant import TenantContext
from app.models.user import HotelMembership, Role, User
from app.schemas.team import TeamMemberCreate, TeamMemberOut, TeamMemberUpdate
from app.services.audit import write_audit
from app.services.auth import create_user

# Owner-creatable roles. Owners must never create another owner
# (Super Admin authorization required per SRS rule 22).
CREATABLE_ROLES = {RoleCode.MANAGER, RoleCode.ADMIN, RoleCode.HOUSEKEEPING}


def _to_out(membership: HotelMembership) -> TeamMemberOut:
    return TeamMemberOut(
        membership_id=membership.id,
        user_id=membership.user.id,
        full_name=membership.user.full_name,
        email=membership.user.email,
        phone=membership.user.phone,
        role_code=membership.role.code,
        role_name=membership.role.name,
        status=membership.status,
        is_active=membership.user.is_active,
        last_login_at=membership.user.last_login_at,
    )


async def _get_role(db: AsyncSession, code: str) -> Role:
    result = await db.execute(select(Role).where(Role.code == code))
    role = result.scalar_one_or_none()
    if role is None:
        raise ValidationAppError(f"Unknown role: {code}", code="unknown_role")
    return role


async def list_team(
    db: AsyncSession, tenant: TenantContext, *, limit: int = 50, offset: int = 0
) -> tuple[list[TeamMemberOut], int]:
    hotel_id = tenant.require_hotel()
    base = select(HotelMembership).where(HotelMembership.hotel_id == hotel_id)
    total = (
        await db.execute(
            select(func.count()).select_from(base.subquery())
        )
    ).scalar_one()
    result = await db.execute(
        base.options(
            selectinload(HotelMembership.user), selectinload(HotelMembership.role)
        )
        .order_by(HotelMembership.created_at)
        .limit(limit)
        .offset(offset)
    )
    return [_to_out(m) for m in result.scalars().all()], total


async def _get_membership(
    db: AsyncSession, tenant: TenantContext, membership_id: UUID
) -> HotelMembership:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(HotelMembership)
        .options(selectinload(HotelMembership.user), selectinload(HotelMembership.role))
        .where(
            HotelMembership.id == membership_id,
            HotelMembership.hotel_id == hotel_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise NotFoundError("Team member not found")
    return membership


async def create_team_member(
    db: AsyncSession,
    tenant: TenantContext,
    body: TeamMemberCreate,
    *,
    correlation_id: str | None = None,
) -> TeamMemberOut:
    hotel_id = tenant.require_hotel()
    role_code = RoleCode(body.role_code)
    if role_code not in CREATABLE_ROLES:
        raise ValidationAppError(
            "This role cannot be created by a hotel owner", code="role_not_creatable"
        )
    role = await _get_role(db, role_code.value)
    user = await create_user(
        db,
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        phone=body.phone,
        must_reset_password=True,
    )
    membership = HotelMembership(
        user_id=user.id, hotel_id=hotel_id, role_id=role.id, status="active"
    )
    db.add(membership)
    await db.flush()
    await write_audit(
        db,
        action="team.member_created",
        entity_type="hotel_membership",
        entity_id=membership.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"email": body.email, "role": role_code.value},
        correlation_id=correlation_id,
    )
    membership.user = user
    membership.role = role
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    await _fire(db, hotel_id=hotel_id, event=NE.TEAM_MEMBER_ADDED, data={
        "member_name": body.full_name, "role": role_code.value,
    })
    return _to_out(membership)


async def update_team_member(
    db: AsyncSession,
    tenant: TenantContext,
    membership_id: UUID,
    body: TeamMemberUpdate,
    *,
    correlation_id: str | None = None,
) -> TeamMemberOut:
    membership = await _get_membership(db, tenant, membership_id)
    _guard_not_owner(membership)
    changes: dict[str, str] = {}
    if body.full_name is not None:
        membership.user.full_name = body.full_name
        changes["full_name"] = body.full_name
    if body.phone is not None:
        membership.user.phone = body.phone
        changes["phone"] = body.phone
    if body.role_code is not None:
        role_code = RoleCode(body.role_code)
        if role_code not in CREATABLE_ROLES:
            raise ValidationAppError("Invalid role", code="role_not_creatable")
        role = await _get_role(db, role_code.value)
        membership.role_id = role.id
        membership.role = role
        changes["role"] = role_code.value
    if changes:
        await write_audit(
            db,
            action="team.member_updated",
            entity_type="hotel_membership",
            entity_id=membership.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            after=changes,
            correlation_id=correlation_id,
        )
    return _to_out(membership)


async def set_member_status(
    db: AsyncSession,
    tenant: TenantContext,
    membership_id: UUID,
    *,
    enabled: bool,
    correlation_id: str | None = None,
) -> TeamMemberOut:
    membership = await _get_membership(db, tenant, membership_id)
    _guard_not_owner(membership)
    if membership.user_id == tenant.user_id:
        raise ValidationAppError("You cannot disable your own account", code="self_disable")
    membership.status = "active" if enabled else "disabled"
    membership.user.is_active = enabled
    await write_audit(
        db,
        action="team.member_enabled" if enabled else "team.member_disabled",
        entity_type="hotel_membership",
        entity_id=membership.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        correlation_id=correlation_id,
    )
    if not enabled:
        from app.services.notification_events import NE
        from app.services.notification_events import fire as _fire
        await _fire(db, hotel_id=tenant.require_hotel(), event=NE.TEAM_MEMBER_DISABLED, data={
            "member_name": membership.user.full_name,
        })
    return _to_out(membership)


async def reset_member_password(
    db: AsyncSession,
    tenant: TenantContext,
    membership_id: UUID,
    new_password: str,
    *,
    correlation_id: str | None = None,
) -> None:
    membership = await _get_membership(db, tenant, membership_id)
    _guard_not_owner(membership)
    membership.user.password_hash = hash_password(new_password)
    membership.user.must_reset_password = True
    await write_audit(
        db,
        action="team.password_reset",
        entity_type="user",
        entity_id=membership.user_id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        correlation_id=correlation_id,
    )


def _guard_not_owner(membership: HotelMembership) -> None:
    if membership.role.code == RoleCode.OWNER.value:
        raise ValidationAppError(
            "Owner accounts cannot be managed here", code="owner_protected"
        )


async def get_user_for_membership(db: AsyncSession, membership: HotelMembership) -> User:
    result = await db.execute(select(User).where(User.id == membership.user_id))
    return result.scalar_one()
