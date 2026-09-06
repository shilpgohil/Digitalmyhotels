from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    membership_id: UUID
    user_id: UUID
    full_name: str
    email: EmailStr
    phone: str | None
    role_code: str
    role_name: str
    status: str
    is_active: bool
    last_login_at: datetime | None


class TeamMemberCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    # Phone-first accounts: email is optional, but at least one of
    # email/phone must be provided (client Figma has no email field).
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    role_code: str = Field(pattern="^(manager|admin|housekeeping)$")
    password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def _require_email_or_phone(self) -> "TeamMemberCreate":
        if not self.email and not (self.phone and self.phone.strip()):
            raise ValueError("Either email or phone is required")
        return self


class TeamMemberUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    role_code: str | None = Field(default=None, pattern="^(manager|admin|housekeeping)$")


class TeamMemberStatusUpdate(BaseModel):
    enabled: bool


class TeamPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class TeamListOut(BaseModel):
    items: list[TeamMemberOut]
    total: int
