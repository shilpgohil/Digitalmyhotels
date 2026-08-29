# Active Context — DigitalMyHotels

## Current focus (polish tier complete, 2026-08-15 night)
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
