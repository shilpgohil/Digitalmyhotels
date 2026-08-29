from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.room_status import RoomStatus, assert_transition
from app.models.room import Room, RoomAmenity, RoomType
from app.schemas.room import (
    RoomCreate,
    RoomOut,
    RoomStatusUpdate,
    RoomTypeCreate,
    RoomTypeUpdate,
    RoomUpdate,
)
from app.services.audit import write_audit


def _room_out(room: Room) -> RoomOut:
    return RoomOut(
        id=room.id,
        room_number=room.room_number,
        floor=room.floor,
        bed_type=room.bed_type,
        status=room.status,
        is_active=room.is_active,
        notes=room.notes,
        room_type_id=room.room_type_id,
        room_type_name=room.room_type.name if room.room_type else None,
        amenities=[a.name for a in room.amenities],
    )


# --- Room types -----------------------------------------------------------------


async def list_room_types(
    db: AsyncSession, tenant: TenantContext, *, include_inactive: bool = False
) -> tuple[list[RoomType], int]:
    hotel_id = tenant.require_hotel()
    query = select(RoomType).where(RoomType.hotel_id == hotel_id)
    if not include_inactive:
        query = query.where(RoomType.is_active.is_(True))
    result = await db.execute(query.order_by(RoomType.name))
    items = list(result.scalars().all())
    return items, len(items)


async def get_room_type(db: AsyncSession, tenant: TenantContext, type_id: UUID) -> RoomType:
    result = await db.execute(
        select(RoomType).where(
            RoomType.id == type_id, RoomType.hotel_id == tenant.require_hotel()
        )
    )
    room_type = result.scalar_one_or_none()
    if room_type is None:
        raise NotFoundError("Room type not found")
    return room_type


async def create_room_type(
    db: AsyncSession,
    tenant: TenantContext,
    body: RoomTypeCreate,
    *,
    correlation_id: str | None = None,
) -> RoomType:
    hotel_id = tenant.require_hotel()
    existing = await db.execute(
        select(RoomType).where(
            RoomType.hotel_id == hotel_id, RoomType.code == body.code
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictError("A room type with this code already exists", code="duplicate_code")
    room_type = RoomType(hotel_id=hotel_id, **body.model_dump())
    db.add(room_type)
    await db.flush()
    await write_audit(
        db,
        action="rooms.type_created",
        entity_type="room_type",
        entity_id=room_type.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"code": body.code, "name": body.name, "base_price": str(body.base_price)},
        correlation_id=correlation_id,
    )
    return room_type


async def update_room_type(
    db: AsyncSession,
    tenant: TenantContext,
    type_id: UUID,
    body: RoomTypeUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomType:
    room_type = await get_room_type(db, tenant, type_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: str(getattr(room_type, k)) for k in changes}
    for key, value in changes.items():
        setattr(room_type, key, value)
    if changes:
        await write_audit(
            db,
            action="rooms.type_updated",
            entity_type="room_type",
            entity_id=room_type.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=correlation_id,
        )
    return room_type


# --- Rooms ----------------------------------------------------------------------


ROOM_LOAD_OPTIONS = (selectinload(Room.room_type), selectinload(Room.amenities))


async def list_rooms(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    status: str | None = None,
    room_type_id: UUID | None = None,
    include_inactive: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RoomOut], int]:
    hotel_id = tenant.require_hotel()
    query = select(Room).where(Room.hotel_id == hotel_id)
    if status:
        query = query.where(Room.status == status)
    if room_type_id:
        query = query.where(Room.room_type_id == room_type_id)
    if not include_inactive:
        query = query.where(Room.is_active.is_(True))
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    result = await db.execute(
        query.options(*ROOM_LOAD_OPTIONS)
        .order_by(Room.room_number)
        .limit(limit)
        .offset(offset)
    )
    return [_room_out(r) for r in result.scalars().all()], total


async def get_room(db: AsyncSession, tenant: TenantContext, room_id: UUID) -> Room:
    result = await db.execute(
        select(Room)
        .options(*ROOM_LOAD_OPTIONS)
        .where(Room.id == room_id, Room.hotel_id == tenant.require_hotel())
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room not found")
    return room


async def create_room(
    db: AsyncSession,
    tenant: TenantContext,
    body: RoomCreate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    hotel_id = tenant.require_hotel()
    room_type = await get_room_type(db, tenant, body.room_type_id)
    existing = await db.execute(
        select(Room).where(Room.hotel_id == hotel_id, Room.room_number == body.room_number)
    )
    if existing.scalar_one_or_none():
        raise ConflictError("A room with this number already exists", code="duplicate_room")
    room = Room(
        hotel_id=hotel_id,
        room_type_id=room_type.id,
        room_number=body.room_number,
        floor=body.floor,
        bed_type=body.bed_type,
        notes=body.notes,
        status=RoomStatus.AVAILABLE.value,
    )
    db.add(room)
    await db.flush()
    for name in dict.fromkeys(body.amenities):
        db.add(RoomAmenity(hotel_id=hotel_id, room_id=room.id, name=name))
    await db.flush()
    await write_audit(
        db,
        action="rooms.created",
        entity_type="room",
        entity_id=room.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"room_number": body.room_number, "room_type": room_type.code},
        correlation_id=correlation_id,
    )
    return _room_out(await get_room(db, tenant, room.id))


async def update_room(
    db: AsyncSession,
    tenant: TenantContext,
    room_id: UUID,
    body: RoomUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    room = await get_room(db, tenant, room_id)
    changes = body.model_dump(exclude_unset=True)
    amenities = changes.pop("amenities", None)

    if "room_number" in changes and changes["room_number"] != room.room_number:
        dup = await db.execute(
            select(Room).where(
                Room.hotel_id == room.hotel_id,
                Room.room_number == changes["room_number"],
                Room.id != room.id,
            )
        )
        if dup.scalar_one_or_none():
            raise ConflictError("A room with this number already exists", code="duplicate_room")

    if "room_type_id" in changes:
        await get_room_type(db, tenant, changes["room_type_id"])

    before = {k: str(getattr(room, k)) for k in changes}
    for key, value in changes.items():
        setattr(room, key, value)

    if amenities is not None:
        for amenity in list(room.amenities):
            await db.delete(amenity)
        await db.flush()
        for name in dict.fromkeys(amenities):
            db.add(RoomAmenity(hotel_id=room.hotel_id, room_id=room.id, name=name))
        await db.flush()

    if changes or amenities is not None:
        await write_audit(
            db,
            action="rooms.updated",
            entity_type="room",
            entity_id=room.id,
            actor_id=tenant.user_id,
            hotel_id=tenant.hotel_id,
            before=before,
            after={k: str(v) for k, v in changes.items()},
            correlation_id=correlation_id,
        )
    return _room_out(await get_room(db, tenant, room.id))


async def update_room_status(
    db: AsyncSession,
    tenant: TenantContext,
    room_id: UUID,
    body: RoomStatusUpdate,
    *,
    correlation_id: str | None = None,
) -> RoomOut:
    room = await get_room(db, tenant, room_id)
    if not room.is_active:
        raise ValidationAppError("Room is inactive", code="room_inactive")
    old_status = room.status
    # Manual status changes must respect the state machine; booking/checkout
    # services perform their own transitions with the same rules.
    if RoomStatus(body.status) in {RoomStatus.OCCUPIED, RoomStatus.RESERVED}:
        raise ValidationAppError(
            "Occupied/Reserved are set by the booking workflow, not manually",
            code="workflow_status",
        )
    assert_transition(old_status, body.status)
    room.status = body.status
    await write_audit(
        db,
        action="rooms.status_changed",
        entity_type="room",
        entity_id=room.id,
        actor_id=tenant.user_id,
        hotel_id=tenant.hotel_id,
        before={"status": old_status},
        after={"status": body.status, "reason": body.reason},
        correlation_id=correlation_id,
    )
    return _room_out(room)


async def status_summary(db: AsyncSession, tenant: TenantContext) -> dict[str, int]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(Room.status, func.count())
        .where(Room.hotel_id == hotel_id, Room.is_active.is_(True))
        .group_by(Room.status)
    )
    return {row[0]: row[1] for row in result.all()}
