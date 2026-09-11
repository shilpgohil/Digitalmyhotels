"""Staff attendance API (client 09/2026 staff check-in flow)."""

from __future__ import annotations

import csv
import io
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.staff import (
    AnomaliesOut,
    AttendanceCorrectionIn,
    AttendanceRecordOut,
    CalendarOut,
    CheckInIn,
    FrontDeskRecordIn,
    HistoryOut,
    LeaveCreate,
    LeaveDecisionIn,
    LeaveListOut,
    LeaveOut,
    SelfTodayOut,
    StaffCreate,
    StaffListOut,
    StaffOut,
    StaffUpdate,
    TodayAttendanceOut,
)
from app.services import attendance as attendance_service
from app.services import staff as staff_service

router = APIRouter(prefix="/staff", tags=["staff"])


def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


# ── Self service (ALL roles incl. manager/admin — own profile check-in) ──────
# Declared before /{staff_id} so "me"/"attendance" never match the UUID route.


@router.get("/me/attendance/today", response_model=SelfTodayOut)
async def my_attendance_today(
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> SelfTodayOut:
    return await attendance_service.self_today(db, tenant)


@router.get("/me/attendance/calendar", response_model=CalendarOut)
async def my_attendance_calendar(
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> CalendarOut:
    profile = await attendance_service.get_or_create_own_profile(db, tenant)
    return await attendance_service.calendar(db, tenant, staff_id=profile.id, month=month)


@router.post("/attendance/selfie")
async def upload_checkin_selfie(
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    data = await file.read()
    key = await attendance_service.upload_selfie(
        db,
        tenant,
        filename=file.filename or "selfie.jpg",
        content_type=file.content_type or "image/jpeg",
        data=data,
    )
    return {"selfie_key": key}


@router.post("/attendance/check-in", response_model=AttendanceRecordOut)
async def self_check_in(
    body: CheckInIn,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecordOut:
    record = await attendance_service.self_check_in(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return AttendanceRecordOut.model_validate(record)


@router.post("/attendance/check-out", response_model=AttendanceRecordOut)
async def self_check_out(
    body: CheckInIn,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecordOut:
    record = await attendance_service.self_check_out(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return AttendanceRecordOut.model_validate(record)


# ── Attendance views ─────────────────────────────────────────────────────────


@router.get("/attendance/today", response_model=TodayAttendanceOut)
async def attendance_today(
    on_date: date | None = Query(default=None),
    department: str | None = Query(default=None),
    status: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> TodayAttendanceOut:
    return await attendance_service.today_attendance(
        db, tenant, on_date=on_date, department=department, status_filter=status
    )


@router.get("/attendance/history", response_model=HistoryOut)
async def attendance_history(
    from_date: date = Query(),
    to_date: date = Query(),
    department: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> HistoryOut:
    items, total = await attendance_service.history(
        db,
        tenant,
        from_date=from_date,
        to_date=to_date,
        department=department,
        status_filter=status,
        q=q,
        limit=limit,
        offset=offset,
    )
    return HistoryOut(items=items, total=total)


@router.get("/attendance/history.csv")
async def attendance_history_csv(
    from_date: date = Query(),
    to_date: date = Query(),
    department: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    items, _ = await attendance_service.history(
        db,
        tenant,
        from_date=from_date,
        to_date=to_date,
        department=department,
        limit=5000,
        offset=0,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["Date", "Staff ID", "Name", "Department", "Check-in", "Check-out",
         "Working minutes", "Late minutes", "Status"]
    )
    for row in items:
        writer.writerow(
            [
                row.work_date.isoformat(),
                row.staff_code,
                row.full_name,
                row.department,
                row.check_in_at.isoformat() if row.check_in_at else "",
                row.check_out_at.isoformat() if row.check_out_at else "",
                row.working_minutes or "",
                row.late_minutes or "",
                row.status,
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="attendance.csv"'},
    )


@router.get("/attendance/calendar", response_model=CalendarOut)
async def attendance_calendar(
    staff_id: UUID = Query(),
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> CalendarOut:
    return await attendance_service.calendar(db, tenant, staff_id=staff_id, month=month)


@router.get("/attendance/anomalies", response_model=AnomaliesOut)
async def attendance_anomalies(
    from_date: date = Query(),
    to_date: date = Query(),
    department: str | None = Query(default=None),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> AnomaliesOut:
    return await attendance_service.anomalies(
        db, tenant, from_date=from_date, to_date=to_date, department=department
    )


@router.post("/attendance/{staff_id}/record", response_model=AttendanceRecordOut)
async def front_desk_record(
    staff_id: UUID,
    body: FrontDeskRecordIn,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_RECORD)),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecordOut:
    record = await attendance_service.front_desk_record(
        db, tenant, staff_id, body.action, correlation_id=_correlation(request)
    )
    return AttendanceRecordOut.model_validate(record)


@router.patch("/attendance/records/{record_id}", response_model=AttendanceRecordOut)
async def correct_attendance(
    record_id: UUID,
    body: AttendanceCorrectionIn,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_CORRECT)),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecordOut:
    record = await attendance_service.correct_record(
        db, tenant, record_id, body, correlation_id=_correlation(request)
    )
    return AttendanceRecordOut.model_validate(record)


# ── Leave management (phase 2) ───────────────────────────────────────────────


@router.post("/leaves", response_model=LeaveOut, status_code=201)
async def apply_leave(
    body: LeaveCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> LeaveOut:
    leave = await attendance_service.apply_leave(
        db, tenant, body, correlation_id=_correlation(request)
    )
    return LeaveOut.model_validate(leave)


@router.get("/leaves", response_model=LeaveListOut)
async def list_leaves(
    mine: bool = Query(default=False),
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_SELF)),
    db: AsyncSession = Depends(get_db),
) -> LeaveListOut:
    # Listing OTHER people's leaves needs the attendance-view permission;
    # everyone may list their own (mine=true).
    if not mine:
        tenant.require_permission(Permission.STAFF_ATTENDANCE_VIEW)
    items, total = await attendance_service.list_leaves(
        db, tenant, mine=mine, status_filter=status, limit=limit, offset=offset
    )
    return LeaveListOut(items=items, total=total)


@router.post("/leaves/{leave_id}/decide", response_model=LeaveOut)
async def decide_leave(
    leave_id: UUID,
    body: LeaveDecisionIn,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_CORRECT)),
    db: AsyncSession = Depends(get_db),
) -> LeaveOut:
    leave = await attendance_service.decide_leave(
        db, tenant, leave_id, body, correlation_id=_correlation(request)
    )
    return LeaveOut.model_validate(leave)


# ── Staff directory ──────────────────────────────────────────────────────────


@router.post("", response_model=StaffOut, status_code=201)
async def create_staff(
    body: StaffCreate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> StaffOut:
    return await staff_service.create_staff(
        db, tenant, body, correlation_id=_correlation(request)
    )


@router.get("", response_model=StaffListOut)
async def list_staff(
    q: str | None = Query(default=None),
    department: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> StaffListOut:
    items, total = await staff_service.list_staff(
        db,
        tenant,
        q=q,
        department=department,
        role=role,
        status=status,
        limit=limit,
        offset=offset,
    )
    return StaffListOut(items=items, total=total)


@router.get("/{staff_id}", response_model=StaffOut)
async def get_staff(
    staff_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> StaffOut:
    return await staff_service.get_staff(db, tenant, staff_id)


@router.patch("/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: UUID,
    body: StaffUpdate,
    request: Request,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> StaffOut:
    return await staff_service.update_staff(
        db, tenant, staff_id, body, correlation_id=_correlation(request)
    )


@router.post("/{staff_id}/photo", status_code=204)
async def upload_staff_photo(
    staff_id: UUID,
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_MANAGE)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    data = await file.read()
    await staff_service.upload_photo(
        db,
        tenant,
        staff_id,
        filename=file.filename or "photo.jpg",
        content_type=file.content_type or "image/jpeg",
        data=data,
    )
    return Response(status_code=204)


@router.get("/{staff_id}/photo")
async def get_staff_photo(
    staff_id: UUID,
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    data, media = await staff_service.get_photo_bytes(db, tenant, staff_id)
    return Response(content=data, media_type=media)


@router.get("/attendance/{staff_id}/recent", response_model=HistoryOut)
async def staff_recent_attendance(
    staff_id: UUID,
    days: int = Query(default=7, ge=1, le=60),
    tenant: TenantContext = Depends(require_permissions(Permission.STAFF_ATTENDANCE_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> HistoryOut:
    from datetime import timedelta

    profile = await staff_service.get_profile(db, tenant, staff_id)
    hotel = await attendance_service._hotel(db, tenant)  # noqa: SLF001
    today = staff_service.hotel_today(hotel)
    items, total = await attendance_service.history(
        db,
        tenant,
        from_date=today - timedelta(days=days),
        to_date=today,
        q=profile.staff_code,
        limit=days + 1,
        offset=0,
    )
    return HistoryOut(items=items, total=total)
