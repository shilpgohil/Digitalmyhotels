"""Staff attendance service — geofenced check-in/out, reports, corrections.

Geofence policy (client 09/2026):
- Hotel admin controls BOTH the radius and an on/off toggle
  (hotels.geofence_enabled / geofence_radius_m / latitude / longitude).
- SELF check-in/out is validated server-side (never trust the client verdict).
- Front-desk records skip the fence — the operator's identity + audit is the
  control (they are physically at the desk terminal).
- Manual corrections require staff.attendance_correct + a mandatory note.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.tenant import TenantContext
from app.domain.geo import haversine_m
from app.models.hotel import Hotel
from app.models.staff import AttendanceRecord, StaffLeave, StaffProfile
from app.models.user import User
from app.schemas.staff import (
    AnomaliesOut,
    AnomalyRowOut,
    AttendanceCorrectionIn,
    AttendanceRowOut,
    CalendarDayOut,
    CalendarOut,
    CheckInIn,
    LeaveCreate,
    LeaveDecisionIn,
    LeaveOut,
    SelfTodayOut,
    TodayAttendanceOut,
    TodayStatsOut,
)
from app.services.audit import write_audit
from app.services.staff import get_profile, hotel_today, hotel_tz

LATE_GRACE_MINUTES = 10
# Missing check-outs auto-close this long after shift end (or at 23:59).
AUTO_CLOSE_AFTER_HOURS = 4
# GPS accuracy grace is capped so a vague IP-based fix can't bypass the fence.
MAX_ACCURACY_GRACE_M = 100.0

ALLOWED_SELFIE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_SELFIE_BYTES = 5 * 1024 * 1024


# ── Geofence ─────────────────────────────────────────────────────────────────


def enforce_geofence(
    hotel: Hotel, lat: float | None, lng: float | None, accuracy_m: float | None
) -> float | None:
    """Validate a self check-in/out position against the hotel geofence.

    Returns the computed distance in metres (for the audit trail), or None
    when geofencing is disabled/unconfigured. Raises on violations.
    """
    if not hotel.geofence_enabled:
        return None
    if hotel.latitude is None or hotel.longitude is None:
        # Toggle on but no coordinates (shouldn't happen — PATCH validates) —
        # fail open rather than lock every employee out.
        return None
    if lat is None or lng is None:
        raise ValidationAppError(
            "Location is required to check in at this hotel", code="location_required"
        )
    distance = haversine_m(float(lat), float(lng), float(hotel.latitude), float(hotel.longitude))
    grace = min(float(accuracy_m or 0.0), MAX_ACCURACY_GRACE_M)
    if distance > float(hotel.geofence_radius_m) + grace:
        raise ValidationAppError(
            f"You are ~{int(distance)} m from the property — move within "
            f"{hotel.geofence_radius_m} m to check in",
            code="geofence_violation",
        )
    return distance


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _hotel(db: AsyncSession, tenant: TenantContext) -> Hotel:
    hotel = await db.get(Hotel, tenant.require_hotel())
    if hotel is None:
        raise NotFoundError("Hotel not found")
    return hotel


async def get_or_create_own_profile(
    db: AsyncSession, tenant: TenantContext
) -> StaffProfile:
    """Managers/admins/owners self check-in too — lazily create their profile."""
    hotel_id = tenant.require_hotel()
    profile = (
        await db.execute(
            select(StaffProfile).where(
                StaffProfile.hotel_id == hotel_id,
                StaffProfile.user_id == tenant.user_id,
            )
        )
    ).scalar_one_or_none()
    if profile is not None:
        return profile
    from app.services.staff import _next_staff_code

    hotel = await _hotel(db, tenant)
    profile = StaffProfile(
        hotel_id=hotel_id,
        user_id=tenant.user_id,
        staff_code=await _next_staff_code(db, hotel_id),
        department="management",
        joining_date=hotel_today(hotel),
        status="active",
    )
    db.add(profile)
    await db.flush()
    return profile


def _late_minutes(profile: StaffProfile, checkin_local: datetime) -> int | None:
    if profile.shift_start is None:
        return None
    shift_dt = checkin_local.replace(
        hour=profile.shift_start.hour,
        minute=profile.shift_start.minute,
        second=0,
        microsecond=0,
    )
    delta = (checkin_local - shift_dt).total_seconds() / 60
    return int(delta) if delta > LATE_GRACE_MINUTES else None


def _early_out_minutes(profile: StaffProfile, checkout_local: datetime) -> int | None:
    if profile.shift_end is None:
        return None
    shift_dt = checkout_local.replace(
        hour=profile.shift_end.hour,
        minute=profile.shift_end.minute,
        second=0,
        microsecond=0,
    )
    delta = (shift_dt - checkout_local).total_seconds() / 60
    return int(delta) if delta > 0 else None


async def _record_for(
    db: AsyncSession, profile: StaffProfile, work_date: date
) -> AttendanceRecord | None:
    return (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.staff_profile_id == profile.id,
                AttendanceRecord.work_date == work_date,
            )
        )
    ).scalar_one_or_none()


def _apply_check_in(
    record: AttendanceRecord,
    profile: StaffProfile,
    *,
    now_utc: datetime,
    now_local: datetime,
    method: str,
    lat: float | None = None,
    lng: float | None = None,
    accuracy_m: float | None = None,
    distance_m: float | None = None,
    selfie_key: str | None = None,
    performed_by: UUID | None = None,
) -> None:
    record.check_in_at = now_utc
    record.method_in = method
    record.performed_by_id = performed_by
    record.check_in_lat = Decimal(str(lat)) if lat is not None else None
    record.check_in_lng = Decimal(str(lng)) if lng is not None else None
    record.check_in_accuracy_m = (
        Decimal(str(round(accuracy_m, 1))) if accuracy_m is not None else None
    )
    record.check_in_distance_m = (
        Decimal(str(round(distance_m, 1))) if distance_m is not None else None
    )
    if selfie_key:
        record.check_in_selfie_key = selfie_key
    late = _late_minutes(profile, now_local)
    record.late_minutes = late
    record.status = "late" if late else "present"


def _apply_check_out(
    record: AttendanceRecord,
    profile: StaffProfile,
    *,
    now_utc: datetime,
    now_local: datetime,
    method: str,
    lat: float | None = None,
    lng: float | None = None,
    accuracy_m: float | None = None,
    distance_m: float | None = None,
    performed_by: UUID | None = None,
) -> None:
    record.check_out_at = now_utc
    record.method_out = method
    if performed_by is not None:
        record.performed_by_id = performed_by
    record.check_out_lat = Decimal(str(lat)) if lat is not None else None
    record.check_out_lng = Decimal(str(lng)) if lng is not None else None
    record.check_out_accuracy_m = (
        Decimal(str(round(accuracy_m, 1))) if accuracy_m is not None else None
    )
    record.check_out_distance_m = (
        Decimal(str(round(distance_m, 1))) if distance_m is not None else None
    )
    record.early_out_minutes = _early_out_minutes(profile, now_local)


# ── Self service ─────────────────────────────────────────────────────────────


async def self_check_in(
    db: AsyncSession,
    tenant: TenantContext,
    body: CheckInIn,
    *,
    correlation_id: str | None = None,
) -> AttendanceRecord:
    hotel = await _hotel(db, tenant)
    profile = await get_or_create_own_profile(db, tenant)
    distance = enforce_geofence(hotel, body.lat, body.lng, body.accuracy_m)

    now_utc = datetime.now(UTC)
    now_local = now_utc.astimezone(hotel_tz(hotel))
    work_date = now_local.date()

    record = await _record_for(db, profile, work_date)
    if record is not None and record.check_in_at is not None:
        raise ConflictError("Already checked in today", code="already_checked_in")
    if record is None:
        record = AttendanceRecord(
            hotel_id=hotel.id, staff_profile_id=profile.id, work_date=work_date
        )
        db.add(record)

    _apply_check_in(
        record,
        profile,
        now_utc=now_utc,
        now_local=now_local,
        method="self_geo",
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        distance_m=distance,
        selfie_key=body.selfie_key,
    )
    await db.flush()
    return record


async def self_check_out(
    db: AsyncSession,
    tenant: TenantContext,
    body: CheckInIn,
    *,
    correlation_id: str | None = None,
) -> AttendanceRecord:
    hotel = await _hotel(db, tenant)
    profile = await get_or_create_own_profile(db, tenant)
    distance = enforce_geofence(hotel, body.lat, body.lng, body.accuracy_m)

    now_utc = datetime.now(UTC)
    now_local = now_utc.astimezone(hotel_tz(hotel))
    work_date = now_local.date()
    record = await _record_for(db, profile, work_date)
    # Overnight shift: no record today → close yesterday's open record.
    if record is None or record.check_in_at is None:
        record = await _record_for(db, profile, work_date - timedelta(days=1))
    if record is None or record.check_in_at is None:
        raise ValidationAppError("Check in first", code="not_checked_in")
    if record.check_out_at is not None:
        raise ConflictError("Already checked out", code="already_checked_out")

    _apply_check_out(
        record,
        profile,
        now_utc=now_utc,
        now_local=now_local,
        method="self_geo",
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        distance_m=distance,
    )
    await db.flush()
    return record


async def self_today(db: AsyncSession, tenant: TenantContext) -> SelfTodayOut:
    hotel = await _hotel(db, tenant)
    hotel_id = tenant.require_hotel()
    profile = (
        await db.execute(
            select(StaffProfile).where(
                StaffProfile.hotel_id == hotel_id,
                StaffProfile.user_id == tenant.user_id,
            )
        )
    ).scalar_one_or_none()
    user = await db.get(User, tenant.user_id)
    today = hotel_today(hotel)

    record = await _record_for(db, profile, today) if profile else None
    if record is None and profile is not None:
        # An open overnight shift from yesterday still counts as "working".
        prev = await _record_for(db, profile, today - timedelta(days=1))
        if prev is not None and prev.check_in_at and not prev.check_out_at:
            record = prev

    status = "not_checked_in"
    working_minutes: int | None = None
    if record is not None and record.check_in_at is not None:
        if record.check_out_at is None:
            status = "working"
            working_minutes = int(
                (datetime.now(tz=record.check_in_at.tzinfo) - record.check_in_at).total_seconds()
                // 60
            )
        else:
            status = "checked_out"
            working_minutes = int(
                (record.check_out_at - record.check_in_at).total_seconds() // 60
            )
    return SelfTodayOut(
        staff_profile_id=profile.id if profile else None,
        staff_code=profile.staff_code if profile else None,
        full_name=user.full_name if user else "",
        department=profile.department if profile else None,
        geofence_enabled=bool(hotel.geofence_enabled),
        work_date=record.work_date if record else today,
        check_in_at=record.check_in_at if record else None,
        check_out_at=record.check_out_at if record else None,
        working_minutes=working_minutes,
        status=status,
    )


# ── Front desk + corrections ─────────────────────────────────────────────────


async def front_desk_record(
    db: AsyncSession,
    tenant: TenantContext,
    staff_id: UUID,
    action: str,
    *,
    correlation_id: str | None = None,
) -> AttendanceRecord:
    hotel = await _hotel(db, tenant)
    profile = await get_profile(db, tenant, staff_id)
    now_utc = datetime.now(UTC)
    now_local = now_utc.astimezone(hotel_tz(hotel))
    work_date = now_local.date()
    record = await _record_for(db, profile, work_date)

    if action == "in":
        if record is not None and record.check_in_at is not None:
            raise ConflictError("Already checked in today", code="already_checked_in")
        if record is None:
            record = AttendanceRecord(
                hotel_id=hotel.id, staff_profile_id=profile.id, work_date=work_date
            )
            db.add(record)
        _apply_check_in(
            record,
            profile,
            now_utc=now_utc,
            now_local=now_local,
            method="front_desk",
            performed_by=tenant.user_id,
        )
    else:
        if record is None or record.check_in_at is None:
            record = await _record_for(db, profile, work_date - timedelta(days=1))
        if record is None or record.check_in_at is None:
            raise ValidationAppError("Staff member has not checked in", code="not_checked_in")
        if record.check_out_at is not None:
            raise ConflictError("Already checked out", code="already_checked_out")
        _apply_check_out(
            record,
            profile,
            now_utc=now_utc,
            now_local=now_local,
            method="front_desk",
            performed_by=tenant.user_id,
        )

    await db.flush()
    await write_audit(
        db,
        action="staff.attendance_recorded",
        entity_type="attendance_record",
        entity_id=record.id,
        actor_id=tenant.user_id,
        hotel_id=hotel.id,
        after={"staff_code": profile.staff_code, "action": action, "method": "front_desk"},
        correlation_id=correlation_id,
    )
    return record


async def correct_record(
    db: AsyncSession,
    tenant: TenantContext,
    record_id: UUID,
    body: AttendanceCorrectionIn,
    *,
    correlation_id: str | None = None,
) -> AttendanceRecord:
    hotel_id = tenant.require_hotel()
    record = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.id == record_id, AttendanceRecord.hotel_id == hotel_id
            )
        )
    ).scalar_one_or_none()
    if record is None:
        raise NotFoundError("Attendance record not found")
    if (
        body.check_in_at is not None
        and body.check_out_at is not None
        and body.check_out_at <= body.check_in_at
    ):
        raise ValidationAppError("Check-out must be after check-in")

    before = {
        "check_in_at": str(record.check_in_at),
        "check_out_at": str(record.check_out_at),
        "status": record.status,
    }
    if body.check_in_at is not None:
        record.check_in_at = body.check_in_at
        record.method_in = "manual"
    if body.check_out_at is not None:
        record.check_out_at = body.check_out_at
        record.method_out = "manual"
    if body.status is not None:
        record.status = body.status
    record.note = body.note
    record.performed_by_id = tenant.user_id
    await db.flush()
    await write_audit(
        db,
        action="staff.attendance_corrected",
        entity_type="attendance_record",
        entity_id=record.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        before=before,
        after={
            "check_in_at": str(record.check_in_at),
            "check_out_at": str(record.check_out_at),
            "status": record.status,
            "note": body.note,
        },
        correlation_id=correlation_id,
    )
    return record


# ── Views: today / history / calendar / anomalies ────────────────────────────


def _row_status(profile_status: str, rec: AttendanceRecord | None) -> str:
    if rec is None:
        return "on_leave" if profile_status == "on_leave" else "not_checked_in"
    if rec.status in ("absent", "leave", "off", "holiday"):
        return rec.status
    if rec.check_in_at and not rec.check_out_at:
        return "late" if rec.status == "late" else "working"
    if rec.check_out_at:
        return "checked_out"
    return rec.status


def _working_minutes(rec: AttendanceRecord | None) -> int | None:
    if rec is None or rec.check_in_at is None:
        return None
    end = rec.check_out_at or datetime.now(tz=rec.check_in_at.tzinfo)
    return int((end - rec.check_in_at).total_seconds() // 60)


async def today_attendance(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    on_date: date | None = None,
    department: str | None = None,
    status_filter: str | None = None,
) -> TodayAttendanceOut:
    hotel = await _hotel(db, tenant)
    day = on_date or hotel_today(hotel)
    hotel_id = tenant.require_hotel()

    base = (
        select(StaffProfile, User)
        .join(User, User.id == StaffProfile.user_id)
        .where(StaffProfile.hotel_id == hotel_id, StaffProfile.status != "inactive")
    )
    if department:
        base = base.where(StaffProfile.department == department)
    staff_rows = (await db.execute(base.order_by(StaffProfile.staff_code))).all()

    recs = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.hotel_id == hotel_id,
                AttendanceRecord.work_date == day,
            )
        )
    ).scalars()
    rec_by_staff = {r.staff_profile_id: r for r in recs}

    items: list[AttendanceRowOut] = []
    stats = {"total": 0, "present": 0, "working": 0, "checked_out": 0, "absent": 0, "late": 0}
    for profile, user in staff_rows:
        rec = rec_by_staff.get(profile.id)
        row_status = _row_status(profile.status, rec)
        stats["total"] += 1
        if rec is not None and rec.check_in_at is not None:
            stats["present"] += 1
        if row_status == "working" or (row_status == "late" and rec and not rec.check_out_at):
            stats["working"] += 1
        if row_status == "checked_out":
            stats["checked_out"] += 1
        # Not-checked-in staff count as absent-so-far (mockup "Requires attention").
        if row_status in ("absent", "not_checked_in"):
            stats["absent"] += 1
        if rec is not None and rec.late_minutes:
            stats["late"] += 1

        if status_filter and status_filter != "all":
            is_working = row_status == "working" or (
                row_status == "late" and rec is not None and rec.check_out_at is None
            )
            match = {
                "present": rec is not None and rec.check_in_at is not None,
                "working": is_working,
                "checked_out": row_status == "checked_out",
                "absent": row_status in ("absent", "not_checked_in"),
                "late": rec is not None and bool(rec.late_minutes),
            }.get(status_filter, True)
            if not match:
                continue

        items.append(
            AttendanceRowOut(
                record_id=rec.id if rec else None,
                staff_profile_id=profile.id,
                staff_code=profile.staff_code,
                full_name=user.full_name,
                department=profile.department,
                work_date=day,
                check_in_at=rec.check_in_at if rec else None,
                check_out_at=rec.check_out_at if rec else None,
                working_minutes=_working_minutes(rec),
                late_minutes=rec.late_minutes if rec else None,
                early_out_minutes=rec.early_out_minutes if rec else None,
                status=row_status,
                method_in=rec.method_in if rec else None,
                method_out=rec.method_out if rec else None,
            )
        )
    return TodayAttendanceOut(stats=TodayStatsOut(**stats), items=items)


async def history(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    from_date: date,
    to_date: date,
    department: str | None = None,
    status_filter: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AttendanceRowOut], int]:
    hotel_id = tenant.require_hotel()
    base = (
        select(AttendanceRecord, StaffProfile, User)
        .join(StaffProfile, StaffProfile.id == AttendanceRecord.staff_profile_id)
        .join(User, User.id == StaffProfile.user_id)
        .where(
            AttendanceRecord.hotel_id == hotel_id,
            AttendanceRecord.work_date >= from_date,
            AttendanceRecord.work_date <= to_date,
        )
    )
    if department:
        base = base.where(StaffProfile.department == department)
    if status_filter:
        base = base.where(AttendanceRecord.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        base = base.where(User.full_name.ilike(like) | StaffProfile.staff_code.ilike(like))

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(
            base.order_by(AttendanceRecord.work_date.desc(), StaffProfile.staff_code)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = [
        AttendanceRowOut(
            record_id=rec.id,
            staff_profile_id=profile.id,
            staff_code=profile.staff_code,
            full_name=user.full_name,
            department=profile.department,
            work_date=rec.work_date,
            check_in_at=rec.check_in_at,
            check_out_at=rec.check_out_at,
            working_minutes=_working_minutes(rec),
            late_minutes=rec.late_minutes,
            early_out_minutes=rec.early_out_minutes,
            status=_row_status(profile.status, rec),
            method_in=rec.method_in,
            method_out=rec.method_out,
        )
        for rec, profile, user in rows
    ]
    return items, int(total)


async def calendar(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    staff_id: UUID,
    month: str,
) -> CalendarOut:
    profile = await get_profile(db, tenant, staff_id)
    try:
        year, mon = (int(x) for x in month.split("-"))
        first = date(year, mon, 1)
    except (ValueError, TypeError) as exc:
        raise ValidationAppError("month must be YYYY-MM") from exc
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

    recs = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.staff_profile_id == profile.id,
                AttendanceRecord.work_date >= first,
                AttendanceRecord.work_date <= last,
            )
        )
    ).scalars()
    by_day = {r.work_date: r for r in recs}
    days: list[CalendarDayOut] = []
    present = late = absent = leave = 0
    d = first
    while d <= last:
        rec = by_day.get(d)
        status: str | None = None
        if rec is not None:
            status = _row_status(profile.status, rec)
            if rec.check_in_at is not None:
                present += 1
            if rec.late_minutes:
                late += 1
            if rec.status == "absent":
                absent += 1
            if rec.status == "leave":
                leave += 1
        elif profile.weekly_off is not None and d.weekday() == _weekly_off_to_weekday(
            profile.weekly_off
        ):
            status = "off"
        days.append(
            CalendarDayOut(
                day=d,
                status=status,
                check_in_at=rec.check_in_at if rec else None,
                check_out_at=rec.check_out_at if rec else None,
                late_minutes=rec.late_minutes if rec else None,
            )
        )
        d += timedelta(days=1)
    return CalendarOut(
        month=month,
        days=days,
        present_days=present,
        late_days=late,
        absent_days=absent,
        leave_days=leave,
    )


def _weekly_off_to_weekday(weekly_off: int) -> int:
    """Our weekly_off uses 0=Sunday…6=Saturday; date.weekday() is 0=Monday."""
    return (weekly_off - 1) % 7


async def anomalies(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    from_date: date,
    to_date: date,
    department: str | None = None,
) -> AnomaliesOut:
    hotel_id = tenant.require_hotel()
    base = (
        select(AttendanceRecord, StaffProfile, User)
        .join(StaffProfile, StaffProfile.id == AttendanceRecord.staff_profile_id)
        .join(User, User.id == StaffProfile.user_id)
        .where(
            AttendanceRecord.hotel_id == hotel_id,
            AttendanceRecord.work_date >= from_date,
            AttendanceRecord.work_date <= to_date,
        )
    )
    if department:
        base = base.where(StaffProfile.department == department)
    rows = (await db.execute(base.order_by(AttendanceRecord.work_date.desc()))).all()

    items: list[AnomalyRowOut] = []
    late_count = early_count = missing_count = 0
    late_total = 0
    for rec, profile, user in rows:
        missing = bool(rec.check_in_at) and rec.check_out_at is None and rec.work_date < to_date
        is_late = bool(rec.late_minutes)
        is_early = bool(rec.early_out_minutes)
        if not (is_late or is_early or missing):
            continue
        if is_late:
            late_count += 1
            late_total += rec.late_minutes or 0
        if is_early:
            early_count += 1
        if missing:
            missing_count += 1
        items.append(
            AnomalyRowOut(
                staff_profile_id=profile.id,
                staff_code=profile.staff_code,
                full_name=user.full_name,
                department=profile.department,
                work_date=rec.work_date,
                check_in_at=rec.check_in_at,
                check_out_at=rec.check_out_at,
                expected_in=profile.shift_start,
                late_minutes=rec.late_minutes,
                early_out_minutes=rec.early_out_minutes,
                missing_out=missing,
            )
        )
    avg_late = int(late_total / late_count) if late_count else 0
    return AnomaliesOut(
        late_count=late_count,
        early_count=early_count,
        missing_count=missing_count,
        avg_late_minutes=avg_late,
        items=items,
    )


# ── Nightly sweep (called from the reminders loop) ───────────────────────────


async def sweep_attendance(db: AsyncSession) -> int:
    """Mark absentees for yesterday + auto-close missing check-outs.

    Runs for every active hotel; idempotent (unique day constraint + guards).
    Returns number of records touched.
    """
    touched = 0
    hotels = (
        await db.execute(select(Hotel).where(Hotel.status == "active"))
    ).scalars().all()
    for hotel in hotels:
        tz = hotel_tz(hotel)
        today = datetime.now(tz).date()
        yesterday = today - timedelta(days=1)

        profiles = (
            await db.execute(
                select(StaffProfile).where(
                    StaffProfile.hotel_id == hotel.id,
                    StaffProfile.status == "active",
                )
            )
        ).scalars().all()
        if not profiles:
            continue
        recs = (
            await db.execute(
                select(AttendanceRecord).where(
                    AttendanceRecord.hotel_id == hotel.id,
                    AttendanceRecord.work_date == yesterday,
                )
            )
        ).scalars()
        by_staff = {r.staff_profile_id: r for r in recs}

        for profile in profiles:
            rec = by_staff.get(profile.id)
            weekly_off = (
                profile.weekly_off is not None
                and yesterday.weekday() == _weekly_off_to_weekday(profile.weekly_off)
            )
            if rec is None:
                if weekly_off or profile.joining_date > yesterday:
                    continue
                db.add(
                    AttendanceRecord(
                        hotel_id=hotel.id,
                        staff_profile_id=profile.id,
                        work_date=yesterday,
                        status="absent",
                        note="auto: no check-in recorded",
                    )
                )
                touched += 1
            elif rec.check_in_at is not None and rec.check_out_at is None:
                # Auto-close at shift end (or 23:59 local) — flagged via note.
                end_time = profile.shift_end or time(23, 59)
                end_local = datetime.combine(yesterday, end_time, tzinfo=tz)
                rec.check_out_at = end_local
                rec.method_out = "manual"
                suffix = "auto-closed (missing check-out)"
                rec.note = f"{rec.note} | {suffix}" if rec.note else suffix
                touched += 1
    if touched:
        await db.commit()
    return touched


# ── Leave management (phase 2) ───────────────────────────────────────────────


async def apply_leave(
    db: AsyncSession,
    tenant: TenantContext,
    body: LeaveCreate,
    *,
    correlation_id: str | None = None,
) -> StaffLeave:

    hotel_id = tenant.require_hotel()
    profile = await get_or_create_own_profile(db, tenant)

    # No overlapping pending/approved request for the same staff member.
    overlap = (
        await db.execute(
            select(StaffLeave.id).where(
                StaffLeave.staff_profile_id == profile.id,
                StaffLeave.status.in_(("pending", "approved")),
                StaffLeave.from_date <= body.to_date,
                StaffLeave.to_date >= body.from_date,
            )
        )
    ).scalar_one_or_none()
    if overlap is not None:
        raise ConflictError(
            "A leave request already covers part of this range", code="leave_overlap"
        )

    leave = StaffLeave(
        hotel_id=hotel_id,
        staff_profile_id=profile.id,
        from_date=body.from_date,
        to_date=body.to_date,
        leave_type=body.leave_type,
        reason=body.reason,
        status="pending",
    )
    db.add(leave)
    await db.flush()
    await write_audit(
        db,
        action="staff.leave_applied",
        entity_type="staff_leave",
        entity_id=leave.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={
            "from": str(body.from_date),
            "to": str(body.to_date),
            "type": body.leave_type,
        },
        correlation_id=correlation_id,
    )
    return leave


async def list_leaves(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    mine: bool,
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[LeaveOut], int]:

    hotel_id = tenant.require_hotel()
    base = (
        select(StaffLeave, StaffProfile, User)
        .join(StaffProfile, StaffProfile.id == StaffLeave.staff_profile_id)
        .join(User, User.id == StaffProfile.user_id)
        .where(StaffLeave.hotel_id == hotel_id)
    )
    if mine:
        base = base.where(StaffProfile.user_id == tenant.user_id)
    if status_filter:
        base = base.where(StaffLeave.status == status_filter)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(
            base.order_by(StaffLeave.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    items = []
    for leave, profile, user in rows:
        out = LeaveOut.model_validate(leave)
        out.staff_code = profile.staff_code
        out.full_name = user.full_name
        out.department = profile.department
        items.append(out)
    return items, int(total)


async def decide_leave(
    db: AsyncSession,
    tenant: TenantContext,
    leave_id: UUID,
    body: LeaveDecisionIn,
    *,
    correlation_id: str | None = None,
) -> StaffLeave:

    hotel_id = tenant.require_hotel()
    leave = (
        await db.execute(
            select(StaffLeave).where(
                StaffLeave.id == leave_id, StaffLeave.hotel_id == hotel_id
            )
        )
    ).scalar_one_or_none()
    if leave is None:
        raise NotFoundError("Leave request not found")
    if leave.status != "pending":
        raise ConflictError("Leave request already decided", code="leave_decided")

    leave.status = "approved" if body.action == "approve" else "rejected"
    leave.decided_by_id = tenant.user_id
    leave.decided_at = datetime.now(UTC)
    leave.decision_note = body.note

    # Approval materializes into attendance so calendars/reports agree:
    # every day in the range WITHOUT an existing check-in becomes 'leave'.
    if leave.status == "approved":
        existing = (
            await db.execute(
                select(AttendanceRecord).where(
                    AttendanceRecord.staff_profile_id == leave.staff_profile_id,
                    AttendanceRecord.work_date >= leave.from_date,
                    AttendanceRecord.work_date <= leave.to_date,
                )
            )
        ).scalars()
        by_day = {r.work_date: r for r in existing}
        d = leave.from_date
        while d <= leave.to_date:
            rec = by_day.get(d)
            if rec is None:
                db.add(
                    AttendanceRecord(
                        hotel_id=hotel_id,
                        staff_profile_id=leave.staff_profile_id,
                        work_date=d,
                        status="leave",
                        note=f"leave: {leave.leave_type}",
                    )
                )
            elif rec.check_in_at is None:
                rec.status = "leave"
                rec.note = f"leave: {leave.leave_type}"
            d += timedelta(days=1)

    await db.flush()
    await write_audit(
        db,
        action="staff.leave_decided",
        entity_type="staff_leave",
        entity_id=leave.id,
        actor_id=tenant.user_id,
        hotel_id=hotel_id,
        after={"status": leave.status, "note": body.note or ""},
        correlation_id=correlation_id,
    )
    return leave


# ── Selfie upload (Face Check-In evidence) ───────────────────────────────────


async def upload_selfie(
    db: AsyncSession,
    tenant: TenantContext,
    *,
    filename: str,
    content_type: str,
    data: bytes,
) -> str:
    from app.integrations.storage.base import get_storage, new_object_key

    if content_type not in ALLOWED_SELFIE_TYPES:
        raise ValidationAppError("Selfie must be PNG, JPEG or WebP", code="invalid_photo_type")
    if len(data) > MAX_SELFIE_BYTES:
        raise ValidationAppError("Selfie must be 5 MB or smaller", code="photo_too_large")
    hotel_id = tenant.require_hotel()
    key = new_object_key(f"hotels/{hotel_id}/staff/selfies/{tenant.user_id}", filename)
    await get_storage().put_bytes(key=key, data=data, content_type=content_type)
    return key
