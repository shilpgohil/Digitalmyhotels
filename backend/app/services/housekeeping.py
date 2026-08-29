from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.room_status import RoomStatus, assert_transition
from app.models.ops import HousekeepingTask, MaintenanceRecord
from app.models.room import Room
from app.schemas.ops import HousekeepingAssign, HousekeepingTaskOut, MaintenanceCreate
from app.services.audit import write_audit


def _now() -> datetime:
    return datetime.now(UTC)


async def _room(db: AsyncSession, hotel_id: UUID, room_id: UUID) -> Room:
    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.hotel_id == hotel_id)
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room not found")
    return room


def _task_out(task: HousekeepingTask, room_number: str | None = None) -> HousekeepingTaskOut:
    return HousekeepingTaskOut(
        id=task.id,
        room_id=task.room_id,
        room_number=room_number,
        booking_id=task.booking_id,
        status=task.status,
        assigned_to_id=task.assigned_to_id,
        started_at=task.started_at,
        completed_at=task.completed_at,
        notes=task.notes,
        created_at=task.created_at,
    )


async def ensure_task_for_room(
    db: AsyncSession,
    *,
    hotel_id: UUID,
    room_id: UUID,
    booking_id: UUID | None = None,
) -> HousekeepingTask:
    """Create an open cleaning task if one is not already in progress."""
    existing = await db.execute(
        select(HousekeepingTask).where(
            HousekeepingTask.hotel_id == hotel_id,
            HousekeepingTask.room_id == room_id,
            HousekeepingTask.status.in_(
                ("cleaning_required", "cleaning_in_progress", "inspection_required")
            ),
        )
    )
    task = existing.scalar_one_or_none()
    if task:
        return task
    room = (await db.execute(select(Room).where(Room.id == room_id))).scalar_one_or_none()
    task = HousekeepingTask(
        hotel_id=hotel_id,
        room_id=room_id,
        booking_id=booking_id,
        status="cleaning_required",
    )
    db.add(task)
    await db.flush()
    if room:
        from app.models.booking import Booking as _Booking
        from app.models.guest import Guest as _Guest
        from app.services.notification_events import NE
        from app.services.notification_events import fire as _fire
        guest_name = "Guest"
        if booking_id:
            _bq = await db.execute(select(_Booking).where(_Booking.id == booking_id))
            booking = _bq.scalar_one_or_none()
            if booking and booking.primary_guest_id:
                g = await db.get(_Guest, booking.primary_guest_id)
                if g:
                    guest_name = g.full_name
        await _fire(db, hotel_id=hotel_id, event=NE.ROOM_CLEANING_REQUIRED, data={
            "room_number": room.room_number,
            "guest_name": guest_name,
        })
    return task


async def list_tasks(
    db: AsyncSession, tenant: TenantContext, *, status: str | None = None
) -> list[HousekeepingTaskOut]:
    hotel_id = tenant.require_hotel()
    query = (
        select(HousekeepingTask, Room.room_number)
        .join(Room, Room.id == HousekeepingTask.room_id)
        .where(HousekeepingTask.hotel_id == hotel_id)
        .order_by(HousekeepingTask.created_at.desc())
    )
    if status:
        query = query.where(HousekeepingTask.status == status)
    rows = (await db.execute(query)).all()
    return [_task_out(task, number) for task, number in rows]


async def start_task(
    db: AsyncSession,
    tenant: TenantContext,
    task_id: UUID,
    body: HousekeepingAssign,
    *,
    correlation_id: str | None = None,
) -> HousekeepingTaskOut:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(HousekeepingTask).where(
            HousekeepingTask.id == task_id, HousekeepingTask.hotel_id == hotel_id
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise NotFoundError("Housekeeping task not found")
    if task.status not in ("cleaning_required", "inspection_required"):
        raise ValidationAppError("Task cannot be started", code="invalid_hk_transition")
    room = await _room(db, hotel_id, task.room_id)
    assert_transition(room.status, RoomStatus.CLEANING_IN_PROGRESS)
    room.status = RoomStatus.CLEANING_IN_PROGRESS.value
    task.status = "cleaning_in_progress"
    task.started_at = _now()
    task.assigned_to_id = body.assigned_to_id or tenant.user_id
    if body.notes:
        task.notes = body.notes
    await db.flush()
    await write_audit(
        db,
        action="housekeeping.started",
        entity_type="housekeeping_task",
        entity_id=task.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        correlation_id=correlation_id,
    )
    return _task_out(task, room.room_number)


async def complete_task(
    db: AsyncSession,
    tenant: TenantContext,
    task_id: UUID,
    *,
    correlation_id: str | None = None,
) -> HousekeepingTaskOut:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(HousekeepingTask).where(
            HousekeepingTask.id == task_id, HousekeepingTask.hotel_id == hotel_id
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise NotFoundError("Housekeeping task not found")
    if task.status not in ("cleaning_in_progress", "cleaning_required"):
        raise ValidationAppError("Task cannot be completed", code="invalid_hk_transition")
    room = await _room(db, hotel_id, task.room_id)
    # Cleaning completion → Available (SRS).
    if room.status == RoomStatus.CLEANING_REQUIRED.value:
        assert_transition(room.status, RoomStatus.CLEANING_IN_PROGRESS)
        room.status = RoomStatus.CLEANING_IN_PROGRESS.value
    assert_transition(room.status, RoomStatus.CLEAN_READY)
    room.status = RoomStatus.CLEAN_READY.value
    assert_transition(room.status, RoomStatus.AVAILABLE)
    room.status = RoomStatus.AVAILABLE.value
    task.status = "completed"
    task.completed_at = _now()
    await db.flush()
    await write_audit(
        db,
        action="housekeeping.completed",
        entity_type="housekeeping_task",
        entity_id=task.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"room_id": str(room.id), "room_status": room.status},
        correlation_id=correlation_id,
    )
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    await _fire(
        db, hotel_id=hotel_id, event=NE.ROOM_CLEANED, data={"room_number": room.room_number}
    )
    return _task_out(task, room.room_number)


async def list_maintenance(db: AsyncSession, tenant: TenantContext) -> list[MaintenanceRecord]:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(MaintenanceRecord)
        .where(MaintenanceRecord.hotel_id == hotel_id)
        .order_by(MaintenanceRecord.created_at.desc())
    )
    return list(result.scalars().all())


async def open_maintenance(
    db: AsyncSession,
    tenant: TenantContext,
    body: MaintenanceCreate,
    *,
    correlation_id: str | None = None,
) -> MaintenanceRecord:
    hotel_id = tenant.require_hotel()
    room = await _room(db, hotel_id, body.room_id)
    assert_transition(room.status, RoomStatus.MAINTENANCE)
    room.status = RoomStatus.MAINTENANCE.value
    record = MaintenanceRecord(
        hotel_id=hotel_id,
        room_id=room.id,
        reason=body.reason,
        notes=body.notes,
        expected_completion=body.expected_completion,
        created_by_id=tenant.user_id,
    )
    db.add(record)
    await db.flush()
    await write_audit(
        db,
        action="maintenance.opened",
        entity_type="maintenance",
        entity_id=record.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"room_id": str(room.id), "reason": body.reason},
        correlation_id=correlation_id,
    )
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    await _fire(db, hotel_id=hotel_id, event=NE.MAINTENANCE_OPENED, data={
        "room_number": room.room_number, "reason": body.reason,
    })
    return record


async def resolve_maintenance(
    db: AsyncSession,
    tenant: TenantContext,
    record_id: UUID,
    *,
    correlation_id: str | None = None,
) -> MaintenanceRecord:
    hotel_id = tenant.require_hotel()
    result = await db.execute(
        select(MaintenanceRecord).where(
            MaintenanceRecord.id == record_id, MaintenanceRecord.hotel_id == hotel_id
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise NotFoundError("Maintenance record not found")
    if record.status == "resolved":
        return record
    room = await _room(db, hotel_id, record.room_id)
    assert_transition(room.status, RoomStatus.AVAILABLE)
    room.status = RoomStatus.AVAILABLE.value
    record.status = "resolved"
    record.resolved_at = _now()
    await db.flush()
    await write_audit(
        db,
        action="maintenance.resolved",
        entity_type="maintenance",
        entity_id=record.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        correlation_id=correlation_id,
    )
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    await _fire(
        db, hotel_id=hotel_id, event=NE.MAINTENANCE_RESOLVED,
        data={"room_number": room.room_number},
    )
    return record
