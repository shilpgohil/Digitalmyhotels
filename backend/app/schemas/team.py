from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.schemas.guest import title_case_name


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    membership_id: UUID
    user_id: UUID
    full_name: str
    # str (not EmailStr) — output schemas should not re-validate stored data;
    # EmailStr rejects reserved TLDs (.local, .test) used in dev seeds.
    email: str
    phone: str | None
    role_code: str
    role_name: str
    status: str
    is_active: bool
    last_login_at: datetime | None


class TeamMemberCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)

    @field_validator("full_name")
    @classmethod
    def cap_name(cls, value: str) -> str:
        """Auto-capitalize team member names (e.g. 'ranjit' → 'Ranjit')."""
        return title_case_name(value.strip())
    # Phone-first accounts: email is optional, but at least one of
    # email/phone must be provided (client Figma has no email field).
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    role_code: str = Field(
        pattern="^(manager|admin|housekeeping|receptionist|general_staff)$"
    )
    password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def _require_email_or_phone(self) -> "TeamMemberCreate":
        if not self.email and not (self.phone and self.phone.strip()):
            raise ValueError("Either email or phone is required")
        return self


class TeamMemberUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)

    @field_validator("full_name")
    @classmethod
    def cap_name(cls, value: str | None) -> str | None:
        return title_case_name(value.strip()) if value else value
    phone: str | None = Field(default=None, max_length=32)
    role_code: str | None = Field(
        default=None,
        pattern="^(manager|admin|housekeeping|receptionist|general_staff)$",
    )


class TeamMemberStatusUpdate(BaseModel):
    enabled: bool


class TeamPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class TeamListOut(BaseModel):
    items: list[TeamMemberOut]
    total: int
    # Team cap display "X of Y used" (client 15/09, plan §7.1).
    member_limit: int = 5
    active_members: int = 0
