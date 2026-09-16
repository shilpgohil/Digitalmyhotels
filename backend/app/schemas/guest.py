from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def normalize_phone(raw: str) -> str:
    """Normalize a guest phone for storage/dedupe.

    Indian mobiles: +91 / 0 prefixes are stripped down to the 10-digit core
    (unchanged behavior — existing stored numbers keep matching).
    INTERNATIONAL guests (client 16/09: Australia 15, Germany/Austria/Sweden
    13+ digits): longer numbers are kept as-is up to the E.164 max of 15
    digits instead of being blindly truncated to the last 10.
    """
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits[:15]


def title_case_name(value: str) -> str:
    """First letter of every word uppercased, rest untouched (plan Phase 5:
    'while writing names first letter auto capital'). 'raj kumar' → 'Raj
    Kumar'; deliberate casing like 'RAJ' or 'McArthur' survives."""
    out: list[str] = []
    for word in value.split(" "):
        out.append(word[:1].upper() + word[1:] if word else word)
    return " ".join(out)


# Per-ID-type caps (plan Phase 5) — mirrors frontend lib/input-discipline.ts.
# (max_length, digits_only). Length-capped only; exact format is NOT enforced
# server-side so OCR'd and legacy values keep working.
_ID_LIMITS: dict[str, tuple[int, bool]] = {
    "Aadhar Card": (12, True),
    "PAN Card": (10, False),
    "Passport": (8, False),
    "Driving License": (16, False),
    "Voter ID": (10, False),
}


def validate_id_number(id_proof_type: str | None, id_number: str | None) -> None:
    if not id_proof_type or not id_number:
        return
    limit = _ID_LIMITS.get(id_proof_type)
    if limit is None:
        return
    max_len, digits_only = limit
    if len(id_number) > max_len:
        raise ValueError(
            f"{id_proof_type} number must be at most {max_len} characters"
        )
    if digits_only and not id_number.isdigit():
        raise ValueError(f"{id_proof_type} number must contain digits only")


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

    @field_validator("full_name")
    @classmethod
    def cap_name(cls, value: str) -> str:
        return title_case_name(value.strip())

    @model_validator(mode="after")
    def check_id_number(self) -> "GuestBase":
        validate_id_number(self.id_proof_type, self.id_number)
        return self


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

    @field_validator("full_name")
    @classmethod
    def cap_name(cls, value: str | None) -> str | None:
        return title_case_name(value.strip()) if value else value

    @model_validator(mode="after")
    def check_id_number(self) -> "GuestUpdate":
        validate_id_number(self.id_proof_type, self.id_number)
        return self


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
    # Guest belongs to ANOTHER hotel on the platform (plan §1.7) — selecting
    # them triggers an explicit, audited import instead of a plain autofill.
    cross_hotel: bool = False


class GuestImportRequest(BaseModel):
    """Import a guest found via cross-hotel search (plan §1.7).

    The FULL phone number is required as a knowledge proof: it must match the
    source guest exactly, so a guessed/leaked guest UUID alone cannot pull
    another hotel's guest data.
    """

    source_guest_id: UUID
    phone: str = Field(min_length=8, max_length=20)


class GuestListOut(BaseModel):
    items: list[GuestOut]
    total: int


class GuestSearchOut(BaseModel):
    items: list[GuestSearchResultOut]
