from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db
from app.schemas.ops import (
    ExpenseReportOut,
    GstByBookingOut,
    GstReportOut,
    OccupancyReportOut,
    PaymentMethodReportOut,
    RestaurantBillingOut,
    RevenueReportOut,
    RoomUtilizationOut,
)
from app.services import reports as reports_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/occupancy", response_model=OccupancyReportOut)
async def occupancy(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> OccupancyReportOut:
    return await reports_service.occupancy(db, tenant, from_date, to_date)


@router.get("/revenue", response_model=RevenueReportOut)
async def revenue(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> RevenueReportOut:
    return await reports_service.revenue(db, tenant, from_date, to_date)


@router.get("/expenses", response_model=ExpenseReportOut)
async def expenses(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> ExpenseReportOut:
    return await reports_service.expenses(db, tenant, from_date, to_date)


@router.get("/payments", response_model=PaymentMethodReportOut)
async def payments(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> PaymentMethodReportOut:
    return await reports_service.payments_by_method(db, tenant, from_date, to_date)


@router.get("/gst", response_model=GstReportOut)
async def gst(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> GstReportOut:
    return await reports_service.gst_summary(db, tenant, from_date, to_date)


@router.get("/gst/by-booking", response_model=GstByBookingOut)
async def gst_by_booking(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> GstByBookingOut:
    return await reports_service.gst_by_booking(db, tenant, from_date, to_date)


@router.get("/restaurant-billing", response_model=RestaurantBillingOut)
async def restaurant_billing(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.FINANCIAL_REPORTS)),
    db: AsyncSession = Depends(get_db),
) -> RestaurantBillingOut:
    """Restaurant/food charges with GST breakdown — client's Restaurant Billing page."""
    return await reports_service.restaurant_billing(db, tenant, from_date, to_date)


@router.get("/room-utilization", response_model=RoomUtilizationOut)
async def room_utilization(
    from_date: date = Query(...),
    to_date: date = Query(...),
    tenant: TenantContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> RoomUtilizationOut:
    return await reports_service.room_utilization(db, tenant, from_date, to_date)
