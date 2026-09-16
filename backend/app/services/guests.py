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


# ── Draft documents (check-in draft photo persistence, client 16/09) ─────────
# Queued co-guest photos survive "Save Draft" by uploading to a hotel-scoped
# draft area; the localStorage draft stores only the object keys.

DRAFT_DOC_TTL_DAYS = 7


def _draft_prefix(hotel_id: UUID) -> str:
    return f"hotels/{hotel_id}/draft-docs/"


async def add_draft_document(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    filename: str,
    content_type: str,
    data: bytes,
) -> str:
    """Store a draft-stage photo; returns the object key for the draft JSON."""
    from app.core.errors import ValidationAppError
    from app.integrations.storage.base import get_storage, new_object_key
    from app.models.guest import GuestDraftDocument

    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise ValidationAppError(
            "Document must be PNG, JPEG or WebP", code="invalid_document_type"
        )
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationAppError("Document must be 5 MB or smaller", code="document_too_large")

    hotel_id = tenant.require_hotel()
    key = new_object_key(f"hotels/{hotel_id}/draft-docs", filename)
    await get_storage().put_bytes(key=key, data=data, content_type=content_type)
    db.add(
        GuestDraftDocument(hotel_id=hotel_id, object_key=key, content_type=content_type)
    )
    await db.flush()
    return key


async def get_draft_document(
    db: AsyncSession, tenant: TenantContext, key: str
) -> tuple[bytes, str]:
    """Fetch a draft photo — key must belong to THIS hotel's draft area."""
    from app.core.errors import NotFoundError as _NF
    from app.integrations.storage.base import get_storage
    from app.models.guest import GuestDraftDocument

    hotel_id = tenant.require_hotel()
    if not key.startswith(_draft_prefix(hotel_id)):
        raise _NF("Draft document not found")
    row = (
        await db.execute(
            select(GuestDraftDocument).where(
                GuestDraftDocument.hotel_id == hotel_id,
                GuestDraftDocument.object_key == key,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise _NF("Draft document not found")
    data = await get_storage().get_bytes(key)
    return data, row.content_type


async def delete_draft_document(
    db: AsyncSession, tenant: TenantContext, key: str
) -> None:
    """Idempotent delete (restore-consumed / discarded drafts)."""
    from app.integrations.storage.base import get_storage
    from app.models.guest import GuestDraftDocument

    hotel_id = tenant.require_hotel()
    if not key.startswith(_draft_prefix(hotel_id)):
        return  # foreign/garbage key — silently ignore, nothing leaked
    row = (
        await db.execute(
            select(GuestDraftDocument).where(
                GuestDraftDocument.hotel_id == hotel_id,
                GuestDraftDocument.object_key == key,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return
    try:
        await get_storage().delete(key)
    except Exception:  # noqa: BLE001 — object already gone is fine
        pass
    await db.delete(row)
    await db.flush()


async def sweep_expired_draft_documents(db: AsyncSession) -> int:
    """Delete draft photos older than DRAFT_DOC_TTL_DAYS (abandoned drafts)."""
    from datetime import UTC as _UTC
    from datetime import datetime as _dt
    from datetime import timedelta as _td

    from app.integrations.storage.base import get_storage
    from app.models.guest import GuestDraftDocument

    cutoff = _dt.now(_UTC) - _td(days=DRAFT_DOC_TTL_DAYS)
    rows = (
        await db.execute(
            select(GuestDraftDocument).where(GuestDraftDocument.created_at < cutoff)
        )
    ).scalars().all()
    for row in rows:
        try:
            await get_storage().delete(row.object_key)
        except Exception:  # noqa: BLE001
            pass
        await db.delete(row)
    if rows:
        await db.commit()
    return len(rows)


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
    hits = [
        GuestSearchResultOut(
            id=g.id,
            full_name=g.full_name,
            phone_masked=_mask_phone(g.normalized_phone),
            id_last4=g.id_last4,
        )
        for g in result.scalars().all()
    ]

    # ── Cross-hotel search (plan §1.7, client: "other hotel customer detail
    # search not able to search"). ONLY for a FULL phone number (exact match,
    # ≥10 digits) — prefix search stays hotel-local so staff cannot trawl
    # other hotels' guest lists. Results are masked; selecting one triggers
    # the explicit, audited import.
    if phone:
        normalized_full = normalize_phone(phone)
        if normalized_full and len(normalized_full) >= 10:
            local_phones = {h.phone_masked for h in hits}
            cross_result = await db.execute(
                select(Guest)
                .where(
                    Guest.hotel_id != hotel_id,
                    Guest.normalized_phone == normalized_full,
                )
                .order_by(Guest.created_at.desc())
                .limit(5)
            )
            seen_names: set[str] = set()
            for g in cross_result.scalars().all():
                masked = _mask_phone(g.normalized_phone)
                # Skip if the same person already exists locally, and dedupe
                # identical copies across multiple hotels.
                if masked in local_phones or g.full_name.lower() in seen_names:
                    continue
                seen_names.add(g.full_name.lower())
                hits.append(
                    GuestSearchResultOut(
                        id=g.id,
                        full_name=g.full_name,
                        phone_masked=masked,
                        id_last4=g.id_last4,
                        cross_hotel=True,
                    )
                )
    return hits


async def import_guest(
    db: AsyncSession,
    tenant: TenantContext,
    source_guest_id: UUID,
    phone: str,
    *,
    correlation_id: str | None = None,
) -> Guest:
    """Copy a guest found via CROSS-HOTEL search into the current hotel
    (plan §1.7 — the ONE intended cross-hotel data share).

    Safeguards (master-context privacy doctrine):
    - Knowledge proof: the FULL phone must match the source guest exactly —
      a guessed/leaked guest UUID alone cannot pull another hotel's data.
    - Base identity data + ID document photos are copied; the encrypted full
      ID number and internal notes are NOT (the importing hotel re-verifies).
    - Idempotent: if this hotel already has a guest with that phone, the
      existing local record is returned untouched.
    - Audited with source hotel + guest ids.
    """
    from app.core.errors import ValidationAppError
    from app.models.guest import GuestDocument

    hotel_id = tenant.require_hotel()
    normalized = normalize_phone(phone)
    if not normalized:
        raise ValidationAppError("Invalid phone number", code="invalid_phone")

    source = (
        await db.execute(
            select(Guest).where(
                Guest.id == source_guest_id,
                Guest.normalized_phone == normalized,
                Guest.hotel_id != hotel_id,
            )
        )
    ).scalar_one_or_none()
    if source is None:
        # Same response whether the id is wrong or the phone doesn't match —
        # no enumeration signal.
        raise NotFoundError("Guest not found")

    existing = (
        await db.execute(
            select(Guest).where(
                Guest.hotel_id == hotel_id,
                Guest.normalized_phone == normalized,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    guest = Guest(
        hotel_id=hotel_id,
        full_name=source.full_name,
        normalized_phone=source.normalized_phone,
        email=source.email,
        address=source.address,
        city=source.city,
        state=source.state,
        country=source.country,
        postal_code=source.postal_code,
        gender=source.gender,
        date_of_birth=source.date_of_birth,
        id_proof_type=source.id_proof_type,
        id_last4=source.id_last4,
        # The importing hotel has not verified anything yet.
        id_verification_status="unverified",
    )
    db.add(guest)
    await db.flush()

    # Copy the NEWEST ID document per side into THIS hotel's storage prefix.
    # Storage failures are per-document non-fatal — the text import always
    # succeeds; staff can re-capture a missing photo at the desk.
    from app.integrations.storage.base import get_storage, new_object_key

    docs = (
        await db.execute(
            select(GuestDocument)
            .where(GuestDocument.guest_id == source.id)
            .order_by(GuestDocument.created_at.desc())
        )
    ).scalars().all()
    storage = get_storage()
    copied_sides: set[str] = set()
    copied = 0
    for doc in docs:
        side = doc.side or "front"
        if side in copied_sides:
            continue  # newest-first — keep only the latest per side
        try:
            data = await storage.get_bytes(doc.object_key)
            suffix = doc.object_key.rsplit(".", 1)[-1].lower()
            if suffix not in ("png", "jpg", "jpeg", "webp"):
                suffix = "jpg"
            content_type = {
                "png": "image/png",
                "webp": "image/webp",
            }.get(suffix, "image/jpeg")
            new_key = new_object_key(
                f"hotels/{hotel_id}/guests/{guest.id}", f"{side}.{suffix}"
            )
            await storage.put_bytes(key=new_key, data=data, content_type=content_type)
            db.add(
                GuestDocument(
                    hotel_id=hotel_id,
                    guest_id=guest.id,
                    document_type=doc.document_type,
                    object_key=new_key,
                    side=doc.side,
                )
            )
            copied_sides.add(side)
            copied += 1
        except Exception:  # noqa: BLE001 — per-doc failures must not abort
            continue

    await write_audit(
        db,
        action="guests.cross_hotel_import",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "source_guest_id": str(source.id),
            "source_hotel_id": str(source.hotel_id),
            "documents_copied": str(copied),
        },
        correlation_id=correlation_id,
    )
    return guest


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


async def reveal_guest_id(
    db: AsyncSession,
    tenant: TenantContext,
    guest_id: UUID,
    *,
    correlation_id: str | None = None,
) -> str | None:
    """Decrypt and return the full saved ID number — audited on EVERY use.

    Caller must hold GUESTS_VIEW_FULL_ID (route-enforced). The value is never
    part of list/search/autofill responses; this explicit action is the only
    way to read it, so the audit trail is complete by construction.
    """
    guest = await get_guest(db, tenant, guest_id)
    full_id = reveal_id_number(guest)
    await write_audit(
        db,
        action="guests.id_revealed",
        entity_type="guest",
        entity_id=guest.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        after={
            "id_proof_type": guest.id_proof_type,
            "id_last4": guest.id_last4,
            "had_value": full_id is not None,
        },
        correlation_id=correlation_id,
    )
    return full_id
