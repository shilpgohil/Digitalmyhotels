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
from app.schemas.guest import normalize_phone
from app.schemas.team import TeamMemberCreate, TeamMemberOut, TeamMemberUpdate
from app.services.audit import write_audit
from app.services.auth import create_user

# Owner-creatable roles. Owners must never create another owner
# (Super Admin authorization required per SRS rule 22).
CREATABLE_ROLES = {
    RoleCode.MANAGER,
    RoleCode.ADMIN,
    RoleCode.HOUSEKEEPING,
    RoleCode.RECEPTIONIST,
    RoleCode.GENERAL_STAFF,
}


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
) -> tuple[list[TeamMemberOut], int, int, int]:
    """Returns (items, total, member_limit, active_non_owner_members)."""
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
    # Cap display "X of Y used" (plan §7.1).
    from app.models.hotel import Hotel as _Hotel
    from app.models.user import Role as _Role

    member_limit = (
        await db.scalar(select(_Hotel.max_team_members).where(_Hotel.id == hotel_id))
        or 5
    )
    active_members = (
        await db.scalar(
            select(func.count())
            .select_from(HotelMembership)
            .join(_Role, _Role.id == HotelMembership.role_id)
            .where(
                HotelMembership.hotel_id == hotel_id,
                HotelMembership.status == "active",
                _Role.code != RoleCode.OWNER.value,
            )
        )
        or 0
    )
    return [_to_out(m) for m in result.scalars().all()], total, member_limit, active_members


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

    # ── Team size cap (client 15/09, plan §7.1) ──────────────────────────
    # ACTIVE members excluding the owner, counted INSIDE the transaction with
    # the hotel row locked, so two simultaneous adds cannot both pass the
    # check (scenario S3). Hotels already over the cap keep their members —
    # they just cannot add more until under the limit.
    # SUPER ADMIN EXEMPTION (client 15/09 clarification): the cap binds the
    # HOTEL side only — the platform admin may grant extra members beyond the
    # limit (or raise max_team_members on the hotel edit page).
    from app.models.hotel import Hotel as _Hotel
    from app.models.user import Role as _Role

    if not tenant.is_super_admin:
        max_members = await db.scalar(
            select(_Hotel.max_team_members)
            .where(_Hotel.id == hotel_id)
            .with_for_update()
        )
        max_members = max_members or 5
        active_members = await db.scalar(
            select(func.count())
            .select_from(HotelMembership)
            .join(_Role, _Role.id == HotelMembership.role_id)
            .where(
                HotelMembership.hotel_id == hotel_id,
                HotelMembership.status == "active",
                _Role.code != RoleCode.OWNER.value,
            )
        )
        if (active_members or 0) >= max_members:
            raise ValidationAppError(
                f"Team member limit reached ({max_members}). Contact "
                "DigitalMyHotels support to increase this hotel's limit.",
                code="team_limit_reached",
            )

    role = await _get_role(db, role_code.value)
    phone_norm = normalize_phone(body.phone) if body.phone else None
    email = body.email
    if not email:
        # Phone-first accounts (no email in the client's create form):
        # User.email is NOT NULL + unique, so when the owner omits the email
        # we store a SYNTHETIC internal address derived from the normalized
        # phone. It is never used for sending mail — "noemail.example" is a
        # reserved, non-routable domain — it only satisfies the schema
        # constraint. (".local" would be rejected by pydantic EmailStr as a
        # special-use domain, so ".example" is used instead.)
        if not phone_norm:
            raise ValidationAppError(
                "A valid phone number is required when email is not provided",
                code="invalid_phone",
            )
        email = f"phone+{phone_norm}@noemail.example"
    user = await create_user(
        db,
        email=email,
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
        after={"email": email, "phone": phone_norm, "role": role_code.value},
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
        phone_norm = normalize_phone(body.phone)
        if not phone_norm:
            raise ValidationAppError("Invalid phone number", code="invalid_phone")
        dup = await db.execute(
            select(User).where(User.phone == phone_norm, User.id != membership.user_id)
        )
        if dup.scalar_one_or_none():
            raise ValidationAppError(
                "Phone number already registered", code="phone_taken"
            )
        membership.user.phone = phone_norm
        changes["phone"] = phone_norm
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
    # Audit finding HIGH #6: admin-side password reset did not revoke active
    # refresh sessions, leaving old tokens valid until expiry. Revoke now.
    from app.services.auth import _revoke_all_user_refresh_tokens

    await _revoke_all_user_refresh_tokens(db, membership.user_id)
    # Resolve any pending hierarchical reset request for this user.
    from app.services.password_requests import complete_for_user

    await complete_for_user(db, membership.user_id, resolved_by_id=tenant.user_id)
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
