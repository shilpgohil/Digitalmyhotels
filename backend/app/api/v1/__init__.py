from fastapi import APIRouter

from app.api.v1 import (
    audit,
    auth,
    bookings,
    charges,
    checkins,
    checkouts,
    expenses,
    guests,
    hotels,
    housekeeping,
    invoices,
    notifications,
    ops,
    payments,
    reports,
    rooms,
    subscriptions,
    super_admin,
    team,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(hotels.router)
api_router.include_router(team.router)
api_router.include_router(rooms.router)
api_router.include_router(guests.router)
api_router.include_router(bookings.router)
api_router.include_router(checkins.router)
api_router.include_router(checkouts.router)
api_router.include_router(charges.router)
api_router.include_router(payments.router)
api_router.include_router(invoices.router)
api_router.include_router(expenses.router)
api_router.include_router(housekeeping.router)
api_router.include_router(ops.router)
api_router.include_router(reports.router)
api_router.include_router(notifications.router)
api_router.include_router(audit.router)
api_router.include_router(subscriptions.router)
api_router.include_router(super_admin.router)
