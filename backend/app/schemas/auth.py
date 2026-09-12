from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    # Kept as "email" for backward compatibility with existing clients, but
    # accepts either an email address or a phone number (phone-first team
    # accounts). Validation/lookup happens in auth_service.authenticate_user.
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1)
    hotel_id: UUID | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserOut"
    memberships: list["MembershipOut"] = []


class UserOut(ORMModel):
    id: UUID
    email: EmailStr
    full_name: str
    phone: str | None = None
    is_active: bool
    is_super_admin: bool
    must_reset_password: bool
    last_login_at: datetime | None = None


class MembershipOut(ORMModel):
    id: UUID
    hotel_id: UUID
    role_code: str
    role_name: str
    status: str


class MeResponse(BaseModel):
    user: UserOut
    memberships: list[MembershipOut]
    permissions: list[str] = []


class PasswordResetRequest(BaseModel):
    email: EmailStr


class AdminResetRequestIn(BaseModel):
    """Hierarchical reset request — email OR phone (client 9-08 item 34)."""

    identifier: str = Field(min_length=3, max_length=320)


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class UpdateMeRequest(BaseModel):
    """Self-profile edit (client 09/2026 — Edit option on admin Settings).

    Email is intentionally NOT editable here: it is the login identity and
    changing it without a verification flow risks lockouts.
    """

    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    phone: str | None = Field(default=None, max_length=32)


class MessageOut(BaseModel):
    message: str
