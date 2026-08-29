from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def normalize_phone(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    # Keep the last 10 digits (Indian mobile) — strips +91 / 0 prefixes.
    if len(digits) > 10:
        digits = digits[-10:]
    return digits


class GuestBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    phone: str = Field(min_length=7, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=2000)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    gender: str | None = Field(default=None, max_length=32)
    date_of_birth: date | None = None
    id_proof_type: str | None = Field(default=None, max_length=64)
    id_number: str | None = Field(default=None, min_length=4, max_length=64)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if len(normalized) < 7:
            raise ValueError("Phone number is too short")
        return value


class GuestCreate(GuestBase):
    pass


class GuestUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=2000)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    gender: str | None = Field(default=None, max_length=32)
    date_of_birth: date | None = None
    id_proof_type: str | None = Field(default=None, max_length=64)
    id_number: str | None = Field(default=None, min_length=4, max_length=64)
    notes: str | None = Field(default=None, max_length=4000)


class GuestOut(ORMModel):
    """Full guest record for guest-management screens."""

    id: UUID
    full_name: str
    normalized_phone: str
    email: str | None
    address: str | None
    city: str | None
    state: str | None
    country: str | None
    postal_code: str | None
    gender: str | None
    date_of_birth: date | None
    id_proof_type: str | None
    id_last4: str | None
    id_verification_status: str
    notes: str | None


class GuestAutofillOut(BaseModel):
    """Explicit autofill payload — base customer data ONLY.

    Never include booking history, stay counts or financial fields here.
    """

    id: UUID
    full_name: str
    phone: str
    email: str | None
    address: str | None
    city: str | None
    state: str | None
    country: str | None
    postal_code: str | None
    gender: str | None
    date_of_birth: date | None
    id_proof_type: str | None
    id_last4: str | None


class GuestSearchResultOut(BaseModel):
    """Minimal search hit shown before the user explicitly picks autofill."""

    id: UUID
    full_name: str
    phone_masked: str
    id_last4: str | None


class GuestListOut(BaseModel):
    items: list[GuestOut]
    total: int


class GuestSearchOut(BaseModel):
    items: list[GuestSearchResultOut]
