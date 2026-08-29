from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ForbiddenError, UnauthorizedError, ValidationAppError
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    refresh_expiry,
    verify_password,
)
from app.models.user import HotelMembership, RefreshToken, User
from app.services.audit import write_audit


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    result = await db.execute(select(User).where(User.email == email.lower().strip()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise UnauthorizedError("Invalid email or password", code="invalid_credentials")
    if not user.is_active:
        raise ForbiddenError("Account is disabled", code="account_disabled")
    user.last_login_at = datetime.now(UTC)
    return user


async def issue_tokens(
    db: AsyncSession,
    user: User,
    *,
    hotel_id: UUID | None = None,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[str, str, RefreshToken]:
    claims: dict = {"is_super_admin": user.is_super_admin}
    if hotel_id:
        claims["hotel_id"] = str(hotel_id)
    access = create_access_token(subject=str(user.id), claims=claims)
    raw_refresh = generate_refresh_token()
    row = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=refresh_expiry(),
        user_agent=user_agent,
        ip_address=ip_address,
    )
    db.add(row)
    await db.flush()
    return access, raw_refresh, row


async def rotate_refresh_token(
    db: AsyncSession,
    raw_token: str,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[User, str, str]:
    token_hash = hash_token(raw_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    existing = result.scalar_one_or_none()
    if existing is None:
        raise UnauthorizedError("Invalid refresh token", code="invalid_refresh")

    now = datetime.now(UTC)
    if existing.revoked_at is not None:
        # Reuse detection: revoke all tokens for this user
        all_tokens = await db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == existing.user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        for t in all_tokens.scalars().all():
            t.revoked_at = now
        await write_audit(
            db,
            action="auth.refresh_reuse_detected",
            entity_type="refresh_token",
            entity_id=existing.id,
            actor_id=existing.user_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        # Persist the family revocation even though we raise: the request
        # transaction rolls back on error, and losing this would defeat
        # reuse detection.
        await db.commit()
        raise UnauthorizedError("Refresh token reuse detected", code="refresh_reuse")

    if existing.expires_at.replace(tzinfo=UTC) < now:
        existing.revoked_at = now
        raise UnauthorizedError("Refresh token expired", code="refresh_expired")

    user_result = await db.execute(select(User).where(User.id == existing.user_id))
    user = user_result.scalar_one()
    if not user.is_active:
        raise ForbiddenError("Account is disabled", code="account_disabled")

    existing.revoked_at = now
    access, new_raw, new_row = await issue_tokens(
        db, user, user_agent=user_agent, ip_address=ip_address
    )
    existing.replaced_by_id = new_row.id
    return user, access, new_raw


async def revoke_refresh_token(db: AsyncSession, raw_token: str) -> None:
    token_hash = hash_token(raw_token)
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    existing = result.scalar_one_or_none()
    if existing and existing.revoked_at is None:
        existing.revoked_at = datetime.now(UTC)


async def create_user(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    phone: str | None = None,
    is_super_admin: bool = False,
    must_reset_password: bool = False,
) -> User:
    email_norm = email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email_norm))
    if existing.scalar_one_or_none():
        raise ValidationAppError("Email already registered", code="email_taken")
    if len(password) < 8:
        raise ValidationAppError("Password must be at least 8 characters")
    user = User(
        email=email_norm,
        phone=phone,
        full_name=full_name.strip(),
        password_hash=hash_password(password),
        is_super_admin=is_super_admin,
        must_reset_password=must_reset_password,
    )
    db.add(user)
    await db.flush()
    return user


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Generate a single-use reset token. Silent when the email is unknown."""
    result = await db.execute(select(User).where(User.email == email.lower().strip()))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return
    raw_token = generate_refresh_token()
    user.password_reset_token_hash = hash_token(raw_token)
    user.password_reset_expires_at = datetime.now(UTC) + timedelta(hours=1)
    await db.flush()

    from app.integrations.email.base import EmailMessage, get_email_backend

    await get_email_backend().send(
        EmailMessage(
            to=user.email,
            subject="DigitalMyHotels — reset your password",
            body_text=(
                "Use this token to reset your password (valid for 1 hour):\n\n"
                f"{raw_token}\n\nIf you did not request this, ignore this email."
            ),
        )
    )
    await write_audit(
        db,
        action="auth.password_reset_requested",
        entity_type="user",
        entity_id=user.id,
        actor_id=user.id,
    )


async def confirm_password_reset(db: AsyncSession, token: str, new_password: str) -> User:
    token_hash = hash_token(token)
    result = await db.execute(
        select(User).where(User.password_reset_token_hash == token_hash)
    )
    user = result.scalar_one_or_none()
    if (
        user is None
        or user.password_reset_expires_at is None
        or user.password_reset_expires_at.replace(tzinfo=UTC) < datetime.now(UTC)
    ):
        raise UnauthorizedError("Invalid or expired reset token", code="invalid_reset_token")
    if len(new_password) < 8:
        raise ValidationAppError("Password must be at least 8 characters")
    user.password_hash = hash_password(new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    user.must_reset_password = False
    # Invalidate every active session after a reset.
    tokens = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    )
    now = datetime.now(UTC)
    for row in tokens.scalars().all():
        row.revoked_at = now
    await write_audit(
        db,
        action="auth.password_reset_completed",
        entity_type="user",
        entity_id=user.id,
        actor_id=user.id,
    )
    return user


async def change_password(
    db: AsyncSession, user: User, current_password: str, new_password: str
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise UnauthorizedError("Current password is incorrect", code="wrong_password")
    if len(new_password) < 8:
        raise ValidationAppError("Password must be at least 8 characters")
    user.password_hash = hash_password(new_password)
    user.must_reset_password = False
    await write_audit(
        db,
        action="auth.password_changed",
        entity_type="user",
        entity_id=user.id,
        actor_id=user.id,
    )


async def get_user_memberships(db: AsyncSession, user_id: UUID) -> list[HotelMembership]:
    result = await db.execute(
        select(HotelMembership)
        .options(selectinload(HotelMembership.role))
        .where(
            HotelMembership.user_id == user_id,
            HotelMembership.status == "active",
        )
    )
    return list(result.scalars().all())
