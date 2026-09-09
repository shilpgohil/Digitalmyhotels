from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.core.permissions import notification_categories_for_role
from app.core.tenant import TenantContext
from app.models.platform import Notification, NotificationRead
from app.schemas.platform import NotificationListOut, NotificationOut


async def create_notification(
    db: AsyncSession,
    *,
    hotel_id: UUID | None,
    user_id: UUID | None,
    type: str,
    title: str,
    body: str,
    category: str = "front_desk",
    deep_link: str | None = None,
    payload: dict | None = None,
) -> Notification:
    row = Notification(
        hotel_id=hotel_id,
        user_id=user_id,
        type=type,
        category=category,
        title=title,
        body=body,
        deep_link=deep_link,
        payload=payload,
    )
    db.add(row)
    await db.flush()
    return row


def _visibility_scope(tenant: TenantContext):
    """WHERE clause: which notification rows this user may see at all.

    Personal notifications + hotel-wide ones for the active hotel, and only
    the categories the user's role is entitled to (client 9-08 items 1/2/35 —
    Housekeeping must never see finance/admin content).
    """
    scope = Notification.user_id == tenant.user_id
    if tenant.hotel_id:
        scope = or_(
            Notification.user_id == tenant.user_id,
            (Notification.hotel_id == tenant.hotel_id) & Notification.user_id.is_(None),
        )
    allowed = notification_categories_for_role(
        None if tenant.is_super_admin else tenant.role
    )
    return scope & Notification.category.in_(allowed), allowed


def _read_exists(tenant: TenantContext):
    """EXISTS subquery: a per-user read receipt for the outer notification."""
    return (
        select(NotificationRead.id)
        .where(
            NotificationRead.notification_id == Notification.id,
            NotificationRead.user_id == tenant.user_id,
        )
        .exists()
    )


async def list_notifications(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    unread_only: bool = False,
    category: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> NotificationListOut:
    scope, allowed = _visibility_scope(tenant)
    read_exists = _read_exists(tenant)

    query = select(Notification).where(scope).order_by(Notification.created_at.desc())
    if unread_only:
        query = query.where(~read_exists)
    if category:
        query = query.where(Notification.category == category)
    items = list((await db.execute(query.limit(limit).offset(offset))).scalars().all())

    # Per-user read state for the returned page.
    read_ids: set[UUID] = set()
    if items:
        read_rows = await db.execute(
            select(NotificationRead.notification_id).where(
                NotificationRead.user_id == tenant.user_id,
                NotificationRead.notification_id.in_([i.id for i in items]),
            )
        )
        read_ids = set(read_rows.scalars().all())

    unread = int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(scope, ~read_exists)
        )
        or 0
    )

    def _to_out(row: Notification) -> NotificationOut:
        out = NotificationOut.model_validate(row)
        out.is_read = row.id in read_ids
        out.read_at = row.read_at if row.id in read_ids else None
        return out

    return NotificationListOut(
        items=[_to_out(i) for i in items],
        total=len(items),
        unread=unread,
        allowed_categories=sorted(allowed),
    )


async def mark_all_read(db: AsyncSession, tenant: TenantContext) -> int:
    """Insert read receipts for every visible unread notification (this user
    only — other staff keep their own unread state). Returns count."""
    scope, _ = _visibility_scope(tenant)
    read_exists = _read_exists(tenant)
    unread_ids = list(
        (
            await db.execute(select(Notification.id).where(scope, ~read_exists))
        ).scalars()
    )
    if not unread_ids:
        return 0
    now = datetime.now(UTC)
    from uuid import uuid4

    await db.execute(
        pg_insert(NotificationRead)
        .values(
            [
                {
                    "id": uuid4(),
                    "notification_id": nid,
                    "user_id": tenant.user_id,
                    "read_at": now,
                }
                for nid in unread_ids
            ]
        )
        .on_conflict_do_nothing(index_elements=["notification_id", "user_id"])
    )
    return len(unread_ids)


async def mark_read(
    db: AsyncSession, tenant: TenantContext, notification_id: UUID
) -> Notification:
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise NotFoundError("Notification not found")
    if row.user_id and row.user_id != tenant.user_id:
        raise NotFoundError("Notification not found")
    if tenant.hotel_id and row.hotel_id and row.hotel_id != tenant.hotel_id:
        raise NotFoundError("Notification not found")

    now = datetime.now(UTC)
    from uuid import uuid4

    await db.execute(
        pg_insert(NotificationRead)
        .values(
            id=uuid4(),
            notification_id=row.id,
            user_id=tenant.user_id,
            read_at=now,
        )
        .on_conflict_do_nothing(index_elements=["notification_id", "user_id"])
    )
    # Keep the legacy flag for single-recipient (user-targeted) rows.
    if row.user_id == tenant.user_id:
        row.is_read = True
        row.read_at = now
    await db.flush()
    return row
