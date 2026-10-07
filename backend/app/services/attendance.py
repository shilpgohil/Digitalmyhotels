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

from sqlalchemy import func, or_, select
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
    RecordDetailOut,
    SelfTodayOut,
    TodayAttendanceOut,
    TodayStatsOut,
)
from app.services.audit import write_audit
from app.services.staff import get_profile, hotel_today, hotel_tz

LATE_GRACE_MINUTES = 10
# Missing check-outs auto-close this long after shift end (or at 23:59).
AUTO_CLOSE_AFTER_HOURS = 4
# GPS accuracy grace is capped so a vague IP-based fix can't bypass the fence,
# but gives realistic tolerance for indoor smartphone GPS signal attenuation.
MAX_ACCURACY_GRACE_M = 150.0

ALLOWED_SELFIE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_SELFIE_BYTES = 5 * 1024 * 1024


# ── Geofence ─────────────────────────────────────────────────────────────────


def enforce_geofence(
    hotel: Hotel,
    lat: float | None,
    lng: float | None,
    accuracy_m: float | None,
    *,
    action: str = "check in",
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
    if abs(float(hotel.latitude)) < 0.0001 and abs(float(hotel.longitude)) < 0.0001:
        # 0.0, 0.0 is Null Island (unconfigured coordinates) — fail open safely.
        return None
    if lat is None or lng is None:
        raise ValidationAppError(
            f"Location is required to {action} at this hotel", code="location_required"
        )
    distance = haversine_m(float(lat), float(lng), float(hotel.latitude), float(hotel.longitude))
    grace = min(float(accuracy_m or 0.0), MAX_ACCURACY_GRACE_M)
    if distance > float(hotel.geofence_radius_m) + grace:
        raise ValidationAppError(
            f"You are ~{int(distance)} m from the property — move within "
            f"{hotel.geofence_radius_m} m to {action}",
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


def _is_overnight(profile: StaffProfile) -> bool:
    """Shift crosses midnight (e.g. 22:00 → 07:00)."""
    return (
        profile.shift_start is not None
        and profile.shift_end is not None
        and profile.shift_end <= profile.shift_start
    )


def _late_minutes(
    profile: StaffProfile, checkin_local: datetime, grace_minutes: int
) -> int | None:
    if profile.shift_start is None:
        return None
    shift_dt = checkin_local.replace(
        hour=profile.shift_start.hour,
        minute=profile.shift_start.minute,
        second=0,
        microsecond=0,
    )
    delta = (checkin_local - shift_dt).total_seconds() / 60
    return int(delta) if delta > grace_minutes else None


def _early_out_minutes(profile: StaffProfile, checkout_local: datetime) -> int | None:
    if profile.shift_end is None:
        return None
    shift_dt = checkout_local.replace(
        hour=profile.shift_end.hour,
        minute=profile.shift_end.minute,
        second=0,
        microsecond=0,
    )
    # Overnight shift: the end belongs to the NEXT day relative to check-in;
    # when the checkout happens after midnight the same-day end is correct,
    # so only push the end forward while we're still before the shift start.
    if (
        _is_overnight(profile)
        and profile.shift_start is not None
        and checkout_local.time() >= profile.shift_start
    ):
        shift_dt += timedelta(days=1)
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
    grace_minutes: int = LATE_GRACE_MINUTES,
    lat: float | None = None,
    lng: float | None = None,
    accuracy_m: float | None = None,
    distance_m: float | None = None,
    selfie_key: str | None = None,
    performed_by: UUID | None = None,
) -> None:
    if record.first_check_in_at is None:
        record.first_check_in_at = now_utc
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
    late = _late_minutes(profile, now_local, grace_minutes)
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
    selfie_key: str | None = None,
    performed_by: UUID | None = None,
) -> None:
    if record.check_in_at is not None:
        session_mins = max(0, int((now_utc - record.check_in_at).total_seconds() // 60))
        record.accumulated_minutes = (record.accumulated_minutes or 0) + session_mins
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
    if selfie_key:
        record.check_out_selfie_key = selfie_key
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
        # Already checked in but ALSO already checked out → allow re-check-in.
        # Hotel staff can leave and return in the same day (lunch break etc.).
        # We reset the checkout fields and tag the record as a re-entry —
        # the earlier checkout time is preserved in the note for audit purposes.
        if record.check_out_at is not None:
            if not record.accumulated_minutes and record.check_in_at is not None:
                record.accumulated_minutes = max(
                    0, int((record.check_out_at - record.check_in_at).total_seconds() // 60)
                )
            prev_out = record.check_out_at.strftime("%H:%M")
            record.check_out_at = None
            record.check_out_lat = None
            record.check_out_lng = None
            record.check_out_accuracy_m = None
            record.check_out_distance_m = None
            record.method_out = None
            record.early_out_minutes = None
            record.note = (
                f"{record.note} | re-check-in (prev out: {prev_out})"
                if record.note
                else f"re-check-in (prev out: {prev_out})"
            )
        else:
            # Still checked in (not yet checked out) — genuinely blocked.
            raise ConflictError(
                "You are already checked in. Please check out first.",
                code="already_checked_in",
            )
    if record is None:
        record = AttendanceRecord(
            hotel_id=hotel.id, staff_profile_id=profile.id, work_date=work_date
        )
        db.add(record)

    # SECURITY: Live face capture is MANDATORY for attendance check-in.
    # The selfie key is client-supplied — accept ONLY keys produced by upload_selfie
    # for THIS hotel and THIS user.
    selfie_key = body.selfie_key
    if not selfie_key:
        raise ValidationAppError(
            "Live face capture is required for check-in", code="selfie_required"
        )
    expected_prefix = f"hotels/{hotel.id}/staff/selfies/{profile.user_id}/"
    if not selfie_key.startswith(expected_prefix):
        raise ValidationAppError(
            "Invalid selfie reference", code="invalid_selfie_key"
        )

    _apply_check_in(
        record,
        profile,
        now_utc=now_utc,
        now_local=now_local,
        method="self_geo",
        grace_minutes=hotel.attendance_grace_minutes,
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        distance_m=distance,
        selfie_key=selfie_key,
    )
    await db.flush()

    # Notify managers if the check-in is late.
    if record.late_minutes:
        from app.models.user import User as _User
        from app.services.notification_events import NE
        from app.services.notification_events import fire as _fire
        actor = await db.get(_User, profile.user_id)
        await _fire(
            db,
            hotel_id=hotel.id,
            event=NE.STAFF_LATE,
            data={
                "staff_name": actor.full_name if actor else profile.staff_code,
                "staff_code": profile.staff_code,
                "late_minutes": record.late_minutes,
                "checkin_time": now_local.strftime("%H:%M"),
            },
        )

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

    # Geofence enforcement on check-out: staff cannot check out from other locations
    # or without GPS when geofencing is enabled on the property.
    distance = enforce_geofence(
        hotel, body.lat, body.lng, body.accuracy_m, action="check out"
    )

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

    # SECURITY: Live face capture is MANDATORY for attendance check-out.
    selfie_key = body.selfie_key
    if not selfie_key:
        raise ValidationAppError(
            "Live face capture is required for check-out", code="selfie_required"
        )
    expected_prefix = f"hotels/{hotel.id}/staff/selfies/{profile.user_id}/"
    if not selfie_key.startswith(expected_prefix):
        raise ValidationAppError(
            "Invalid selfie reference", code="invalid_selfie_key"
        )

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
        selfie_key=selfie_key,
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
            status = "late" if record.status == "late" else "working"
        else:
            status = "checked_out"
        working_minutes = _working_minutes(record)
    return SelfTodayOut(
        staff_profile_id=profile.id if profile else None,
        staff_code=profile.staff_code if profile else None,
        full_name=user.full_name if user else "",
        department=profile.department if profile else None,
        geofence_enabled=bool(hotel.geofence_enabled),
        geofence_radius_m=hotel.geofence_radius_m if hotel.geofence_enabled else None,
        hotel_latitude=hotel.latitude if hotel.geofence_enabled else None,
        hotel_longitude=hotel.longitude if hotel.geofence_enabled else None,
        work_date=record.work_date if record else today,
        check_in_at=record.check_in_at if record else None,
        first_check_in_at=(record.first_check_in_at or record.check_in_at) if record else None,
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
            if record.check_out_at is not None:
                if not record.accumulated_minutes and record.check_in_at is not None:
                    record.accumulated_minutes = max(
                        0, int((record.check_out_at - record.check_in_at).total_seconds() // 60)
                    )
                # Re-check-in after checkout — same logic as self_check_in.
                prev_out = record.check_out_at.strftime("%H:%M")
                record.check_out_at = None
                record.check_out_lat = None
                record.check_out_lng = None
                record.check_out_accuracy_m = None
                record.check_out_distance_m = None
                record.method_out = None
                record.early_out_minutes = None
                record.note = (
                    f"{record.note} | re-check-in via front desk (prev out: {prev_out})"
                    if record.note
                    else f"re-check-in via front desk (prev out: {prev_out})"
                )
            else:
                raise ConflictError(
                    "Staff member is already checked in. Check out first.",
                    code="already_checked_in",
                )
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
            grace_minutes=hotel.attendance_grace_minutes,
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
        if record.first_check_in_at is None:
            record.first_check_in_at = body.check_in_at
        record.method_in = "manual"
    if body.check_out_at is not None:
        record.check_out_at = body.check_out_at
        record.method_out = "manual"
    if record.check_in_at is not None and record.check_out_at is not None:
        record.accumulated_minutes = max(
            0, int((record.check_out_at - record.check_in_at).total_seconds() // 60)
        )
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
    accumulated = rec.accumulated_minutes or 0
    if rec.check_out_at is not None:
        if accumulated == 0 and rec.check_out_at > rec.check_in_at:
            return max(0, int((rec.check_out_at - rec.check_in_at).total_seconds() // 60))
        return accumulated
    now_tz = datetime.now(tz=rec.check_in_at.tzinfo)
    current_session = max(0, int((now_tz - rec.check_in_at).total_seconds() // 60))
    return accumulated + current_session


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

    now_local = datetime.now(hotel_tz(hotel))

    def counts_absent(profile: StaffProfile, rec: AttendanceRecord | None) -> bool:
        """A no-show only counts as ABSENT once their shift window has passed.

        Counting everyone before their shift made the 9 AM dashboard show the
        whole hotel as absent (illogical). Rules:
        - swept/explicit absent record → absent
        - viewing a PAST day with no check-in → absent
        - TODAY with a shift: absent once now > shift start + grace
        - TODAY without a shift configured: never absent mid-day
        """
        if rec is not None and rec.status in ("leave", "off", "holiday"):
            return False
        if rec is not None and rec.status == "absent":
            return True
        if rec is not None and rec.check_in_at is not None:
            return False
        if day < now_local.date():
            return True
        if day > now_local.date():
            return False
        if profile.shift_start is None:
            return False
        shift_dt = now_local.replace(
            hour=profile.shift_start.hour,
            minute=profile.shift_start.minute,
            second=0,
            microsecond=0,
        )
        return now_local > shift_dt + timedelta(minutes=hotel.attendance_grace_minutes)

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
        if counts_absent(profile, rec):
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
                first_check_in_at=rec.first_check_in_at or rec.check_in_at if rec else None,
                check_out_at=rec.check_out_at if rec else None,
                working_minutes=_working_minutes(rec),
                late_minutes=rec.late_minutes if rec else None,
                early_out_minutes=rec.early_out_minutes if rec else None,
                status=row_status,
                method_in=rec.method_in if rec else None,
                method_out=rec.method_out if rec else None,
                has_selfie=bool(rec and rec.check_in_selfie_key),
                selfie_flushed=bool(rec and rec.selfie_flushed_at),
                check_in_selfie_sha256=rec.check_in_selfie_sha256 if rec else None,
                has_checkout_selfie=bool(rec and rec.check_out_selfie_key),
                check_out_selfie_sha256=rec.check_out_selfie_sha256 if rec else None,
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
            first_check_in_at=rec.first_check_in_at or rec.check_in_at,
            check_out_at=rec.check_out_at,
            working_minutes=_working_minutes(rec),
            late_minutes=rec.late_minutes,
            early_out_minutes=rec.early_out_minutes,
            status=_row_status(profile.status, rec),
            method_in=rec.method_in,
            method_out=rec.method_out,
            has_selfie=bool(rec.check_in_selfie_key),
            selfie_flushed=bool(rec.selfie_flushed_at),
            check_in_selfie_sha256=rec.check_in_selfie_sha256,
            has_checkout_selfie=bool(rec.check_out_selfie_key),
            check_out_selfie_sha256=rec.check_out_selfie_sha256,
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
                record_id=rec.id if rec else None,
                check_in_at=rec.check_in_at if rec else None,
                check_out_at=rec.check_out_at if rec else None,
                late_minutes=rec.late_minutes if rec else None,
                selfie_flushed=bool(rec and rec.selfie_flushed_at),
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
        # Missing = still open on a past day OR closed by the auto sweep —
        # the auto method keeps the insight after the record is closed.
        missing = (
            bool(rec.check_in_at) and rec.check_out_at is None and rec.work_date < to_date
        ) or rec.method_out == "auto"
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
                # Notify managers once per absent event.
                from app.models.user import User as _User
                from app.services.notification_events import NE
                from app.services.notification_events import fire as _fire
                actor = await db.get(_User, profile.user_id)
                await _fire(
                    db,
                    hotel_id=hotel.id,
                    event=NE.STAFF_ABSENT,
                    data={
                        "staff_name": actor.full_name if actor else profile.staff_code,
                        "staff_code": profile.staff_code,
                    },
                )
            elif rec.check_in_at is not None and rec.check_out_at is None:
                # Auto-close at shift end (or 23:59 local). method_out="auto"
                # keeps these visible in the Missing Check-outs report even
                # after closing (a "manual" method erased that insight).
                end_time = profile.shift_end or time(23, 59)
                end_day = yesterday
                if _is_overnight(profile):
                    end_day = yesterday + timedelta(days=1)
                end_local = datetime.combine(end_day, end_time, tzinfo=tz)
                # Give stragglers time: only close once well past shift end.
                if datetime.now(tz) < end_local + timedelta(hours=AUTO_CLOSE_AFTER_HOURS):
                    continue
                rec.check_out_at = end_local
                rec.method_out = "auto"
                rec.early_out_minutes = None
                suffix = "auto-closed (missing check-out)"
                rec.note = f"{rec.note} | {suffix}" if rec.note else suffix
                touched += 1
                # Notify managers about the missing checkout.
                from app.models.user import User as _User
                from app.services.notification_events import NE
                from app.services.notification_events import fire as _fire
                actor = await db.get(_User, profile.user_id)
                await _fire(
                    db,
                    hotel_id=hotel.id,
                    event=NE.STAFF_MISSING_CHECKOUT,
                    data={
                        "staff_name": actor.full_name if actor else profile.staff_code,
                        "staff_code": profile.staff_code,
                    },
                )
    if touched:
        await db.commit()
    return touched


# ── Record detail (evidence view for managers) ───────────────────────────────


async def record_detail(
    db: AsyncSession, tenant: TenantContext, record_id: UUID
) -> RecordDetailOut:
    hotel_id = tenant.require_hotel()
    row = (
        await db.execute(
            select(AttendanceRecord, StaffProfile, User)
            .join(StaffProfile, StaffProfile.id == AttendanceRecord.staff_profile_id)
            .join(User, User.id == StaffProfile.user_id)
            .where(
                AttendanceRecord.id == record_id,
                AttendanceRecord.hotel_id == hotel_id,
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Attendance record not found")
    rec, profile, user = row
    performed_by_name: str | None = None
    if rec.performed_by_id is not None:
        actor = await db.get(User, rec.performed_by_id)
        performed_by_name = actor.full_name if actor else None
    return RecordDetailOut(
        id=rec.id,
        staff_profile_id=profile.id,
        staff_code=profile.staff_code,
        full_name=user.full_name,
        department=profile.department,
        work_date=rec.work_date,
        status=_row_status(profile.status, rec),
        check_in_at=rec.check_in_at,
        first_check_in_at=rec.first_check_in_at or rec.check_in_at,
        check_out_at=rec.check_out_at,
        method_in=rec.method_in,
        method_out=rec.method_out,
        check_in_distance_m=rec.check_in_distance_m,
        check_in_accuracy_m=rec.check_in_accuracy_m,
        check_out_distance_m=rec.check_out_distance_m,
        check_out_accuracy_m=rec.check_out_accuracy_m,
        late_minutes=rec.late_minutes,
        early_out_minutes=rec.early_out_minutes,
        working_minutes=_working_minutes(rec),
        has_selfie=rec.check_in_selfie_key is not None,
        selfie_flushed=rec.selfie_flushed_at is not None,
        check_in_selfie_sha256=rec.check_in_selfie_sha256,
        has_checkout_selfie=rec.check_out_selfie_key is not None,
        check_out_selfie_sha256=rec.check_out_selfie_sha256,
        performed_by_name=performed_by_name,
        note=rec.note,
    )


async def record_selfie_bytes(
    db: AsyncSession,
    tenant: TenantContext,
    record_id: UUID,
    which: str = "in",
) -> tuple[bytes, str]:
    from app.integrations.storage.base import get_storage

    hotel_id = tenant.require_hotel()
    rec = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.id == record_id,
                AttendanceRecord.hotel_id == hotel_id,
            )
        )
    ).scalar_one_or_none()
    key = (
        rec.check_out_selfie_key
        if (rec and which == "out")
        else (rec.check_in_selfie_key if rec else None)
    )
    if rec is None or not key:
        raise NotFoundError("No selfie recorded")
    data = await get_storage().get_bytes(key)
    suffix = key.rsplit(".", 1)[-1].lower()
    media = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    return data, media


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

    # Notify owner/manager that a leave request arrived.
    from app.models.user import User as _User
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    requester = await db.get(_User, profile.user_id)
    await _fire(
        db,
        hotel_id=hotel_id,
        event=NE.STAFF_LEAVE_REQUESTED,
        data={
            "staff_name": requester.full_name if requester else profile.staff_code,
            "leave_type": body.leave_type.replace("_", " ").title(),
            "from_date": body.from_date.strftime("%d %b"),
            "to_date": body.to_date.strftime("%d %b %Y"),
        },
    )

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

    # Notify the staff member about the decision.
    from app.models.user import User as _User
    from app.services.notification_events import NE
    from app.services.notification_events import fire as _fire
    profile = await db.get(StaffProfile, leave.staff_profile_id)
    if profile is not None:
        decider = await db.get(_User, tenant.user_id)
        await _fire(
            db,
            hotel_id=hotel_id,
            event=NE.STAFF_LEAVE_DECIDED,
            data={
                "decision": leave.status,
                "leave_type": leave.leave_type.replace("_", " ").title(),
                "from_date": leave.from_date.strftime("%d %b"),
                "to_date": leave.to_date.strftime("%d %b %Y"),
                "decided_by": decider.full_name if decider else "manager",
            },
        )

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


# ── Nightly selfie-flush sweep ─────────────────────────────────────────────────


async def sweep_flushed_selfies(db: AsyncSession) -> dict[str, int]:
    """Purge raw selfie bytes past each hotel's retention window.

    Retention window is ``hotel_settings.attendance_selfie_retention_days``
    (default 30, max 90).  After purging the binary bytes the record's
    ``check_in_selfie_key`` is cleared and ``selfie_flushed_at`` is stamped;
    the SHA-256 fingerprint (``check_in_selfie_sha256``) is kept forever for
    audit-trail purposes.

    Returns a summary dict ``{"scanned": N, "flushed": M, "errors": K}``.
    """
    import hashlib

    from app.integrations.storage.base import get_storage
    from app.models.hotel import HotelSettings

    now_utc = datetime.now(UTC)
    scanned = flushed = errors = 0

    # Fetch per-hotel retention windows in one query.
    settings_rows = (await db.execute(select(HotelSettings))).scalars().all()
    hotel_retention: dict[UUID, int] = {
        s.hotel_id: max(1, min(s.attendance_selfie_retention_days, 90))
        for s in settings_rows
    }

    # Default to 30 days for hotels without a settings row.
    DEFAULT_DAYS = 30

    # Candidate records: have a check-in or check-out selfie key, not yet flushed.
    candidates = (
        await db.execute(
            select(AttendanceRecord).where(
                or_(
                    AttendanceRecord.check_in_selfie_key.isnot(None),
                    AttendanceRecord.check_out_selfie_key.isnot(None),
                ),
                AttendanceRecord.selfie_flushed_at.is_(None),
            )
        )
    ).scalars().all()

    storage = get_storage()

    for rec in candidates:
        scanned += 1
        retention_days = hotel_retention.get(rec.hotel_id, DEFAULT_DAYS)
        cutoff = now_utc - timedelta(days=retention_days)
        # Use work_date (hotel-local date) as a UTC proxy — close enough for
        # a daily sweep; exact-minute precision is not required here.
        record_age_date = datetime(
            rec.work_date.year, rec.work_date.month, rec.work_date.day, tzinfo=UTC
        )
        if record_age_date > cutoff:
            continue  # still within retention window

        flushed_any = False
        if rec.check_in_selfie_key:
            try:
                raw_in = await storage.get_bytes(key=rec.check_in_selfie_key)
                rec.check_in_selfie_sha256 = hashlib.sha256(raw_in).hexdigest()
                await storage.delete(key=rec.check_in_selfie_key)
                rec.check_in_selfie_key = None
                flushed_any = True
            except Exception:  # noqa: BLE001
                errors += 1

        if rec.check_out_selfie_key:
            try:
                raw_out = await storage.get_bytes(key=rec.check_out_selfie_key)
                rec.check_out_selfie_sha256 = hashlib.sha256(raw_out).hexdigest()
                await storage.delete(key=rec.check_out_selfie_key)
                rec.check_out_selfie_key = None
                flushed_any = True
            except Exception:  # noqa: BLE001
                errors += 1

        if flushed_any:
            rec.selfie_flushed_at = now_utc
            db.add(rec)
            flushed += 1

    await db.flush()
    return {"scanned": scanned, "flushed": flushed, "errors": errors}
