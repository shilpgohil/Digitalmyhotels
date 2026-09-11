"""Staff directory service — profiles + platform accounts (client 09/2026)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.permissions import Permission, RoleCode
from app.core.tenant import TenantContext
from app.models.hotel import Hotel
from app.models.staff import AttendanceRecord, StaffProfile
from app.models.user import HotelMembership, Role, User
from app.schemas.guest import normalize_phone
from app.schemas.staff import StaffCreate, StaffOut, StaffUpdate
from app.services.audit import write_audit

ALLOWED_PHOTO_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_PHOTO_BYTES = 2 * 1024 * 1024  # mockup: max 2 MB


def hotel_tz(hotel: Hotel) -> ZoneInfo:
    try:
        return ZoneInfo(hotel.timezone or "Asia/Kolkata")
    except (KeyError, ValueError):
        return ZoneInfo("Asia/Kolkata")


def hotel_today(hotel: Hotel) -> date:
    return datetime.now(hotel_tz(hotel)).date()


async def _next_staff_code(db: AsyncSession, hotel_id: UUID) -> str:
    count = (
        await db.execute(
            select(func.count(StaffProfile.id)).where(StaffProfile.hotel_id == hotel_id)
        )
    ).scalar_one()
    # Collision-safe: bump until free (codes are never reused after deletes).
    n = int(count) + 1
    while True:
        code = f"STF-{n:03d}"
        exists = (
            await db.execute(
                select(StaffProfile.id).where(
                    StaffProfile.hotel_id == hotel_id, StaffProfile.staff_code == code
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            return code
        n += 1


async def _get_role(db: AsyncSession, code: str) -> Role:
    role = (
        await db.execute(select(Role).where(Role.code == code))
    ).scalar_one_or_none()
    if role is None:
        raise ValidationAppError(f"Unknown role: {code}", code="unknown_role")
    return role


async def _membership_for(
    db: AsyncSession, hotel_id: UUID, user_id: UUID
) -> HotelMembership | None:
    return (
        await db.execute(
            select(HotelMembership).where(
                HotelMembership.hotel_id == hotel_id,
                HotelMembership.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def _to_out(
    db: AsyncSession,
    tenant: TenantContext,
    profile: StaffProfile,
    user: User,
    *,
    today_status: str | None = None,
) -> StaffOut:
    membership = await _membership_for(db, profile.hotel_id, user.id)
    role_code: str | None = None
    if membership is not None:
        role = await db.get(Role, membership.role_id)
        role_code = role.code if role else None
    out = StaffOut(
        id=profile.id,
        user_id=user.id,
        staff_code=profile.staff_code,
        full_name=user.full_name,
        email=None if user.email.endswith("@noemail.example") else user.email,
        phone=user.phone,
        date_of_birth=profile.date_of_birth,
        gender=profile.gender,
        department=profile.department,
        designation=profile.designation,
        employment_type=profile.employment_type,
        joining_date=profile.joining_date,
        shift_start=profile.shift_start,
        shift_end=profile.shift_end,
        weekly_off=profile.weekly_off,
        status=profile.status,
        role_code=role_code,
        has_photo=profile.photo_object_key is not None,
        today_status=today_status,
    )
    # Salary is permission-gated — never serialized without staff.salary_view.
    if tenant.can(Permission.STAFF_SALARY_VIEW):
        out.base_salary = profile.base_salary
    return out


async def create_staff(
    db: AsyncSession,
    tenant: TenantContext,
    body: StaffCreate,
    *,
    correlation_id: str | None = None,
) -> StaffOut:
    from app.services.auth import create_user

    hotel_id = tenant.require_hotel()

    phone_norm = normalize_phone(body.phone)
    if not phone_norm:
        raise ValidationAppError("Invalid phone number", code="invalid_phone")
    email = body.email or f"phone+{phone_norm}@noemail.example"

    user = await create_user(
        db,
        email=email,
        password=body.temp_password,
        full_name=body.full_name,
        phone=body.phone,
        must_reset_password=True,
    )
    role = await _get_role(db, RoleCode(body.access_role).value)
    db.add(
        HotelMembership(user_id=user.id, hotel_id=hotel_id, role_id=role.id, status="active")
    )

    profile = StaffProfile(
        hotel_id=hotel_id,
        user_id=user.id,
        staff_code=await _next_staff_code(db, hotel_id),
        department=body.department,
        designation=body.designation,
        employment_type=body.employment_type,
        joining_date=body.joining_date,
        date_of_birth=body.date_of_birth,
        gender=body.gender,
        base_salary=body.base_salary,
        shift_start=body.shift_start,
        shift_end=body.shift_end,
        weekly_off=body.weekly_off,
        status="active",
    )
    db.add(profile)
    await db.flush()
    await write_audit(
        db,
        action="staff.created",
        entity_type="staff_profile",
        entity_id=profile.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "staff_code": profile.staff_code,
            "full_name": body.full_name,
            "department": body.department,
            "role": body.access_role,
        },
        correlation_id=correlation_id,
    )
    return await _to_out(db, tenant, profile, user)


async def get_profile(db: AsyncSession, tenant: TenantContext, staff_id: UUID) -> StaffProfile:
    profile = (
        await db.execute(
            select(StaffProfile).where(
                StaffProfile.id == staff_id,
                StaffProfile.hotel_id == tenant.require_hotel(),
            )
        )
    ).scalar_one_or_none()
    if profile is None:
        raise NotFoundError("Staff member not found")
    return profile


async def get_staff(db: AsyncSession, tenant: TenantContext, staff_id: UUID) -> StaffOut:
    profile = await get_profile(db, tenant, staff_id)
    user = await db.get(User, profile.user_id)
    if user is None:
        raise NotFoundError("Staff user not found")
    hotel = await db.get(Hotel, profile.hotel_id)
    today_status = await _today_status(db, profile, hotel_today(hotel)) if hotel else None
    return await _to_out(db, tenant, profile, user, today_status=today_status)


async def _today_status(
    db: AsyncSession, profile: StaffProfile, today: date
) -> str | None:
    rec = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.staff_profile_id == profile.id,
                AttendanceRecord.work_date == today,
            )
        )
    ).scalar_one_or_none()
    if rec is None:
        # Profile-level leave shows as On Leave, not "not checked in".
        return "on_leave" if profile.status == "on_leave" else "not_checked_in"
    if rec.status in ("absent", "leave", "off", "holiday"):
        return rec.status
    if rec.check_in_at and not rec.check_out_at:
        return "late" if rec.status == "late" else "working"
    if rec.check_out_at:
        return "checked_out"
    return rec.status


async def list_staff(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    q: str | None = None,
    department: str | None = None,
    role: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[StaffOut], int]:
    hotel_id = tenant.require_hotel()
    base = (
        select(StaffProfile, User)
        .join(User, User.id == StaffProfile.user_id)
        .where(StaffProfile.hotel_id == hotel_id)
    )
    if q:
        like = f"%{q.strip()}%"
        base = base.where(
            User.full_name.ilike(like)
            | StaffProfile.staff_code.ilike(like)
            | User.phone.ilike(like)
        )
    if department:
        base = base.where(StaffProfile.department == department)
    if status:
        base = base.where(StaffProfile.status == status)
    if role:
        base = base.join(
            HotelMembership,
            (HotelMembership.user_id == User.id) & (HotelMembership.hotel_id == hotel_id),
        ).join(Role, Role.id == HotelMembership.role_id).where(Role.code == role)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(
            base.order_by(StaffProfile.staff_code).limit(limit).offset(offset)
        )
    ).all()

    hotel = await db.get(Hotel, hotel_id)
    today = hotel_today(hotel) if hotel else date.today()
    items: list[StaffOut] = []
    for profile, user in rows:
        today_status = await _today_status(db, profile, today)
        items.append(await _to_out(db, tenant, profile, user, today_status=today_status))
    return items, int(total)


async def update_staff(
    db: AsyncSession,
    tenant: TenantContext,
    staff_id: UUID,
    body: StaffUpdate,
    *,
    correlation_id: str | None = None,
) -> StaffOut:
    profile = await get_profile(db, tenant, staff_id)
    user = await db.get(User, profile.user_id)
    if user is None:
        raise NotFoundError("Staff user not found")

    changes = body.model_dump(exclude_unset=True)
    before: dict[str, Any] = {}

    # User-level fields
    if "full_name" in changes:
        before["full_name"] = user.full_name
        user.full_name = changes.pop("full_name").strip()
    if "email" in changes:
        before["email"] = user.email
        user.email = changes.pop("email").lower().strip()
    if "phone" in changes:
        phone_norm = normalize_phone(changes.pop("phone"))
        if not phone_norm:
            raise ValidationAppError("Invalid phone number", code="invalid_phone")
        before["phone"] = user.phone
        user.phone = phone_norm

    # Role change
    if "access_role" in changes:
        new_role = changes.pop("access_role")
        membership = await _membership_for(db, profile.hotel_id, user.id)
        if membership is not None:
            role = await _get_role(db, new_role)
            before["access_role"] = str(membership.role_id)
            membership.role_id = role.id

    # Profile fields
    for key, value in changes.items():
        before[key] = str(getattr(profile, key))
        setattr(profile, key, value)

    # Deactivation also disables login for this hotel.
    if profile.status == "inactive":
        membership = await _membership_for(db, profile.hotel_id, user.id)
        if membership is not None:
            membership.status = "disabled"
    elif profile.status == "active":
        membership = await _membership_for(db, profile.hotel_id, user.id)
        if membership is not None and membership.status != "active":
            membership.status = "active"

    await db.flush()
    await write_audit(
        db,
        action="staff.updated",
        entity_type="staff_profile",
        entity_id=profile.id,
        actor_id=tenant.user_id,
        hotel_id=profile.hotel_id,
        before={k: str(v) for k, v in before.items()},
        after={k: str(v) for k, v in body.model_dump(exclude_unset=True).items()},
        correlation_id=correlation_id,
    )
    return await get_staff(db, tenant, staff_id)


async def upload_photo(
    db: AsyncSession,
    tenant: TenantContext,
    staff_id: UUID,
    *,
    filename: str,
    content_type: str,
    data: bytes,
) -> None:
    from app.integrations.storage.base import get_storage, new_object_key

    if content_type not in ALLOWED_PHOTO_TYPES:
        raise ValidationAppError("Photo must be PNG, JPEG or WebP", code="invalid_photo_type")
    if len(data) > MAX_PHOTO_BYTES:
        raise ValidationAppError("Photo must be 2 MB or smaller", code="photo_too_large")
    profile = await get_profile(db, tenant, staff_id)
    key = new_object_key(f"hotels/{profile.hotel_id}/staff/{profile.id}/photo", filename)
    await get_storage().put_bytes(key=key, data=data, content_type=content_type)
    profile.photo_object_key = key
    await db.flush()


async def get_photo_bytes(
    db: AsyncSession, tenant: TenantContext, staff_id: UUID
) -> tuple[bytes, str]:
    from app.integrations.storage.base import get_storage

    profile = await get_profile(db, tenant, staff_id)
    if not profile.photo_object_key:
        raise NotFoundError("No photo uploaded")
    data = await get_storage().get_bytes(profile.photo_object_key)
    suffix = profile.photo_object_key.rsplit(".", 1)[-1].lower()
    media = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    return data, media
