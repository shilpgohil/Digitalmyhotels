from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.core.tenant import TenantContext
from app.models.platform import Notification
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


async def list_notifications(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    unread_only: bool = False,
    category: str | None = None,
) -> NotificationListOut:
    hotel_id = tenant.hotel_id
    scope = Notification.user_id == tenant.user_id
    if hotel_id:
        scope = or_(
            Notification.user_id == tenant.user_id,
            (Notification.hotel_id == hotel_id) & Notification.user_id.is_(None),
        )
    query = select(Notification).where(scope).order_by(Notification.created_at.desc())
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    if category:
        query = query.where(Notification.category == category)
    items = list((await db.execute(query.limit(100))).scalars().all())
    unread = int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(scope, Notification.is_read.is_(False))
        )
        or 0
    )
    return NotificationListOut(
        items=[NotificationOut.model_validate(i) for i in items],
        total=len(items),
        unread=unread,
    )


async def mark_all_read(db: AsyncSession, tenant: TenantContext) -> int:
    """Mark all hotel notifications as read for this user. Returns count."""
    from sqlalchemy import update

    hotel_id = tenant.hotel_id
    scope = Notification.user_id == tenant.user_id
    if hotel_id:
        scope = or_(
            Notification.user_id == tenant.user_id,
            (Notification.hotel_id == hotel_id) & Notification.user_id.is_(None),
        )
    now = datetime.now(UTC)
    result = await db.execute(
        update(Notification)
        .where(scope, Notification.is_read.is_(False))
        .values(is_read=True, read_at=now)
    )
    return result.rowcount or 0


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
    row.is_read = True
    row.read_at = datetime.now(UTC)
    await db.flush()
    return row
