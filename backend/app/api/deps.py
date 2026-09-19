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

_MUTATING_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
# Wind-down whitelist (plan Part 2 / scenario S1): mutations still allowed for
# an EXPIRED hotel — closing out in-house guests + renewing the plan. Charges
# are safe to include: the service layer only accepts them on checked-in stays.
_EXPIRED_ALLOWED_PREFIXES = (
    "/api/v1/checkouts",
    "/api/v1/payments",
    "/api/v1/invoices",
    "/api/v1/charges",
    "/api/v1/subscriptions",
)


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

    # Enforce must_reset_password HERE (not in get_current_user) so that
    # /auth/me, /auth/change-password and /auth/refresh keep working — they
    # depend on get_current_user directly and must never be blocked.
    # All hotel-scoped endpoints use get_tenant_context and are blocked until
    # the user sets a new password. The 403 code "must_reset_password" lets
    # the frontend redirect to /change-password instead of a generic error.
    if user.must_reset_password:
        raise ForbiddenError(
            "You must change your password before continuing.",
            code="must_reset_password",
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

    # Suspension is the platform kill-switch: when the Super Admin deactivates
    # a hotel, EVERY hotel-scoped call from its staff (owner included) is
    # blocked — not just billing-guarded transactions. (Client report: staff
    # could keep operating a deactivated hotel.) Reactivation restores access.
    from app.models.hotel import Hotel as _Hotel

    hotel_status = await db.scalar(
        select(_Hotel.status).where(_Hotel.id == membership.hotel_id)
    )
    if hotel_status == "suspended":
        raise ForbiddenError(
            "This hotel has been deactivated by the platform. "
            "Contact DigitalMyHotels support.",
            code="hotel_suspended",
        )

    # ── Subscription expiry enforcement (plan Part 2 + scenario S1) ─────────
    # Past expiry + grace, the hotel goes into WIND-DOWN: reads keep working,
    # but mutations are blocked EXCEPT the operations needed to honestly close
    # out guests already in-house (checkout, payment collection/refund,
    # invoicing, charges on checked-in stays) and to renew the plan.
    # New business (bookings, check-ins, staff, settings, …) is blocked.
    # Super admins are exempt (they returned above) — extend/renew instantly
    # restores access.
    if request.method in _MUTATING_METHODS:
        path = request.url.path
        if not path.startswith(_EXPIRED_ALLOWED_PREFIXES):
            from app.services.subscriptions import is_past_grace

            if await is_past_grace(db, membership.hotel_id):
                raise ForbiddenError(
                    "This hotel's subscription has expired. You can still "
                    "check out in-house guests and collect payments; renew "
                    "the plan to resume full operations.",
                    code="subscription_expired",
                )

    role_code = RoleCode(membership.role.code)

    # ── Load hotel's access_mode ──────────────────────────────────────────
    # access_mode gates feature modules at the hotel level (plan §feature-modes):
    #   "checkin_only"    → no expenses, no staff
    #   "checkin_expense" → all financial features, no staff/attendance
    #   "full"            → all features including staff management
    from app.models.hotel import HotelSettings as _HS

    raw_mode = await db.scalar(
        select(_HS.access_mode).where(_HS.hotel_id == membership.hotel_id)
    )
    hotel_access_mode: str = raw_mode or "full"

    request.state.tenant = TenantContext(
        user_id=user.id,
        hotel_id=membership.hotel_id,
        role=role_code,
        is_super_admin=False,
        membership_id=membership.id,
        access_mode=hotel_access_mode,
    )
    return request.state.tenant


def require_permissions(*permissions: Permission):
    async def _dep(tenant: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        for perm in permissions:
            tenant.require_permission(perm)
        return tenant

    return _dep


def require_access_mode(*allowed_modes: str):
    """Block endpoint unless the hotel's access_mode is in allowed_modes.

    Usage:
        tenant: TenantContext = Depends(require_access_mode("full"))
        tenant: TenantContext = Depends(require_access_mode("checkin_expense", "full"))

    Super-admins are always permitted (they bypass all access-mode gates).
    """

    async def _dep(tenant: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if tenant.is_super_admin:
            return tenant
        if tenant.access_mode not in allowed_modes:
            raise ForbiddenError(
                "This feature is not available in your current access plan. "
                "Contact your platform administrator to upgrade.",
                code="access_mode_restricted",
            )
        return tenant

    return _dep


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_super_admin:
        raise ForbiddenError("Super admin access required", code="super_admin_only")
    return user
