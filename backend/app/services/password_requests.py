"""Hierarchical password-reset requests (client 9-08 item 34).

Routing rule (confirmed product decision):
- Hotel STAFF (manager / reception / housekeeping) → request goes to their
  hotel's administrators (owner/manager see it on the Team page + an
  admin-category notification).
- Hotel OWNER (or a user with no staff membership) → request goes to the
  platform Super Admin.

The public entry point never reveals whether an account exists. Resolution
happens through the existing manual reset actions, which mark the pending
request completed and are themselves audited + session-revoking.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import RoleCode
from app.core.tenant import TenantContext
from app.models.hotel import Hotel
from app.models.platform import PasswordResetRequest
from app.models.user import HotelMembership, Role, User
from app.schemas.guest import normalize_phone
from app.services.audit import write_audit


async def create_request(db: AsyncSession, identifier: str) -> None:
    """Public: record a reset request for an email/phone. ALWAYS silent —
    the response never discloses whether the account exists."""
    ident = identifier.strip().lower()
    user: User | None = None
    if "@" in ident:
        user = (
            await db.execute(select(User).where(User.email == ident))
        ).scalar_one_or_none()
    else:
        normalized = normalize_phone(identifier)
        if normalized:
            user = (
                await db.execute(select(User).where(User.phone == normalized))
            ).scalar_one_or_none()
    if user is None:
        return

    # One pending request per user — repeat submissions are a no-op.
    existing = (
        await db.execute(
            select(PasswordResetRequest).where(
                PasswordResetRequest.user_id == user.id,
                PasswordResetRequest.status == "pending",
            )
        )
    ).scalars().first()
    if existing is not None:
        return

    # Routing: owner (or super admin / no staff membership) → super admin;
    # staff → their hotel's administrators.
    audience = "super_admin"
    hotel_id: UUID | None = None
    if not user.is_super_admin:
        membership_rows = (
            await db.execute(
                select(HotelMembership, Role.code)
                .join(Role, Role.id == HotelMembership.role_id)
                .where(
                    HotelMembership.user_id == user.id,
                    HotelMembership.status == "active",
                )
                .order_by(HotelMembership.created_at)
            )
        ).all()
        staff_membership = next(
            (
                (m, code)
                for m, code in membership_rows
                if code != RoleCode.OWNER.value
            ),
            None,
        )
        is_owner_somewhere = any(
            code == RoleCode.OWNER.value for _, code in membership_rows
        )
        if staff_membership and not is_owner_somewhere:
            audience = "hotel_admin"
            hotel_id = staff_membership[0].hotel_id
        elif membership_rows:
            hotel_id = membership_rows[0][0].hotel_id

    db.add(
        PasswordResetRequest(
            user_id=user.id,
            hotel_id=hotel_id,
            audience=audience,
            status="pending",
        )
    )
    await db.flush()

    if audience == "hotel_admin" and hotel_id is not None:
        # Admin-category notification — visible to owner/manager only
        # (role-scoped categories, item 35).
        from app.services.notifications import create_notification

        await create_notification(
            db,
            hotel_id=hotel_id,
            user_id=None,
            type="team.password_reset_requested",
            category="admin",
            title="Password reset requested",
            body=(
                f"{user.full_name} asked for a password reset. "
                "Open Team Management to issue a temporary password."
            ),
            deep_link="/team",
        )


def _request_row(
    req: PasswordResetRequest, user: User, hotel_name: str | None
) -> dict:
    return {
        "id": req.id,
        "user_id": req.user_id,
        "full_name": user.full_name,
        "email": user.email,
        "hotel_id": req.hotel_id,
        "hotel_name": hotel_name,
        "requested_at": req.created_at,
    }


async def list_hotel_requests(
    db: AsyncSession, tenant: TenantContext
) -> list[dict]:
    """Pending staff requests for the active hotel (Team page banner)."""
    hotel_id = tenant.require_hotel()
    rows = (
        await db.execute(
            select(PasswordResetRequest, User)
            .join(User, User.id == PasswordResetRequest.user_id)
            .where(
                PasswordResetRequest.hotel_id == hotel_id,
                PasswordResetRequest.audience == "hotel_admin",
                PasswordResetRequest.status == "pending",
            )
            .order_by(PasswordResetRequest.created_at)
        )
    ).all()
    return [_request_row(req, user, None) for req, user in rows]


async def list_platform_requests(db: AsyncSession) -> list[dict]:
    """Pending owner/admin requests for the Super Admin console."""
    rows = (
        await db.execute(
            select(PasswordResetRequest, User, Hotel.name)
            .join(User, User.id == PasswordResetRequest.user_id)
            .outerjoin(Hotel, Hotel.id == PasswordResetRequest.hotel_id)
            .where(
                PasswordResetRequest.audience == "super_admin",
                PasswordResetRequest.status == "pending",
            )
            .order_by(PasswordResetRequest.created_at)
        )
    ).all()
    return [_request_row(req, user, hotel_name) for req, user, hotel_name in rows]


async def complete_for_user(
    db: AsyncSession, user_id: UUID, *, resolved_by_id: UUID
) -> None:
    """Mark every pending request for this user completed — called by the
    manual reset actions so resolutions are tracked automatically."""
    rows = (
        await db.execute(
            select(PasswordResetRequest).where(
                PasswordResetRequest.user_id == user_id,
                PasswordResetRequest.status == "pending",
            )
        )
    ).scalars().all()
    now = datetime.now(UTC)
    for req in rows:
        req.status = "completed"
        req.resolved_by_id = resolved_by_id
        req.resolved_at = now


async def dismiss_request(
    db: AsyncSession,
    request_id: UUID,
    *,
    resolved_by_id: UUID,
    hotel_id: UUID | None = None,
    audience: str | None = None,
    correlation_id: str | None = None,
) -> None:
    """Dismiss a pending request. Scope-guarded: hotel admins can only touch
    their own hotel's staff requests; super admin touches platform ones."""
    from app.core.errors import NotFoundError

    req = (
        await db.execute(
            select(PasswordResetRequest).where(PasswordResetRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if req is None or req.status != "pending":
        raise NotFoundError("Request not found")
    if hotel_id is not None and (
        req.hotel_id != hotel_id or req.audience != "hotel_admin"
    ):
        raise NotFoundError("Request not found")
    if audience is not None and req.audience != audience:
        raise NotFoundError("Request not found")
    req.status = "dismissed"
    req.resolved_by_id = resolved_by_id
    req.resolved_at = datetime.now(UTC)
    await write_audit(
        db,
        action="auth.password_request_dismissed",
        entity_type="password_reset_request",
        entity_id=req.id,
        actor_id=resolved_by_id,
        hotel_id=req.hotel_id,
        correlation_id=correlation_id,
    )
