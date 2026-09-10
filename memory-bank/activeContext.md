# Active Context — DigitalMyHotels

## Figma design gap fixes (2026-09-09) — COMMITTED aad5f66

After viewing all 35 Figma design PNG files from `main documents/client documentations/client updated figma/`:

**Implemented (Excel rows 2 & 11 — Add Hotel missing items per Figma):**
1. **Add New Hotel — GST & Rooms Limits section** (new section):
   - GST type 3-option radio: "GST Included by Hotel" / "GST Including Customer" / "No GST Applicable"
   - Total No of Rooms count input (stored as `hotels.total_rooms`)
   - Passed to backend on creation → sets `gst_settings.is_gst_registered` + `hotel_settings.tax_inclusive_pricing`
2. **Add New Hotel — Property Gallery** (5 image slots, uploaded after hotel creation)
3. **Add New Hotel — Map ID field** (Property Identity section → `hotels.map_id`)
4. **Add New Hotel — Enhanced Payment Setup section**:
   - Merchant Name input (`hotel_payment_config.merchant_name`)
   - Payment URL input (`hotel_payment_config.payment_url`)
   - Renamed section from "UPI Payment Setup" → "Payment Setup"
5. **Edit Hotel — Map ID field** added to Property Identity section
6. **Partner Dashboard — Quick Actions**: "Billing History" → "Payment Ledger" (matches Figma 15.png)

**Backend changes:**
- `Hotel` model: `total_rooms: int | None`, `map_id: str | None`
- `HotelPaymentConfig` model: `merchant_name: str | None`, `payment_url: str | None`
- `HotelUpdate` schema: accepts `total_rooms`, `map_id`
- `PaymentConfigOut/Update`: includes `merchant_name`, `payment_url` (upi_id now optional)
- `CreateHotelRequest`: `gst_type`, `total_rooms`, `map_id`, `merchant_name`, `payment_url`
- `payment_config.update_upi_id()`: `upi_id` now optional; handles `merchant_name`/`payment_url`
- Migration `e1f2a3b4c5d6`: adds 4 new nullable columns

**Other Figma screens verified as already matching:**
- Admin Dashboard ✅ (6 stat cards, tables, quick actions)
- Plan Expired modal ✅ (SubscriptionGate already shows it)
- Check-in/Checkout ✅
- Current Guests / Advance Bookings / Completed Bookings ✅
- Invoice Preview ✅
- Payment Details ✅
- Expenses ✅
- GST & Tax ✅
- Room Status ✅
- Settings ✅
- Restaurant Billing ✅

---

## Option C — remaining acceptance ledger items (2026-09-09 late) — uncommitted

5 more items from the 9-08 acceptance ledger fully resolved:

1. **GuestPicker Edit button** (item 8): Clicking "Change" (renamed from "Edit")
   now keeps all autofilled form data — only clears the guest selection lock.
   No data loss when desk needs to search again.
2. **Edit Hotel race condition** (items 15, 29): `onSuccess` now awaits
   `refetchQueries` before resetting init flags, fixing row data disappearing
   after save.
3. **Missed arrival badge** (item 23): Advance Bookings table shows an amber
   "Missed arrival" badge on confirmed bookings whose check-in date+time is
   ≥ 2 h in the past (mirrors the backend sweep threshold).
4. **Super Admin hotel status** (item 16): `hotelDisplayStatus` now also
   checks `expiry_date < today`, eliminating Active+Expired contradictions
   caused by background-job lag.
5. **Add Hotel Emergency/Vehicle section removed** (item 18): Removed from
   Add Hotel wizard consistent with Edit Hotel change (item 15).

Quality: tsc ✅ · eslint 0 errors ✅ · ruff ✅ · 53 unit tests ✅ · en=hi=1462 ✅

---

## Client 9-08 full implementation (2026-09-09 evening) — uncommitted

All 18 items from the 9-08 screenshot analysis implemented:

**Phase 1 — Critical bugs:**
- Checkout balance error fixed: when `payStatus=paid`, `allow_due: true` now sent
  automatically, preventing spurious "Outstanding balance must be collected" 409.
- Login error: "Invalid email or password" → "Invalid email/phone or password" (en+hi+backend).
- GST on all charges: backend already correct; UI note clarified.

**Phase 2 — Role-filtered notifications:**
- `notificationCategoriesForRole()` + `canSeeFinanceMetrics()` in `permissions.ts`.
- `activeRoleCode` added to `useAuth()` context.
- NotificationsBell + Notifications page: filter chips AND items by role.
  Owner/Manager = all | Admin/Reception = front_desk/operations/housekeeping | Housekeeping = housekeeping only.
- Dashboard: RevPAR/ADR/ALOS/LEAD/Occupancy KPI row hidden for Housekeeping.

**Phase 3 — Identity/documents:**
- Returning guest: Aadhaar field pre-filled with `••••••••{id_last4}` in both Mode A & B.
  Masked placeholder NOT sent as `id_number` on submit (guard added).
- Image editor crop box: id_card 318×200 → 380×240 (wider landscape for Aadhaar/DL).
- Co-guest docs pre-loaded: existing code already handles this correctly.
- Passport expiry: already at today+15 years.
- ID tiles: already h-40 when loaded.

**Phase 4 — Checkout/payment:**
- Discount amount input added to checkout form (Owner/Manager only, gated on PAYMENTS_CORRECT).
  `discountAmount` + `discountReason` in draft → sent to quote AND commit.
- Payment modes: already correct (no legacy "Card").

**Phase 5 — Edit Hotel:**
- Emergency & Vehicle Details section removed from Edit Hotel (client: "Remove it all places").
- The settings PATCH that was failing (`collect_emergency_contact`) also removed → fixes
  "Some changes could not be saved" error.

**Phase 6 — UX polish:**
- All `<option value="">—</option>` globally replaced with `<option value="">— Select —</option>`.
- Room status menu: wider (w-64), bordered, `border-b` on "Change Status" header label.
- Compact booking summary banner added at top of Mode B check-in (BK-XXXX · dates · guest type).

**Phase 7 — Hourly overstay:**
- Already fully implemented in backend (quote_checkout) + frontend (lateFee line in settlement).

Quality gates: ruff ✅ · mypy ✅ · tsc --noEmit ✅ · 53 unit tests ✅ · en=hi=1460 keys ✅ · 0 ESLint errors ✅

---

## Full visual audit (2026-09-09 playwright) — COMMITTED

Live browser audit via Playwright MCP against localhost:3000 / :8001.

**Bugs found and fixed in this session:**
1. `notification_reads` table missing locally — ran `alembic upgrade head`
   (applied 6 pending migrations including `d2f4b8a1c6e9` guest_type fix)
2. Team Members page crashed: `EmailStr` rejects `.local` TLD in
   `TeamMemberOut.email` — changed output schema field to `str` (output
   schemas should not re-validate stored data)
3. `GuestType | ""` TypeScript type not threaded through `CheckinDraft`
   interface and `onChange` cast — fixed; `tsc --noEmit` clean
4. Hotels list "Deac" button text truncated — added `whitespace-nowrap` to
   `<td>` actions cell
5. 6-month plan still Active in DB — deactivated via direct DB update AND
   updated `seed.py` to enforce `is_active=False` for `plan-6m` going
   forward (client requirement #27: only 1/3/12-month plans active)

**Verified working:**
- Login page (password show/hide ✅, language toggle ✅)
- Dashboard (6 room cards, Smart Insights, KPI row, charts ✅)
- Current Guests (loads, overdue badge ✅)
- Completed Bookings (Cancelled/No-show chip queries both statuses ✅)
- Daily Closing (stats, no backdated warning when none exist ✅)
- Advance Bookings (chips, day-use times ✅)
- Rooms (maintenance empty state ✅)
- Check-in (guest type dropdown, Credit/Debit Card payment modes ✅)
- Team Members (fixed — was crashing) ✅
- Mobile 375px (hamburger, 2-col room cards, stacked arrivals ✅)
- Super Admin dashboard (charts, KPIs ✅)
- Super Admin hotels list ✅
- Super Admin plans (6-month now Inactive, 1/3/12 Active ✅)
- Super Admin settings (All Customers toggle ✅)
- Super Admin password requests (empty state ✅)
- Reports page ✅
- Plan page (3 active plans, no 6-month ✅)
- Security: hotel owner correctly blocked from /admin ✅

**Quality gates:** ruff ✅ · mypy 99 files ✅ · tsc --noEmit ✅ · 53 unit tests ✅

---

## Remaining audit backlog (2026-09-09) — implemented, uncommitted

Closed the leftover medium items from the 8-dimension audit (after the
critical/high batch: tax_amount, room_utilization N+1, reversal UI,
password guard, transfer guard, doc audit, notification pagination).

- **guest_type constraint corrected** to the live UI set
  (`business|personal|family|group|other`). The previous draft used Title
  Case (`Business|Leisure|…`) which would 422 every real check-in and
  silently rewrite existing rows to `Other`. Schema + DB CHECK + frontend
  `GuestType` union now share one set. Unit tests in
  `tests/unit/test_booking_schema.py` lock this.
- **Guest.full_name** lowercase functional index + migration
  `d2f4b8a1c6e9` (idempotent; constraint names follow
  `ck_%(table_name)s_%(constraint_name)s` so `alembic check` stays green).
- **Daily closing backdated-payment warning** serialized via `_closing_out`
  (not fragile ORM `__dict__`). i18n keys live under `ops` (they were
  mistakenly under `checkin`).
- **No-show records remain findable** without restoring the removed tab:
  completed-bookings Cancelled chip queries `cancelled,no_show`; global
  search deep-links `?status=cancelled`.
- **staleTime 30s** on daily-closing queries (advance/current/completed
  already had it).
- **CI** runs `alembic check` after `upgrade head`. ESLint suppressions
  documented in `frontend/eslint.config.mjs`.
- Advance bookings now persist `source: "advance"` (was defaulting to
  `walk_in`).

Still external / not in this batch: RESEND_API_KEY; production Neon data
inspection (controller); hour-level day-use conflicts (flagged to client).

---

## Phase 0 audit baseline — hardened (2026-09-08) — COMMITTED test: harden API contract baseline

Reviewer advisory findings fixed on top of a1abc72:
- `test_api_contracts.py`: 22 tests (2 added). Imports at module top. Phase-1
  rejection tests use real seeded bookings. `BILLING_HISTORY_REJECTED_MODES`
  used consistently; empty-string and no-parameter semantics explicitly tested.
- `check_api_limits.py`: `CapParseError` replaces sys.exit in cap-override
  parsing (testable). `scan_directory` returns `(calls, count)` tuple —
  eliminates second directory traversal. Known blind spots for dynamic `${LIMIT}`
  and URLSearchParams documented in docstring.
- `test_check_api_limits.py`: 37 tests (up from 24). Parametrized REQUIRED_CAPS.
  Blind-spot tests, CapParseError tests, multi-call-on-one-line, scan_directory
  tuple contract.
- `client-9-08-acceptance.md`: Phase 1/2/4 counts corrected. All status labels
  defined. Trailing whitespace removed. Neon inspection marked as open.

**OPEN — production Neon data inspection (controller-owned Phase 0 work):**
The schema-level check in activeContext notes below (alembic head, columns exist)
was limited to the 3305ac4 hotfix and is NOT a full data audit. Billing correctness,
ledger balances, and subscription state for live hotels have NOT been verified.
Requires controller credentials. See `memory-bank/client-9-08-acceptance.md`
"Production Neon data inspection" section for required actions.

---

## Phase 0 audit baseline complete (2026-09-08) — COMMITTED (Phase 0 tag)

- 39-item acceptance ledger: `memory-bank/client-9-08-acceptance.md` — all
  items audited from 40 screenshots (item 20 has supplementary `12.26.29 AM`
  shot explicitly referenced). Approved decisions locked in ledger:
  strict role matrix, full sensitive ID with audit trail, manual missed-arrival
  handling, 1/3/12-month plans only (6-month deactivated), hierarchical password
  reset, audited Super Admin customer detail.
- API contract tests: `backend/tests/integration/test_api_contracts.py` — 20
  tests covering current-guests limit/shape contract (regression guard for
  3305ac4), payment method enum boundary (Phase-1 boundary documented), and
  billing-history payment_mode filter. `_seed_booking` helper uses UUID-derived
  unique suffix per call (prevents collisions if fixture scope changes).
- Limit checker: `scripts/check_api_limits.py` — importable parse/check
  functions + CLI, 9 required endpoint caps. `scripts/tests/test_check_api_limits.py`
  24/24 unit tests pass. Checked against frontend/src: 0 violations / 101 files.
- Integration tests need live Postgres (port 5434). DB was offline during this
  session; TDD red state (20 ERRORs, DB connection refused) observed and
  recorded. Tests will go green when DB is available.
- checkin/page.tsx: formatting-only diff reverted cleanly.



## Current Guests 422 root cause (2026-09-06 late night) — FIXED 3305ac4 (live)
- SYMPTOM: Current Guests showed "Something went wrong Retry" persistently.
- FALSE LEADS: migration window, missing booking columns — production Neon was
  verified healthy (alembic head e3f5a2c1b8d9, columns exist, service function
  runs clean against prod data for all 3 hotels).
- REAL CAUSE: commit 7400467 changed the page to fetch ?limit=200, but the
  route validated Query(le=100) → permanent 422 on every request. The page's
  error state hid the message behind a generic "Something went wrong".
- FIX: checkins.py le=100→200 (matches rooms endpoint); error state now shows
  the real ApiError message. VERIFIED live: limit=200 returns 401 (auth), not 422.
- LESSON: when the frontend fetches with an explicit limit, check the route's
  le= cap. Error states must surface ApiError.message, never only tc("error").
- Diagnostic tooling: Render API key + Neon URL are in backend/scripts/_render_*.py;
  deploys can be checked via api.render.com /services/srv-dabgrve10ojc73a9uj8g/deploys.

## Current focus (2026-09-06 night — remaining items + notifications) — COMMITTED 9d25bf9

Commit 9d25bf9 (pushed):
- Current Guests View: RegisteredGuestCard + DocThumbnail in StayDetailDialog
- Completed Bookings: Form C toggle (passport/visa/arrival), foreignGuestBadge
- Restaurant Billing: GST=₹0 warning banner + link to GST settings
- Backend notifications: ARRIVAL_TODAY (check-in day reminder), CHECKOUT_REMINDER
  (2h before checkout), LOW_ROOM_AVAILABILITY (<20% available rooms)
- DB migration e3f5a2c1b8d9: arrival_notified_at + checkout_reminded_at on bookings
- All 3 sweeps wired into app lifespan background tasks

Also shipped in 5d72545:
- iPhone-style image editor with angle ruler (-45° to +45°)
- High-resolution output at source resolution (not CSS pixels)
- All upload paths pass correct maxDimension (1800 docs, 900 logos, 1600 gallery)

Additional Guests edit: ALREADY IMPLEMENTED (pencil button per co-guest card)
Partner sidebar role: ALREADY IMPLEMENTED (role_name shows below user name)
"Hi" badge in completed bookings: was from old code, NOT in current codebase

## Current focus (2026-09-06 evening — 9-06 client bugs) — COMMITTED 338107b

Commit 338107b (pushed):
- Expenses create_expense: IntegrityError → 400 ValidationAppError (was 500)
- Check-in UPI QR: 56×56 → 72×72 (30% larger per client request)
- Notifications dropdown: 26rem → 32rem wide, max-height 60vh

Most 9-06-2026 client bug screenshots were already addressed in e1d2ebb:
- Room Status left panel removed
- No-show tab on Completed Bookings removed
- Dashboard in-house has dropdown actions
- Payment Details filter bar exists
- Team Members has phone column + password toggle
- Shift Handover is already flat table + single row form
- Advance Booking uses NewGuestFullForm (Aadhaar flow)

Still open / next items:
- Current Guests View popup: show All Customer identity + additional guests + Aadhaar docs
- Restaurant Billing: show actual GST amount per row (currently 0% because charge category has no GST config)
- Checkout "Special Requirements" label / contact number display
- Additional Guests edit in check-in (add edit button per co-guest card)
- Completed Bookings: foreign guest details + "Hi" indicator removal
- Partner sidebar: "Logged in as X" should show role/designation below name

## Current focus (2026-09-06 evening — Super Admin + Mode B picker) — COMMITTED e1d2ebb
- Re-verified last batch: occupancy is booking-in-house (not room.status); stayover clean
  stays Occupied; checkout clean still goes Available. Plans seed + logo cache-bust +
  iPhone crop editor remain correct and are still uncommitted with this wave.
- Mode B (advance booking → check-in) now uses DateTimePicker, not native TimeInput.
- Super Admin: sidebar highlight uses `?filter=` so only one of Total/Active and
  Recently Expired/Expired is gold. Active list excludes lapsed subscriptions.
  Recently Expired = last 30 days; Expired Hotels = all expired. Lists show a
  real error+retry instead of endless skeletons. Total Hotels adds plan/expiry/status.
- Still open vs Figma: Add New Hotel wizard depth (logo/gallery/GST/draft), hotel
  detail/View page, serif titles, notification bell, mobile admin drawer.

## Current focus (MASTER FIX PLAN COMPLETE + DEPLOYED, 2026-09-04 night)
- ALL PHASES of memory-bank/MASTER_FIX_PLAN.md are done and LIVE in production (commits 9c4ca86 →
  2ae9ccf on master; Render deploy c166f66 confirmed live via API). See that file's Progress section
  for the full per-phase record — it is the authoritative status document.
- Headline systems shipped this session: whole-rupee money (money() ROUND_HALF_UP + fmtINR
  everywhere); settle_booking_amounts() single source for due/payment_status; compute_settlement()
  + GET /checkouts/{id}/preview (checkout == invoice by construction; checkout page shows server
  numbers); atomic check-in (charges+advance inside the txn, both modes); day-use/hourly bookings
  (room_types.hourly_rate, ceil-hours pricing, day blocks calendar date everywhere); rate_overrides
  (staff-edited rents → BookingRoom.rate → totals/ledger/invoice/audit); DateTimePicker rollout;
  date+time in ALL listings; Current Guests Edit-stay + Overdue badge; Completed Bookings ID-doc
  drawer (GET /bookings/{id}/guests); expenses filters+receipts; rooms menu parity + friendly
  transition errors + stale-task auto-cancel; vendor GSTIN/PAN validators; payments Correct/Refund
  actions; Aadhaar BACK-face OCR parser (pincode gate, preprocessing, never autofills garbage);
  mobile nav drawer + hotel switcher; deep-link remap + backend templates fixed; check-in error
  scroll/reasons; CHECKOUT_OVERDUE notification sweep (15-min in-process loop, fire-once via
  bookings.overdue_notified_at, tz-aware, alert-only).
- Verified at wrap-up: backend 125/125 tests, ruff+mypy clean; frontend tsc+eslint+prod build clean;
  i18n parity en=hi=1122; smoke_new_flows.py 24/24 against live local stack; production health OK
  (SELECT 1 ≈ 5.6 ms same-region).
- ONLY EXTERNAL INPUTS REMAIN: RESEND_API_KEY on Render (activates invoice email); client decisions
  on nav consolidation and hour-level day-use conflicts (both flagged; v1 = date-granular).
- Known accepted limitations: check-in draft does not restore co-guests/document files (documented);
  Sonar cognitive-complexity warnings on checkin submit handlers deferred (regression risk);
  B2 in US East adds ~250 ms to image ops (account region fixed).

## Previous focus (client updated-figma restructure, 2026-09-02 night — since committed/deployed)
- CLIENT PIVOT: no separate Bookings section. New IA: Guest Check-in (unified walk-in form = booking+checkin in ONE atomic action), Advance Booking (form page for future stays), Advance Bookings (list, arrivals check-in via /checkin?booking=id), Completed Bookings (history). /bookings redirects to /advance-bookings.
- Backend added: POST /checkins/book-and-checkin (transactional, rollback-tested); bookings.guest_type + check_in_time/check_out_time (migration 8a8183198d71); foreign_guest_details Form C table (3098be9b9d72) accepted via foreign_guest on both checkin endpoints + GET /bookings/{id}/foreign-guests; restaurant+damage charge categories (2bb039a3a637); GET /reports/restaurant-billing.
- Frontend added: unified check-in page (walk-in default mode + arrivals strip + ?booking= deep link; NewBookingInlineForm/?new=1 removed); priced service chips w/ selected list; MaskedIdInput (aadhaar show toggle); selfie camera capture (getUserMedia + capture="user"); walk-in Save Draft (localStorage dmh.checkinDraft.v1, restore banner); Form C section both modes; checkout page = full-page 2-column settlement layout (dialog engine reused via components/stay/checkout-summary.ts; dialog untouched); restaurant-billing + invoice-preview pages + nav; dashboard 4 quick actions + expired modal sessionStorage dmh.expiredModalShown; payments 6 figma stat cards (paid/partial/pending are COUNTS — API has no amounts); expenses inline add form (dialog removed, receipt upload dropped with it); room grid tile "..." status menu (hidden for occupied/reserved).
- Verified together: tsc clean, eslint 0 warnings, ruff, mypy, 110/110 tests.
- SECOND WAVE (same night): advance-booking→checkin FULL profile autofill (gender/DOB/address/ID-type via /guests/{id}/autofill on CheckinForm mount); FIXED silent autofill bug — frontend called POST endpoint with GET, swallowed 405 (all call sites now POST); email invoice COMPLETE (ResendEmailBackend w/ base64 PDF attachments, POST /invoices/{id}/email, checkout button wired; needs RESEND_API_KEY on Render — user will provide later, until then clear "email_not_configured" error); GST & Tax page (/gst-tax, CGST/SGST split from /reports/gst/by-booking); full i18n pass for checkin+checkout+dialog (268 new keys, en/hi parity 1054=1054, namespaces "checkin" + "checkoutPage"); Sonar fixes (redundant response_model x4 backend, Number.parseFloat, nested ternaries, DocSide type alias, .some()); Sonar cognitive-complexity warnings on checkin submit handlers DELIBERATELY deferred (regression risk).
- Smoke script scripts/smoke_new_flows.py (13 checks) — rerun after ANY deploy; phone suffix must be digits-only.
- CRITICAL DEPLOY LESSON: Render free tier IGNORES preDeployCommand — migrations run in startCommand ("alembic upgrade head && uvicorn ...").

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
