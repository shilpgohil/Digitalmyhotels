# Progress — DigitalMyHotels

## Phase status
| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation (repo, auth, RBAC, tenant, audit, FE scaffold, i18n) | Done |
| 1 | Hotels, team, UPI/QR, rooms | Done |
| 2 | Guests, bookings, check-in/out, transfers | Done |
| 3 | Payments, ledger, invoices, GST, expenses | Done |
| 4 | Housekeeping, daily closing, handover, reports | Done |
| 5 | Super Admin, subscriptions, hardening, deployment | Done |

## What works
- Backend modular monolith under `backend/app` with versioned REST `/api/v1`.
- Partner portal: dashboard, rooms, team, settings/UPI, bookings, check-in/out, current guests, payments, invoices, expenses, housekeeping, reports, daily closing, shift handover. Bilingual en/hi.
- Super Admin portal: `/admin`, hotels, plans.
- Payments: cash + UPI only; append-only ledger; invoice PDF; GST engine.
- CI: `.github/workflows/ci.yml`. Deploy sketches: `backend/render.yaml`, `frontend/vercel.json`.

## Post-plan audit (2026-08-15)
All phases re-verified against the plan; gaps found and closed: password reset flow (+forgot/change-password pages, forced temp-password change), expense attachments, notifications bell, audit explorer page, vendor/recurring dialogs, Render migration pre-deploy. 66 backend tests green; frontend build 27 routes.

## Data & database (2026-08-15 night)
- Demo seed: `python -m scripts.seed_demo` (after base seed). Drives the REAL service layer: 18 rooms/3 types w/ bed types, 12 guests, 10 completed stays (payments→checkout→invoice→housekeeping, timestamps backdated over 30 days, one authorized-dues case), 3 in-house w/ partial UPI payments, 3 upcoming bookings, 10 expenses across the approval workflow, 3 vendors, 1 recurring template, 5 service items, GST registered, active standard subscription. Idempotent (marker guest phone 9800000001).
- Migration chain: initial → 0193cb441ff5 (figma gap) → 788a534e7bb2 (ledger seq) → cee32cabc6e3 (composite indexes). `alembic check` = zero drift.
- Composite indexes added per architecture blueprint: bookings(hotel,status)+(hotel,check_in_date), payments(hotel,paid_at), rooms(hotel,status), expenses(hotel,expense_date), invoices(hotel,invoice_date), audit(hotel,created_at).
- Ledger correctness: monotonic `seq` Identity column; balance/list ordering deterministic; verified sample ledger balances to 0.00 for fully paid stays via live API.
- Windows gotcha: uvicorn --reload children don't match 'uvicorn app.main' in CommandLine — kill by port (Get-NetTCPConnection) or orphaned children keep serving stale code on 8001.

## Auth/authorization security pass (2026-08-24)
All 5 issues found and closed:
1. RequirePermission component — wraps every restricted partner page, redirects to correct home instead of showing broken 403 page.
2. RequireAuth enhanced — super admins are now blocked from partner layout (redirected to /admin); non-super-admins blocked from super-admin layout as before.
3. All 15 partner pages guarded with per-page permission checks (invoices, expenses, team, daily-closing, shift-handover, reports, audit, housekeeping, checkin, checkout, bookings, current-guests, rooms, plan, settings).
4. ADMIN role permission fix: added EXPENSES_VIEW (had EXPENSES_CREATE without VIEW — create-and-never-see was inconsistent; confirmed by SRS §14).
5. 27 new integration tests cover: housekeeping blocked from all finance/booking/team, admin blocked from team+approve+refund+daily-closing, all hotel roles blocked from super-admin, tenant cross-hotel attempts blocked, manager/admin positive cases. 98 total tests pass.
Live API smoke test: 19/19 checks pass (housekeeping 403s, admin allowed endpoints, super admin isolation).

## Performance pass (2026-08-15 late)
- SQL echo decoupled from DEBUG (`SQL_ECHO` setting, default false) — per-statement console logging was the main dev-latency cost.
- Bookings list N+1 eliminated: `to_out_many` batches booking-rooms, rooms+types and guests into 3 fixed queries; router uses it. `to_out` delegates for singles.
- Measured after fix (local): health 3ms, bookings list 124ms, payments summary 158ms, room summary 50ms, current guests 116ms. Login ~200ms is argon2 by design.
- Remaining dev slowness is Next.js dev-mode first-visit compilation — production build is fast; don't run `next build` while `next dev` runs (shared `.next` lock deadlocks the build; if killed mid-build, delete `.next`).

## Dev environment notes
- Backend on port 8001 (Windows blocks 8000); frontend proxies /api via Next rewrites.
- Start: `uvicorn app.main:app --port 8001 --reload` + `npm run dev -- --port 3000`.

## Known issues / risks
- Pydantic EmailStr rejects reserved TLDs (.local) — seed uses `.in`.
- Local Postgres on host port 5434.
- Email is still a stub; R2 credentials are env-only until production.
- Super-admin hotel create requires a seeded `standard` plan (`python -m scripts.seed`).
