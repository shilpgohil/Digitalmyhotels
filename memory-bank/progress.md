# Progress — DigitalMyHotels

## Client-feedback master fix plan (2026-09-04) — COMPLETE & DEPLOYED
- All phases of memory-bank/MASTER_FIX_PLAN.md shipped in 6 commits (9c4ca86..2ae9ccf) and verified
  live on Render (deploy c166f66) + Vercel. Suite: 125 backend tests, tsc/eslint/build clean,
  i18n en=hi=1122 keys, smoke script 24/24.
- Money: whole-rupee everywhere; one settlement engine (checkout==invoice); atomic check-in;
  refunds ledgered; payment status recomputed on every due change (deposit included).
- Bookings: day-use/hourly (hourly_rate + migrations 83ac59174f62, 95c1dcc60bfe), rate overrides,
  check-in/out times on all listings, DateTimePicker component, editable service chips.
- Ops: Edit-stay + Overdue badge + CHECKOUT_OVERDUE 15-min notification sweep (fire-once);
  Completed Bookings ID-document drawer; expense filters/receipts; rooms status-menu parity +
  friendly errors + stale-housekeeping auto-cancel; vendor GSTIN/PAN validation; payments
  Correct/Refund UI; Aadhaar back-face OCR (strict pincode gate); mobile nav + hotel switcher;
  deep-link cleanup (client remap + backend templates).
- Outstanding (external only): RESEND_API_KEY; client calls on nav consolidation + hour-level
  day-use conflicts.

## Production deployment (2026-09-01/02) — LIVE
- Frontend: Vercel (digitalmyhotels.vercel.app), functions region sin1, root vercel.json builds frontend/ subdir. NEXT_PUBLIC_API_URL empty; API_PROXY_TARGET = SG backend.
- Backend: Render free tier SINGAPORE (digitalmyhotels-api-sg.onrender.com, srv-dabgrve10ojc73a9uj8g). Old Oregon service suspended — it was the latency root cause (351 ms/query cross-Pacific → 3.6 ms after move).
- DB: Neon ap-southeast-1 pooler URL; persistent pool (3+2, recycle 240, pre_ping, statement_cache_size=0).
- Storage: Backblaze B2 "Digitialmyhotels" us-east-005 with scoped app key (master key doesn't work with S3 API — was the upload-failure root cause). boto3 via asyncio.to_thread.
- Auth in prod: Next.js API routes own the refresh cookie (login/refresh/logout) because Next rewrites drop Cookie headers intermittently; access token + /me cached in sessionStorage for instant reload.
- Keep-alive: GitHub Actions every 10 min → /health. GZip middleware on backend. /health/db returns pool timings.
- Feature work since 2026-08-24: DD/MM/YYYY DateInput component everywhere; inline new-booking on /checkin (?new=1); date-aware RoomAvailabilityPicker (GET /rooms/availability); 3-step checkout dialog (itemized bill, cash/UPI + QR + UPI-ID for authorized roles, refund, invoice prompt); client-side Tesseract.js OCR autofill for Aadhar/PAN/Passport/DL/VoterID; expandable notification categories; registration-number row-lock + unique constraint; refund over-collection guard; payments summary conditional aggregation.
- Verification 2026-09-02: 108/108 tests, ruff, mypy, tsc, eslint all green. Security audits run (frontend + backend) — UPI-ID checkout gate fixed, secondary-query hotel_id filters added.

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
