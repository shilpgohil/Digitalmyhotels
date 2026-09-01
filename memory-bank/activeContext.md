# Active Context — DigitalMyHotels

## Current focus (client updated-figma restructure, 2026-09-02 night — UNCOMMITTED, awaiting user go)
- CLIENT PIVOT: no separate Bookings section. New IA: Guest Check-in (unified walk-in form = booking+checkin in ONE atomic action), Advance Booking (form page for future stays), Advance Bookings (list, arrivals check-in via /checkin?booking=id), Completed Bookings (history). /bookings redirects to /advance-bookings.
- Backend added: POST /checkins/book-and-checkin (transactional, rollback-tested); bookings.guest_type + check_in_time/check_out_time (migration 8a8183198d71); foreign_guest_details Form C table (3098be9b9d72) accepted via foreign_guest on both checkin endpoints + GET /bookings/{id}/foreign-guests; restaurant+damage charge categories (2bb039a3a637); GET /reports/restaurant-billing.
- Frontend added: unified check-in page (walk-in default mode + arrivals strip + ?booking= deep link; NewBookingInlineForm/?new=1 removed); priced service chips w/ selected list; MaskedIdInput (aadhaar show toggle); selfie camera capture (getUserMedia + capture="user"); walk-in Save Draft (localStorage dmh.checkinDraft.v1, restore banner); Form C section both modes; checkout page = full-page 2-column settlement layout (dialog engine reused via components/stay/checkout-summary.ts; dialog untouched); restaurant-billing + invoice-preview pages + nav; dashboard 4 quick actions + expired modal sessionStorage dmh.expiredModalShown; payments 6 figma stat cards (paid/partial/pending are COUNTS — API has no amounts); expenses inline add form (dialog removed, receipt upload dropped with it); room grid tile "..." status menu (hidden for occupied/reserved).
- Verified together: tsc clean, eslint 0 warnings, ruff, mypy, 110/110 tests. NOT COMMITTED per user instruction (commit only when user approves).
- Backlog acknowledged: i18n for checkin/checkout (heavy hardcoded English incl. new sections), standalone GST & Tax page (backend CGST/SGST split live in /reports/gst/by-booking), email invoice (no send endpoint; Resend stubbed), manual run-through of new flows before deploy.

## Previous focus (production live + full verification, 2026-09-02)
- PRODUCTION IS LIVE: frontend https://digitalmyhotels.vercel.app (Vercel), backend https://digitalmyhotels-api-sg.onrender.com (Render free, SINGAPORE region), Neon Postgres ap-southeast-1 (pooler URL), Backblaze B2 bucket "Digitialmyhotels" (us-east-005 — account-fixed region).
- LATENCY ROOT CAUSE (measured, fixed): original Render service was in OREGON while Neon is Singapore → every DB roundtrip 351 ms; recreated service in Singapore via Render API → SELECT 1 now 3.6 ms, login 3.4 s → ~150 ms. Old Oregon service (srv-da9hg71f2nfc73fj7m90) suspended; new SG service id srv-dabgrve10ojc73a9uj8g. Diagnostic endpoint: GET /health/db returns {checkout_ms, query_ms}.
- DB pool: persistent pool in production (pool_size 3, max_overflow 2, pool_recycle 240, pre_ping) + connect_args statement_cache_size=0 (Neon PgBouncer transaction mode). NullPool was tried and REVERTED — fresh Neon conn costs 1–3 s on 0.1 vCPU (SCRAM/TLS crypto).
- AUTH/refresh-logout fix (three layers): (1) access token + cached /me response in sessionStorage → instant restore on F5, no API call; (2) Next.js API routes at src/app/api/v1/auth/{login,refresh,logout}/route.ts handle the dmh_refresh cookie SERVER-SIDE (Next rewrites do NOT reliably forward Cookie headers — measured 17/18 refreshes arriving cookieless); routes re-issue the cookie for the frontend domain (first-party, SameSite=lax); (3) refreshAccessToken() always uses a RELATIVE url.
- Vercel: NEXT_PUBLIC_API_URL must stay EMPTY (proxy via API_PROXY_TARGET, server-side). Root vercel.json builds from frontend/ (GitHub integration root dir is "."), functions region sin1. CLI deploys from frontend/ dir also work.
- B2 storage fix: Render had the MASTER key (unsupported by S3 API → "Malformed Access Key Id", all uploads broken). Created scoped app key "digitalmyhotels-api-s3" via B2 native API, verified put/get/delete, updated Render env. boto3 calls wrapped in asyncio.to_thread (were blocking the event loop).
- Keep-alive cron every 10 min (fallback URL hardcoded to SG service; RENDER_BACKEND_URL secret optional).
- Verification pass 2026-09-02: ruff+mypy clean, 108/108 backend tests, tsc+eslint clean. Audits: UPI-ID leak in checkout dialog fixed (canViewUpiId gate); tenant-isolation hardening on secondary queries (stay._current_rooms_locked, bookings._release_rooms, charges void booking lookup, invoices existing lookup); payments page card/bank/other marked "manual record only".
- Known gaps (accepted/backlog): checkin page + checkout dialog have hardcoded English (i18n backlog); B2 in US East adds ~250 ms to image ops (account region fixed); dashboard has no per-page permission (all roles may view, by design).

## Previous focus (polish tier complete, 2026-08-15 night)
- Verification pass: 71 backend tests, ruff/mypy, tsc/eslint/build, en/hi parity 582=582 keys, all `t()` usages resolve (checker at `scripts/check_i18n_usage.py`), live health+login smoke green.
- Product tour shipped: driver.js, permission-aware bilingual steps, auto-start on first login (localStorage `dmh.tourDone.v1`), replay via header help button, anchors via `data-tour` attributes (sidebar, status cards, in-house table, quick actions, nav items, bell, locale, upgrade CTA).
- Polish tier: current-guests View drawer + printable registration card (window.print), rooms grid view w/ status filter chips + table toggle, bookings date-range filters (backend from/to on list), global header search (debounced bookings+guests), super-admin dashboard expired/recent tables. Dark mode intentionally skipped per product owner.
- BUG FIX: ledger "latest entry" ordering was non-deterministic on created_at ties (random UUID tiebreak) — added monotonic `seq` Identity column (migration 788a534e7bb2); current_balance/list_entries order by seq.

## Previous focus (Figma gap batch complete)
The prioritized Figma gap list is closed (see figmaCoverage.md "Gap closure status"): subscription surface, dashboard in-house table, payments summary/filters/billing table, GST by booking, check-in depth (docs/T&C/emergency/vehicle/service chips), super-admin renew. 71 backend tests + full frontend build green. Remaining work is polish tier (view drawer/print, room grid, dark mode, global search) and production provisioning (Neon/Render/Vercel/R2 credentials, Resend).

## Previous focus
Phases 0–5 implemented in the monorepo. Local-first: Docker Postgres on host port 5434, FastAPI, Next.js partner + super-admin portals.

## What just landed (post-plan audit, 2026-08-15 evening)
- Full audit against the approved plan found 5 gaps; all now closed:
  self-service password reset (request/confirm w/ single-use 1h token, session revocation, no user enumeration), change-password + enforced `must_reset_password` redirect after login, expense receipt attachment upload/download (PNG/JPEG/WebP/PDF, 5 MB), notifications bell in partner header, audit-log explorer page, vendors + recurring-expense creation dialogs, `render.yaml` preDeployCommand runs `alembic upgrade head`.
- Local run: Windows blocks port 8000 → backend runs on 8001; Next.js rewrites `/api/*` → `http://127.0.0.1:8001` (same-origin, no CORS issues). `NEXT_PUBLIC_API_URL` stays empty in dev.
- Verified: 66 backend tests, ruff, mypy, tsc, eslint, prod build (27 routes) all green.

## Earlier landings
- Phase 3 UI: payments (cash/UPI + charges + ledger), invoices (generate/PDF/cancel), expenses (approval workflow + recurring run).
- Phase 4: housekeeping tasks created on checkout/transfer; start/complete → room Available; maintenance; daily closing snapshot + reopen; shift handover; reports (occupancy/revenue/expenses/payments/GST) with CSV export.
- Phase 5: Super Admin dashboard/hotels/plans; trial subscription on hotel create; transaction block when a subscription is expired and `block_transactions_after_expiry`; in-app notifications API; audit log list; login rate limit; GitHub Actions CI; Render + Vercel wiring docs.

## Watchpoints
- Hotels without a subscription row stay unrestricted (keeps tests/local seed working). Super-admin-created hotels get a trial.
- Refresh cookie path is `/api/v1/auth`.
- Never return raw UPI IDs to worker roles.
- shadcn Base UI: no Radix `asChild`; use className on DialogTrigger.
- Integration tests need `pytestmark = pytest.mark.asyncio(loop_scope="session")`.

## Next (after this build)
- Provision Neon / Render / Vercel / R2 credentials and run production deploy.
- Plug Resend (or another provider) into the email interface.
- Screen-by-screen UX polish against the Figma inspiration set.
