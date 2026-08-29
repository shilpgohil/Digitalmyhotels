# System Patterns — DigitalMyHotels

## Architecture
Modular monolith. Vercel (Next.js) → REST `/api/v1` → Render (FastAPI) → Neon Postgres + Cloudflare R2. Local dev: Docker Postgres + local storage stub.

## Backend layering (backend/app/)
- `api/v1/*` — thin routers; no business logic.
- `services/*` — business rules, transactions, audit writes.
- `repositories/*` — scoped persistence helpers (`get_x_for_hotel(id, hotel_id)` pattern).
- `models/*` — SQLAlchemy 2.0 typed models (persistence only).
- `schemas/*` — Pydantic v2 API contracts (never expose models directly).
- `core/*` — config, security, permissions, tenant, errors, logging, encryption.
- `integrations/*` — storage (local/R2), email (stub), notifications, behind small interfaces.

## Cross-cutting patterns
- Tenant context: `get_tenant_context` dependency resolves membership+role from DB; `X-Hotel-Id` header is only a hint verified against membership. `TenantContext.require_permission()` gates every protected route.
- RBAC: `core/permissions.py` — `Permission` enum + `ROLE_PERMISSIONS` map (super_admin, owner, manager, admin, housekeeping). Workers get `HOTEL_VIEW_PAYMENT_QR` but never `HOTEL_VIEW_UPI_ID`.
- Errors: `AppError` hierarchy → JSON envelope `{error: {code, message, correlation_id, details?}}`. Correlation ID middleware on every request. Never leak stack traces/SQL.
- Auth: argon2 password hashing; 15-min access JWT (Bearer); rotating refresh token (SHA-256 hash stored) in HttpOnly cookie scoped to `/api/v1/auth`; reuse detection revokes the whole family.
- Audit: `services/audit.write_audit()` — actor, hotel, action, entity, before/after, correlation ID. Never log secrets/raw UPI.
- Money: `Numeric(12,2)` + Python `Decimal`. Ledger `guest_booking_ledger` is append-oriented with `balance_after`; corrections are new rows/corrective payments (`corrects_payment_id`).
- Sensitive data: UPI ID and full guest IDs encrypted at rest (Fernet via `core/encryption.py`); only last-4 stored in clear for search.
- Room status: single state machine (available/reserved/occupied/cleaning_required/cleaning_in_progress/clean_ready/inspection_required/maintenance/out_of_service) enforced via CHECK constraint + service-level transition rules.
- DB naming convention fixed in `db/base.py` metadata for deterministic Alembic diffs; all hotel-scoped tables carry indexed `hotel_id` FK.

## Frontend patterns (frontend/src/)
- Route groups: `(auth)`, `(partner)`, `(super-admin)`.
- `lib/api` typed client with automatic refresh-on-401 (single retry, no loops); `lib/permissions` mirrors backend permission codes for UI gating (never as security).
- Design tokens centralized (navy/gold palette per reference screens); shadcn/ui foundation; i18n en+hi dictionaries.
