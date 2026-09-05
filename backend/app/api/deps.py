from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.permissions import Permission, RoleCode
from app.core.security import decode_access_token, parse_uuid
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.models.user import HotelMembership, User

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError()
    payload = decode_access_token(credentials.credentials)
    user_id = parse_uuid(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise UnauthorizedError("User not found")
    if not user.is_active:
        raise ForbiddenError("Account is disabled", code="account_disabled")
    # NOTE: must_reset_password is surfaced via /auth/me and enforced by the
    # frontend redirect. Server-side blocking was removed because it caused a
    # production outage when existing users had the flag set without the
    # frontend having gone through the change-password flow. Re-enable after
    # adding a proper change-password page and clearing the flag for all users.
    return user


async def get_tenant_context(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_hotel_id: str | None = Header(default=None, alias="X-Hotel-Id"),
) -> TenantContext:
    """Resolve tenant from membership — X-Hotel-Id is a hint, verified against DB."""
    if user.is_super_admin and not x_hotel_id:
        return TenantContext(
            user_id=user.id,
            hotel_id=None,
            role=RoleCode.SUPER_ADMIN,
            is_super_admin=True,
        )

    hotel_uuid: UUID | None = None
    if x_hotel_id:
        try:
            hotel_uuid = UUID(x_hotel_id)
        except ValueError as exc:
            raise ForbiddenError("Invalid hotel context", code="invalid_hotel") from exc

    if user.is_super_admin and hotel_uuid:
        return TenantContext(
            user_id=user.id,
            hotel_id=hotel_uuid,
            role=RoleCode.SUPER_ADMIN,
            is_super_admin=True,
        )

    query = (
        select(HotelMembership)
        .options(selectinload(HotelMembership.role))
        .where(
            HotelMembership.user_id == user.id,
            HotelMembership.status == "active",
        )
        .order_by(HotelMembership.created_at)
    )
    if hotel_uuid:
        query = query.where(HotelMembership.hotel_id == hotel_uuid)

    result = await db.execute(query)
    memberships = list(result.scalars().all())

    if not memberships:
        raise ForbiddenError("No hotel membership", code="no_membership")

    membership = memberships[0]
    if hotel_uuid and membership.hotel_id != hotel_uuid:
        raise ForbiddenError("Not a member of this hotel", code="hotel_forbidden")

    role_code = RoleCode(membership.role.code)
    request.state.tenant = TenantContext(
        user_id=user.id,
        hotel_id=membership.hotel_id,
        role=role_code,
        is_super_admin=False,
        membership_id=membership.id,
    )
    return request.state.tenant


def require_permissions(*permissions: Permission):
    async def _dep(tenant: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        for perm in permissions:
            tenant.require_permission(perm)
        return tenant

    return _dep


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_super_admin:
        raise ForbiddenError("Super admin access required", code="super_admin_only")
    return user
