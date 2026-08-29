from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_sensitive, encrypt_sensitive
from app.core.errors import ConflictError, NotFoundError
from app.core.tenant import TenantContext
from app.models.guest import Guest
from app.schemas.guest import (
    GuestAutofillOut,
    GuestCreate,
    GuestOut,
    GuestSearchResultOut,
    GuestUpdate,
    normalize_phone,
)
from app.services.audit import write_audit

ALLOWED_DOCUMENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
DOCUMENT_SIDES = {"front", "back", "selfie"}


async def add_document(
    db: AsyncSession,
    tenant: TenantContext,
    guest_id: UUID,
    *,
    side: str,
    document_type: str,
    filename: str,
    content_type: str,
    data: bytes,
    correlation_id: str | None = None,
):
    from app.core.errors import ValidationAppError
    from app.integrations.storage.base import get_storage, new_object_key
    from app.models.guest import GuestDocument

    if side not in DOCUMENT_SIDES:
        raise ValidationAppError("side must be front, back or selfie", code="invalid_side")
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise ValidationAppError(
            "Document must be PNG, JPEG or WebP", code="invalid_document_type"
        )
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationAppError("Document must be 5 MB or smaller", code="document_too_large")

    guest = await get_guest(db, tenant, guest_id)
    hotel_id = tenant.require_hotel()
    key = new_object_key(f"hotels/{hotel_id}/guests/{guest.id}/{side}", filename)
    await get_storage().put_bytes(key=key, data=data, content_type=content_type)
    doc = GuestDocument(
        hotel_id=hotel_id,
        guest_id=guest.id,
        document_type=document_type,
        object_key=key,
        side=side,
    )
    db.add(doc)
    await db.flush()
    await write_audit(
        db,
        action="guests.document_added",
        entity_type="guest_document",
        entity_id=doc.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"side": side, "document_type": document_type},
        correlation_id=correlation_id,
    )
    return doc


async def list_documents(db: AsyncSession, tenant: TenantContext, guest_id: UUID):
    from app.models.guest import GuestDocument

    guest = await get_guest(db, tenant, guest_id)
    result = await db.execute(
        select(GuestDocument)
        .where(GuestDocument.guest_id == guest.id)
        .order_by(GuestDocument.created_at.desc())
    )
    return list(result.scalars().all())


async def get_document_bytes(
    db: AsyncSession, tenant: TenantContext, guest_id: UUID, document_id: UUID
) -> tuple[bytes, str]:
    from app.integrations.storage.base import get_storage
    from app.models.guest import GuestDocument

    guest = await get_guest(db, tenant, guest_id)
    result = await db.execute(
        select(GuestDocument).where(
            GuestDocument.id == document_id, GuestDocument.guest_id == guest.id
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise NotFoundError("Document not found")
    data = await get_storage().get_bytes(doc.object_key)
    suffix = doc.object_key.rsplit(".", 1)[-1].lower()
    media = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    return data, media


def _mask_phone(phone: str) -> str:
    if len(phone) <= 4:
        return "*" * len(phone)
    return "*" * (len(phone) - 4) + phone[-4:]


async def get_guest(db: AsyncSession, tenant: TenantContext, guest_id: UUID) -> Guest:
    result = await db.execute(
        select(Guest).where(Guest.id == guest_id, Guest.hotel_id == tenant.require_hotel())
    )
    guest = result.scalar_one_or_none()
    if guest is None:
        raise NotFoundError("Guest not found")
    return guest


async def list_guests(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    query: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Guest], int]:
    hotel_id = tenant.require_hotel()
    stmt = select(Guest).where(Guest.hotel_id == hotel_id)
    if query:
        normalized = normalize_phone(query)
        conditions: list = [Guest.full_name.ilike(f"%{query}%")]
        if normalized:
            conditions.append(Guest.normalized_phone.contains(normalized))
        stmt = stmt.where(or_(*conditions))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    result = await db.execute(
        stmt.order_by(Guest.full_name).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total


async def search_guests(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    phone: str | None = None,
    id_last4: str | None = None,
) -> list[GuestSearchResultOut]:
    """Search for the reuse workflow: phone prefix or last-4 ID digits.

    Phone search uses prefix matching so front-desk staff can search by
    partial numbers (e.g. "9800" finds all guests whose normalized phone
    starts with "9800"). Last-4 ID is exact match.

    Returns minimal identity hints only — full data requires the explicit
    autofill call, and booking history is never part of this workflow.
    """
    hotel_id = tenant.require_hotel()
    stmt = select(Guest).where(Guest.hotel_id == hotel_id)
    if phone:
        normalized = normalize_phone(phone)
        if not normalized:
            return []
        # Prefix match: entering "9800" finds "9800000001", "9800000002" etc.
        stmt = stmt.where(Guest.normalized_phone.startswith(normalized))
    elif id_last4:
        stmt = stmt.where(Guest.id_last4 == id_last4)
    else:
        return []
    result = await db.execute(stmt.order_by(Guest.full_name).limit(20))
    return [
        GuestSearchResultOut(
            id=g.id,
            full_name=g.full_name,
            phone_masked=_mask_phone(g.normalized_phone),
            id_last4=g.id_last4,
        )
        for g in result.scalars().all()
    ]


async def autofill_guest(
    db: AsyncSession,
    tenant: TenantContext,
    guest_id: UUID,
    *,
    correlation_id: str | None = None,
) -> GuestAutofillOut:
    """Explicit autofill action — audited, returns base customer data only."""
    guest = await get_guest(db, tenant, guest_id)
    await write_audit(
        db,
        action="guests.autofill_used",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        correlation_id=correlation_id,
    )
    return GuestAutofillOut(
        id=guest.id,
        full_name=guest.full_name,
        phone=guest.normalized_phone,
        email=guest.email,
        address=guest.address,
        city=guest.city,
        state=guest.state,
        country=guest.country,
        postal_code=guest.postal_code,
        gender=guest.gender,
        date_of_birth=guest.date_of_birth,
        id_proof_type=guest.id_proof_type,
        id_last4=guest.id_last4,
    )


def _apply_id_number(guest: Guest, id_number: str | None) -> None:
    if id_number:
        guest.id_encrypted = encrypt_sensitive(id_number)
        guest.id_last4 = id_number[-4:]


async def create_guest(
    db: AsyncSession,
    tenant: TenantContext,
    body: GuestCreate,
    *,
    correlation_id: str | None = None,
) -> Guest:
    hotel_id = tenant.require_hotel()
    normalized = normalize_phone(body.phone)
    existing = await db.execute(
        select(Guest).where(
            Guest.hotel_id == hotel_id, Guest.normalized_phone == normalized
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictError(
            "A guest with this phone number already exists — use search and autofill",
            code="guest_exists",
        )
    guest = Guest(
        hotel_id=hotel_id,
        full_name=body.full_name.strip(),
        normalized_phone=normalized,
        email=body.email,
        address=body.address,
        city=body.city,
        state=body.state,
        country=body.country,
        postal_code=body.postal_code,
        gender=body.gender,
        date_of_birth=body.date_of_birth,
        id_proof_type=body.id_proof_type,
        notes=body.notes,
    )
    _apply_id_number(guest, body.id_number)
    db.add(guest)
    await db.flush()
    await write_audit(
        db,
        action="guests.created",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"full_name": guest.full_name, "phone_last4": normalized[-4:]},
        correlation_id=correlation_id,
    )
    return guest


async def update_guest(
    db: AsyncSession,
    tenant: TenantContext,
    guest_id: UUID,
    body: GuestUpdate,
    *,
    correlation_id: str | None = None,
) -> Guest:
    guest = await get_guest(db, tenant, guest_id)
    changes = body.model_dump(exclude_unset=True)
    id_number = changes.pop("id_number", None)
    phone = changes.pop("phone", None)

    if phone:
        normalized = normalize_phone(phone)
        if normalized != guest.normalized_phone:
            dup = await db.execute(
                select(Guest).where(
                    Guest.hotel_id == guest.hotel_id,
                    Guest.normalized_phone == normalized,
                    Guest.id != guest.id,
                )
            )
            if dup.scalar_one_or_none():
                raise ConflictError(
                    "Another guest already uses this phone number", code="guest_exists"
                )
            guest.normalized_phone = normalized

    for key, value in changes.items():
        setattr(guest, key, value)
    _apply_id_number(guest, id_number)

    await write_audit(
        db,
        action="guests.updated",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        after={k: str(v) for k, v in changes.items() if k not in {"notes", "address"}},
        correlation_id=correlation_id,
    )
    return guest


def to_out(guest: Guest) -> GuestOut:
    return GuestOut.model_validate(guest)


def reveal_id_number(guest: Guest) -> str | None:
    """Full ID for authorized verification workflows only."""
    if not guest.id_encrypted:
        return None
    return decrypt_sensitive(guest.id_encrypted)
