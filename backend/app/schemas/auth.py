from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: EmailStr
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


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class MessageOut(BaseModel):
    message: str
