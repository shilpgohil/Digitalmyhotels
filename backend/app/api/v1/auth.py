from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_tenant_context
from app.core.config import get_settings
from app.core.permissions import permissions_for_role
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MembershipOut,
    MeResponse,
    MessageOut,
    PasswordResetConfirm,
    PasswordResetRequest,
    TokenResponse,
    UserOut,
)
from app.services import auth as auth_service
from app.services.audit import write_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, raw_refresh: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=raw_refresh,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        domain=settings.refresh_cookie_domain or None,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/api/v1/auth",
        domain=settings.refresh_cookie_domain or None,
    )


def _membership_outs(memberships) -> list[MembershipOut]:  # type: ignore[no-untyped-def]
    return [
        MembershipOut(
            id=m.id,
            hotel_id=m.hotel_id,
            role_code=m.role.code,
            role_name=m.role.name,
            status=m.status,
        )
        for m in memberships
    ]


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    settings = get_settings()
    from app.core.rate_limit import check_login_rate

    check_login_rate(request.client.host if request.client else body.email)
    user = await auth_service.authenticate_user(db, body.email, body.password)
    access, refresh, _ = await auth_service.issue_tokens(
        db,
        user,
        hotel_id=body.hotel_id,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    memberships = await auth_service.get_user_memberships(db, user.id)
    await write_audit(
        db,
        action="auth.login",
        entity_type="user",
        entity_id=user.id,
        actor_id=user.id,
        hotel_id=body.hotel_id,
        correlation_id=getattr(request.state, "correlation_id", None),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    _set_refresh_cookie(response, refresh)
    return TokenResponse(
        access_token=access,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
        memberships=_membership_outs(memberships),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    settings = get_settings()
    raw = request.cookies.get(settings.refresh_cookie_name)
    if not raw:
        from app.core.errors import UnauthorizedError

        raise UnauthorizedError("Missing refresh token", code="missing_refresh")
    user, access, new_refresh = await auth_service.rotate_refresh_token(
        db,
        raw,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    memberships = await auth_service.get_user_memberships(db, user.id)
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(
        access_token=access,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
        memberships=_membership_outs(memberships),
    )


@router.post("/logout", response_model=MessageOut)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    settings = get_settings()
    raw = request.cookies.get(settings.refresh_cookie_name)
    if raw:
        await auth_service.revoke_refresh_token(db, raw)
    _clear_refresh_cookie(response)
    return MessageOut(message="Logged out")


@router.post("/password-reset/request", response_model=MessageOut)
async def password_reset_request(
    body: PasswordResetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    from app.core.rate_limit import check_login_rate

    check_login_rate(request.client.host if request.client else str(body.email))
    await auth_service.request_password_reset(db, str(body.email))
    # Always the same response — never reveal whether the email exists.
    return MessageOut(message="If the email is registered, a reset token has been sent.")


@router.post("/password-reset/confirm", response_model=MessageOut)
async def password_reset_confirm(
    body: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    await auth_service.confirm_password_reset(db, body.token, body.new_password)
    return MessageOut(message="Password has been reset. Please sign in.")


@router.post("/change-password", response_model=MessageOut)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    await auth_service.change_password(db, user, body.current_password, body.new_password)
    return MessageOut(message="Password changed")


@router.get("/me", response_model=MeResponse)
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    tenant: TenantContext | None = None,
) -> MeResponse:
    memberships = await auth_service.get_user_memberships(db, user.id)
    perms: list[str] = []
    if user.is_super_admin:
        from app.core.permissions import Permission

        perms = [p.value for p in Permission]
    elif memberships:
        role = memberships[0].role.code
        perms = [p.value for p in permissions_for_role(role)]
    return MeResponse(
        user=UserOut.model_validate(user),
        memberships=_membership_outs(memberships),
        permissions=perms,
    )


@router.get("/me/context", response_model=MeResponse)
async def me_with_context(
    user: User = Depends(get_current_user),
    tenant: TenantContext = Depends(get_tenant_context),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    memberships = await auth_service.get_user_memberships(db, user.id)
    perms: list[str] = []
    if tenant.is_super_admin:
        from app.core.permissions import Permission

        perms = [p.value for p in Permission]
    elif tenant.role:
        perms = [p.value for p in permissions_for_role(tenant.role)]
    return MeResponse(
        user=UserOut.model_validate(user),
        memberships=_membership_outs(memberships),
        permissions=perms,
    )
