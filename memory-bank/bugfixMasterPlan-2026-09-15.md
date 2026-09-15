# Bugfix & Hardening Master Plan — 2026-09-15

**STATUS: IMPLEMENTATION IN PROGRESS (started 15/09 13:10) — one item at a time
under the STRICT IMPLEMENTATION PROTOCOL below. Decisions Q1–Q9: proceeding with
the recommended option recorded per question unless the client overrides.**

**PHASE 1 SHIPPED 15/09 (commits d4eda62…588aa67):**
- §1.1 drafts hotel-scoped (v3 keys + one-time adoption migration)
- §1.2 session hand-off key hotel-scoped
- §1.8 HotelKeyed remount on hotel switch (kills cross-hotel form state)
- §1.6 selfie key prefix validation + regression test
- Part 2 backend: wind-down enforcement in tenant dep (mutations blocked past
  expiry+grace except /checkouts /payments /invoices /charges /subscriptions);
  integration test green; full suite 217 passed / 3 pre-existing failures
- Part 2 frontend: non-dismissible wind-down panel outside WIND_DOWN_PATHS
  (/plan /checkout /current-guests /payments /invoices), pending-renewal badge,
  en+hi. KEEP path lists in sync backend↔frontend.
STILL PENDING FOR PHASE 1 CLOSURE: production storage health check (user must
verify /storage/health on Render shows B2, else set env vars).

**PHASE 2 SHIPPED 15/09 (commits 36f5647…0cbcefb):**
- §5.1 identity flow: awaited primary-guest doc uploads (blank-tiles race),
  QueuedDocUpload initialFile (previews survive Confirm remount), read-only
  details summary on resolved co-guest card, labeled Edit/Update buttons,
  "+ Add Room" double-icon fixed.
- §4.3 OCR autofill: ARG-ORDER BUG fixed (side was passed as ID type — back
  faces never parsed, banner never showed); OCR failures now toast (en+hi).
- §4.2 draft v3: co-guests serialized (text data + newForm + Form C); restore
  mounts entries resolved; existing guests rehydrate profile+docs on mount.
  Queued FILES still don't survive restore — §4.2b (server-side draft docs)
  DEFERRED until production storage confirmed on B2.
- §5.2 same-day room rule (backend availability): stays starting TODAY
  (hotel-local date) exclude physically-occupied + mid-cleaning rooms →
  "coming free" section; future bookings unchanged; regression test
  (test_same_day_availability.py); day-use/lifecycle/concurrency suites green.
- §4.4 ID crop frame grows ~1.8× clamped to viewport (frame, NOT zoom — a
  zoom bump would have cropped card edges on immediate Done).
Full suite: 218 passed / 3 documented pre-existing failures. Build green.

**PHASE 3 SHIPPED 15/09 (commits df1399f…febba3e):**
- §3.2 refunds allocate advance→deposit (audited split; over-refund rejected).
- §3.4 invoices AUTO-GENERATED inside the checkout transaction; invoice_id in
  CheckOutOut; frontend uses it (fallback POST treats invoice_exists as
  success); View scrolls to preview; Generate dialog friendly on conflict.
  Invoice numbering now follows checkout order going forward.
- §3.3 reverse_checkout: cancels the active invoice, credits back the late
  fee ledger debit, BLOCKS when a payment exists >1min after checkout
  (margin excludes the same-transaction collection); 2 regression tests.
- §3.1 unified pricing: booking totals GST-aware at create/update/replace/
  add-room via shared _room_gst (mode-aware incl. inclusive); Edit Stay due
  now equals checkout/invoice; 2 old test baselines updated (documented),
  new regression test (1000 room → total 1120/tax 120 for registered hotel).
- §3.6 Card/Others buckets end-to-end: payments summary (card+other),
  expenses summary (card_amount/other_amount), reports payments-by-method
  (card/others), dashboard collection rows always visible; en+hi keys in
  money/dashboard/expenses/reports namespaces.
- §3.8 show_powered_by (migration aa15b9c27e01 — NOTE: id e1f2a3b4c5d6 was
  taken, cycle error taught us to check `alembic heads` before naming):
  invoice card + PDF footer, SA toggle on hotel edit Settings section,
  booking number added to invoice preview (PDF already had it).
Full suite: 222 passed / 3 documented pre-existing failures. Build green.
DEFERRED from Phase 3: §3.5 quote snapshot (medium, low urgency).

**PHASE 4 SHIPPED 15/09 (commits 9c20730…159cfc2 + test fix):**
- Part 6 (9c20730): shared invalidateRoomState/invalidateMoney helpers wired
  into housekeeping, rooms, checkout, payments, reversal, check-in, advance
  bookings, stay edits; 30s polling + focus refetch on room-state queries —
  the client's "Cleaning Soon needs refresh" class is closed.
- §7.1 (818b1ea): hotels.max_team_members (migration bb26c0d38f12, default
  5), enforced under hotel-row lock (race-safe), Team page X-of-Y quota,
  SA controls in Add Hotel + hotel edit; over-cap hotels keep members but
  cannot add.
- §7.2 (0e3140b): idle auto-logout 15 min, TIMESTAMP-based (mobile
  background-safe), warning toast at 14 min, partner + super-admin layouts.
- §7.3 (dde2200): change-password revokes all refresh sessions; per-account
  lockout (5 fails / 15 min).
- §1.7 (159cfc2): cross-hotel guest search+import — FULL-phone-only masked
  cross hits (prefix stays hotel-local), POST /guests/import with phone
  knowledge-proof, copies base data + newest ID doc per side into the
  importing hotel's storage prefix (NOT encrypted ID/notes; verification
  reset), idempotent, audited. Import buttons in GuestPicker + co-guest
  search. test_guests tenant-scoping test UPDATED to the new contract
  (direct access + foreign autofill still 404; masked-only hits).
Suite: 225 passed / 3 documented pre-existing. Build green.

**PHASE 3 REVERIFIED 15/09 (commit 4d4ea7a) — 3 real findings fixed:**
1. §3.1 interaction REGRESSION caught: booked check-in balance added approx
   GST on top of the now-GST-inclusive booking total (double count). GST in
   that breakdown now applies only to NEW desk extras. Walk-in preview
   unchanged (its room rates are ex-GST until the booking is created).
2. §3.4 stale-invoice hole: a MID-STAY invoice (check-in success screen) was
   reused at checkout, missing checkout charges/late fees (= client's
   "payment amount wrong print vs modal"). Checkout now CANCELS the stale
   invoice ("Superseded by the final checkout invoice") and regenerates.
   Regression test added.
3. §3.6: card/others added to the reports CSV export too.
Verified-held: wind-down×auto-invoice no new failure mode; reversal margin
excludes same-transaction collection; settle_booking_amounts counts deposit
(§3.2 flows correctly); PDF footer defaults ON when settings row missing;
dashboard 4-bucket percentages sum to 100. Suite: 223 passed / 3 pre-existing.

## STRICT IMPLEMENTATION PROTOCOL (binding for every item)

1. ONE ITEM AT A TIME. A change set touches only the files its item needs. No
   opportunistic edits — unrelated findings get logged in this file instead.
2. READ BEFORE WRITE. Read the full surrounding function/component before editing;
   after editing, re-read the diff (`git diff`) before verifying.
3. BLAST-RADIUS LIST. Before editing shared code (pricing, tenant deps, query keys,
   storage, GST), write down every flow that consumes it and check each one after.
4. PER-ITEM VERIFICATION. After each item: `tsc --noEmit` + targeted tests +
   lints on changed files. Every 3–4 items or before any push: full `next build` +
   backend `pytest` (docker Postgres) + `ruff`.
5. REGRESSION GUARD-RAILS (known fragile areas — check on every touch):
   - GST three-mode display/math (no blanket "show GST" fixes).
   - Whole-rupee money() rounding; never float arithmetic on amounts.
   - Tenant scoping: every new query/key/storage key carries hotel_id.
   - i18n en+hi parity for every new user-visible string.
   - 42px form controls; localYmd for calendar dates (never toISOString).
   - Draft/localStorage schema changes must keep backward-compat reads.
6. COMMIT PER ITEM (conventional message naming the plan section), push only after
   verification passes. Never bundle unrelated items in one commit.
7. REVERIFY THE CLIENT'S SYMPTOM. Each item ends by walking the client's exact
   reproduction (as a test where feasible, otherwise reasoned trace written in the
   commit message or this file).
8. STOP ON SURPRISE. If an edit reveals unexpected coupling, stop, re-plan the item
   here, then continue — never push through with guesses.


Sources merged into this plan:
1. Client bug batch of 15/09/2026 (~35 items, screenshots in `main documents/bugs and updates ss/`).
2. Verified root-cause investigation (this session, read-only).
3. Backend security/logic audit (subagent, 21 findings).
4. Frontend quality audit (subagent, 7 categories).
5. `main documents/DIGITALMYHOTELS_MASTER_CONTEXT.md` — source-of-truth doctrine.

Doc reconciliation recorded: the master context says "Cash + UPI only"; the client has
since requested Credit/Debit Card + Others as first-class payment modes (already
partially shipped). Per source-of-truth rule #1 (latest product-owner decision wins),
card/others are now official. This file supersedes the payment-modes section of the
master context.

---

## PART 1 — CRITICAL: Multi-hotel tenant isolation

### 1.1 Check-in drafts leak across hotels (client-reported, CONFIRMED)
- **Root cause:** `frontend/src/app/(partner)/checkin/page.tsx` stores all walk-in
  drafts under global localStorage key `dmh.checkinDrafts.v2` (+ legacy
  `dmh.checkinDraft.v1`). localStorage is per-browser, not per-account: Hotel B on the
  same machine sees Hotel A's drafts.
- **Fix plan:** key becomes `dmh.checkinDrafts.v3:<hotelId>`; read/write helpers take
  `activeHotelId`; drafts also carry `hotel_id` inside the payload (double check on
  restore). Migration: untagged v2 drafts adopt the hotel active at first load on that
  device (one-time; documented risk), then v2 key is deleted.
- **Risk:** migration can attach an old draft to the wrong hotel exactly once per
  device. Alternative (discard all old drafts) loses work. DECISION NEEDED (Q3).

### 1.2 sessionStorage booking id leak (audit 1.2, HIGH)
- `dmh.checkin.selectedBookingId` (sessionStorage) restores a Hotel A booking id after
  switching to Hotel B in the same tab. Fix: same hotel-scoped key pattern; validate
  the booking belongs to the active hotel before use.

### 1.3 Browser-storage hygiene rules (new convention)
- Any storage of hotel data MUST embed `activeHotelId` in the key.
- On hotel switch: continue `queryClient.clear()` AND clear hotel-scoped session keys.
- `dmh.addHotelDraft` (super admin) — LOW, scope per admin user id.

### 1.4 React Query keys missing hotel scope (audit 2.x, HIGH)
- `current-guests` dialogs (`["booking", id, "detail"]`, `["booking-guests", …]`,
  `["guest", id]`, …) and `checkout` (`["booking-for-checkout", id]`,
  `["checkout-quote", id, …]`) omit `activeHotelId`. Mitigated today by
  `queryClient.clear()` on switch, but required as defence-in-depth.
- Also: invalidation calls that omit the hotel id where the query includes it
  (`hotel-qr-png`, `renewal-request-mine`) — normalize.

### 1.5 Backend defence-in-depth (audit findings 6–9, MEDIUM)
Backend is fundamentally tenant-scoped (good), but add `hotel_id` filters at:
- `housekeeping.ensure_task_for_room` — Room/Booking loaded by bare id.
- `notifications.mark_read` — scope in SQL, not Python.
- `guests` document select — add `GuestDocument.hotel_id`.
- `bookings` room reloads after `_lock_rooms` — include `hotel_id`.
- `invoices` `db.get(Booking/Guest)` helpers — include `hotel_id`.

### 1.6 Attendance selfie key injection (audit #2, HIGH — real cross-tenant read)
- `self_check_in` stores whatever `selfie_key` the client sends; the serve path reads
  it with no prefix check → a leaked/guessed Hotel B key can be attached to a Hotel A
  record and then read by Hotel A managers.
- **Fix plan:** on save, require `selfie_key.startswith(f"hotels/{hotel_id}/")`
  (ideally the full staff-selfies prefix); reject otherwise. Add test.

### 1.8 Hotel switch mid-form submits under the wrong hotel (found in scenario pass)
- Switching hotels does not unmount pages: dirty form state (check-in fields, room
  selections) survives and can be submitted under the NEW hotel's X-Hotel-Id.
- **Fix plan:** key the partner layout on `activeHotelId` so every page remounts on
  switch. See scenario S6.

### 1.7 Cross-hotel guest search — the ONE intended data share (client-reported)
- Today `guests.search_guests` filters `Guest.hotel_id == hotel_id` — cross-hotel
  search doesn't exist, which is the client's "other hotel customer detail search not
  able to search".
- **Fix plan (respecting master-context privacy doctrine):** platform-wide search by
  FULL normalized phone (no prefix matching cross-hotel — prefix stays hotel-local) or
  exact id_last4; results masked (name + masked phone + source-hotel omitted);
  explicit Autofill copies base identity + documents INTO the current hotel as a new
  Guest row (documents object-copied under the current hotel's storage prefix);
  audited (`guests.cross_hotel_autofill`). Booking history is never exposed.
- **DECISION NEEDED (Q2):** confirm platform-wide scope.

---

## PART 2 — Expired-hotel enforcement (client: "Raj Place expired but can login")

- **Confirmed:** enforcement is a dismissible modal + banner; backend blocks only
  flagged transactions. Audit #5 lists all mutations an expired hotel can still do
  (cancel/edit stays, staff, attendance, closing, settings…).
- **Fix plan (server first):**
  1. Tenant dependency rejects hotels past expiry+grace with `subscription_expired`
     on ALL partner endpoints except whitelist: auth, `/subscriptions/me`, plan
     catalogue, renewal request, logout.
  2. Frontend: non-dismissible full-screen "Plan Expired" overlay (pattern: existing
     suspension overlay); actions = View Plans / Request Renewal / Logout.
  3. Renewal request status "Pending" shown inside the overlay + plan page (client's
     "Pending needed in the expired modal popup").
  4. Super-admin Extend (already shipped 14/09) instantly reopens access.
- **DECISION NEEDED (Q1):** hard login block vs login-but-locked-to-plan-screen
  (recommended: the latter, otherwise renewal is impossible in-product).

---

## PART 3 — Money integrity cluster

### 3.1 Booking totals vs invoice totals disagree (audit #3, HIGH — root of client's
"Edit Stay due wrong (784 vs 904)" and "payment amount wrong")
- `bookings.create_booking` total = subtotal − discount (NO GST); checkout quote,
  settlement and invoices are GST-aware. Two sources of truth → drifting "due" values
  across Current Guests / Edit Stay / Checkout / Invoice.
- **Fix plan:** one shared pricing function (rooms + charges + GST − discount) used by
  booking create/update, Edit Stay dialog data, checkout, invoice. Edit Stay dialog due
  switches to the GST-aware settlement value.

### 3.2 Refund under-reduces deposits (audit #1, HIGH)
- `refund_payment` allows refunds up to advance+deposit but only decrements advance.
- **Fix plan:** allocate refund against advance first, then security deposit; then
  `settle_booking_amounts`; audited amounts split in the audit record.

### 3.3 reverse_checkout leaves money artifacts (audit #4, HIGH)
- Reopens the stay but leaves checkout-time payments, late-fee ledger entries and
  the generated invoice intact.
- **Fix plan:** on reverse — void checkout-time collections (or block reverse when
  money was collected, requiring explicit correction first), reverse late-fee ledger
  entry, auto-cancel the invoice (reason "checkout reversed"). DECISION: block-vs-auto
  (recommended: auto-cancel invoice + reverse ledger, block if a NEW payment was
  recorded after checkout).

### 3.4 Invoice generation is lazy → "booking completed but no invoice" + "Invoice ID
wrong" (client-reported, CONFIRMED)
- Invoices are created only when Print/Download/Email is clicked post-checkout.
- **Fix plan:** generate the invoice inside the atomic checkout commit (existing
  duplicate-guard already prevents doubles). Numbers become chronological going
  forward; history is NOT renumbered (legal artifacts). "View" click scrolls the
  preview into view (`scrollIntoView`).

### 3.5 Checkout quote/settlement drift (audit #10, MEDIUM)
- Persist the quote snapshot on the checkout record; settle from the snapshot.

### 3.6 KPI cards: Credit/Debit Card + Others (client)
- Payment Details: shipped (verify backend summary buckets).
- Add same two buckets to Hotel Expenses KPIs and Dashboard "Today's Collection".

### 3.7 "GST not showing" (client) — VERIFY BEFORE FIXING
- After the three-mode GST implementation (commit 2c956f0), hiding GST is CORRECT for
  `no_gst` and `included_by_hotel` hotels. Reproduce against the reporting hotel's
  `gst_mode` first. Only if an `included_by_customer` hotel misses GST in
  print/modal do we trace display paths. Do NOT blanket-revert mode logic.

### 3.8 Misc money display (client)
- Additional charges breakdown (restaurant/damage/other) surfaced in Payment Details
  and Completed Bookings detail panel (not only checkout).
- Booking number shown under Payment Details rows and on Invoice list/preview
  ("Add below: Payment Details BK-0023 / Invoices BK-0023").
- "Powered by DigitalMyHotels" on invoice card + PDF footer; new
  `hotel_settings.show_powered_by` (default TRUE); super-admin toggle on hotel edit.

---

## PART 4 — Documents & storage cluster

### 4.1 Uploaded Aadhaar/photos not showing (client)
- **Prime suspect is deployment, not code:** production Render must have
  `STORAGE_BACKEND=b2` + credentials. Verify with GET /storage/health (shipped
  earlier). If "local" → set env vars; files uploaded before that are unrecoverable.
- If storage is healthy → falls into 4.2/5.x display wiring.

### 4.2 Draft restore loses co-guest data + documents (client)
- File objects cannot live in localStorage. Draft schema v3:
  - Full co-guest text data serialized (currently partial).
  - Documents: upload to server AT SELECTION TIME under
    `hotels/<hotelId>/drafts/<draftId>/…`, draft stores object keys; restore
    re-hydrates previews from keys; discard deletes the objects (+ background sweep
    for drafts older than 30 days). DECISION NEEDED (Q6).
  - Room amounts restore by re-fetching room rates (never trust stale prices).

### 4.3 Autofill: documents + button visibility (client)
- Include document references in the existing-guest autofill payload; render tiles.
- Fix the state-machine branch that hides the Autofill/OCR banner (see 5.1).
- OCR autofill banner only fires on OCR success — silent OCR failures look like a
  "missing button"; surface OCR failure as a warning toast.

### 4.4 ID photo viewer readability (client)
- Open viewer at ~2× initial zoom, keep pinch/drag; sharpen by rendering at natural
  resolution instead of fit-to-box.

---

## PART 5 — Check-in flow rework

### 5.1 Guest identity state machine (client, CRITICAL screenshots)
Symptoms: Create Guest/Confirm → blank; Confirm hides customer; edits show no Update
button. Plan: explicit states
`empty → editing → confirmed(read-only summary card w/ Change + Edit) → editing-dirty
(shows Update)`. Confirming never unmounts data; co-guests use the same component.
Includes: double "++" icon fix, Add Guest section polish.

### 5.2 Same-day room selection (client: "occupied rooms selectable")
- Availability is date-overlap based; physically-occupied-today rooms are offered for
  same-day check-ins with only a hint chip.
- Plan: for bookings starting TODAY — rooms still occupied (current stay not checked
  out) and rooms in `cleaning_in_progress` move to "coming free" (not selectable);
  `cleaning_required` stays selectable w/ hint (housekeeping reality); future-dated
  bookings keep current behavior; reserved/maintenance unchanged (already excluded by
  overlap). Advance booking inherits (same endpoint). DECISION NEEDED (Q5).

### 5.3 Post-check-in verification (client: "room status not updated")
- Covered by invalidation sweep (Part 6) + an integration test: check-in → room
  becomes occupied in ALL views without refresh.

---

## PART 6 — Data-sync / invalidation sweep (client: housekeeping status stale)

Audit table 3.x is the work list. Plan:
- Introduce shared invalidation helpers per domain: `invalidateRoomState(qc, hotelId)`
  → `rooms`, `room-status-summary`, `room-availability`, `hk-tasks`,
  `smart-dashboard`; `invalidateMoney(qc, hotelId)` → payments keys,
  `payment-summary-today`, `smart-dashboard`, `current-guests`, `invoices`.
- Apply to: housekeeping start/complete/resolve, rooms statusMutation, checkout,
  payments record/refund/correct, reverse checkout, check-in, advance-booking
  cancel/no-show, stay edit/transfer.
- Add `refetchOnWindowFocus: true` + `refetchInterval: 30_000` on room-status queries
  (multi-device desks converge without refresh).
- Notifications mark-read: add `onError` toast (audit 7.1).

---

## PART 7 — Platform features

### 7.1 Team member limit (client: default 5, super-admin adjustable)
- No cap exists today. Plan: `hotels.max_team_members` (int, default 5, migration);
  enforced in `team.create_member` counting ACTIVE members EXCLUDING owner (Q4);
  fields in super-admin Add Hotel + hotel edit; partner Team page shows
  "X of Y used" + limit-reached message. Hotels already over the cap keep members but
  cannot add until under it.

### 7.2 Idle auto-logout (client: 10–15 min)
- No idle tracking exists. Plan: frontend idle tracker (mouse/key/touch/visibility
  reset; 15 min → logout + `/login?reason=idle` note; warning toast at 14 min).
  Configurable constant. Note: master context already demands session expiry.

### 7.3 Auth hardening (audit #11, #12)
- change_password revokes all refresh sessions (reset already does).
- Per-account failed-login backoff/lockout in addition to per-IP window.

### 7.4 Status-label formatter (client: "Expiring_soon" etc.)
- One shared `formatStatus()` (snake_case → spaced Title Case, special-cases UPI/GST)
  used by plan page, daily closing, payments, completed bookings, housekeeping
  maintenance rows, super-admin views (audit 5.x list).

---

## PART 8 — UI polish batch (mechanical)

1. Capitalization sweep: shift handover labels (Opening Cash / Closing Cash /
   Full Name (Handover To)), team menu "Edit Profile", plan page "Valid Until",
   status labels via 7.4, remaining screenshot marks.
2. 42px: shift-handover Create Handover; plans page CTAs (Get Started / Choose …) +
   styling; audit 6.x candidates on PRIMARY controls (checkin selects, advance-booking
   forms, payments dialog triggers, invoices generate, team invite, edit-hotel
   selects). Tiny row actions stay small by design.
3. Plans page: center "Current Subscription" strip + card CTA row.
4. Team-members action menu: wider (no wrapping "Edit profile" / "Reset Password").
5. Sidebar order: STAFF group moves BELOW MONEY (partner sidebar + mobile tab bar
   priority list unchanged).
6. Checkout Find Booking dropdown: exclude completed bookings, +30% width,
   single-line option rows.
7. "Use my current location": reproduce; harden GeoError paths (permission denied /
   insecure origin / timeout each get a distinct toast; button never breaks layout).
8. Edit Hotel: newly-added room type appears in room dropdowns immediately
   (invalidate room-types after create — same class as Part 6).
9. Room Status page: CLEANING KPI counts match the chips (split "to clean" vs
   "cleaning" or count identically).
10. Expenses vendor-detail popover: verify deployed trigger works; fix dead ⋮ if not.
11. Hardcoded-English sweep (audit 4.x): room-availability-picker, advance-booking,
    admin revenue page, expenses/reports/housekeeping/empty-states → i18n keys en+hi.
12. Invoice list/preview UI pass (client: "invoices functionality need improve UI"):
    booking number column, status filters, View scroll-into-view (3.4).

---

## PART 9 — Plan-renewal payment verification flow (NEW FEATURE, client)

Client requirement (screenshot 63533826): "Payment process is currently not working."
1. Hotel opens Plan page → chooses a plan → sees the PLATFORM's payment QR / UPI ID
   (note: this is DigitalMyHotels' receiving UPI, NOT the hotel's guest-payment UPI —
   needs a platform_payment_config the super admin maintains in Admin Settings).
2. Hotel pays externally, then submits the renewal request WITH the UPI
   Transaction/Payment ID (new field on SubscriptionRenewalRequest: `transaction_ref`,
   free text, required).
3. Request lands in super admin Renewal Requests with the transaction ref visible;
   status = pending (this is also the "Pending expired model popup" state the partner
   sees — Part 2.3).
4. Super admin verifies the payment manually (bank/UPI app), clicks Approve → the
   existing `renew_subscription` applies the plan automatically; Reject requires a
   reason shown to the hotel.
5. Audited end-to-end; notification to the hotel on decision.
This builds on the EXISTING renewal-request machinery (subscriptions service) — the
new parts are: platform payment config, transaction_ref field + form, QR display on
the partner plan page, and the ref shown in the super admin approval UI.

## PART 10 — Late additions from the full client list (15/09 official sheet)

10.1 "Export functionality is not working" — root cause found & fixed 14/09 (backend
     customers limit cap 100 vs frontend 5000 → 422; commit a040a3b). VERIFY on
     deploy; plan keeps a regression test.
10.2 "I think Activate automatically when expired" — interpretation: a hotel whose
     lapsed plan is renewed/extended must return to ACTIVE automatically (no manual
     Activate). `renew_subscription`/`extend_subscription` already reactivate;
     ALSO make the reverse automatic: displayed status derives from subscription
     everywhere (done for detail 14/09 — extend to any remaining view that reads the
     raw hotel.status column). If instead the client means "auto-suspend on expiry",
     that is Part 2 (enforcement) — confirm reading (Q8).
10.3 "Temporary password → customer can't change password" — verify the team
     temp-password path sets `must_reset_password=True` and that the change-password
     screen is reachable for hotel members (the guard redirects; audit says backend
     enforcement exists — likely the team reset endpoint or the login redirect misses
     the flag). Investigate + fix; add test: temp password login → forced change.
10.4 "Generate Invoice button shows an error" — likely the `invoice_exists` conflict
     surfacing as a raw error when an invoice already exists for the booking. Plan:
     friendly message + auto-open the existing invoice; plus Part 3.4 (auto-generate
     at checkout) makes most manual generation unnecessary.
10.5 "Guest not found" (63535340) — reproduce: guest search returning nothing for an
     existing guest. Suspects: phone normalization mismatch (search normalizes, old
     rows saved unnormalized), or the guest belongs to another hotel (→ Part 1.7).
     Backfill migration to re-normalize `guests.normalized_phone` if confirmed.
10.6 "Super Admin Add hotel functionality is not working + not matching Figma" —
     reproduce the failing submit (likely a validation error not surfaced — the page
     already has an error banner; check API error mapping) + a Figma comparison pass
     on section order/fields. Includes 14/09 padding/42px fixes already shipped.
10.7 "Remove spacing and remove one scroll" (63563463) — nested scroll container
     (dialog/page with inner+outer scrollbars) + excess spacing; fix the container to
     a single scroll context.
10.8 "Next day automatically checkout — as per our discussion" (63577337) — client
     expects stays past their checkout DATE to be auto-checked-out the next day.
     Today: nothing auto-checks-out; overstay accrues hourly fees at manual checkout.
     DECISION NEEDED (Q9): auto-checkout at a fixed time next day (which time? what
     payment status? unpaid dues?) — recommend: auto-checkout job at hotel checkout
     time + grace, marking due as pending payment + notification, never silently
     collecting money. Needs client sign-off on the money handling.
10.9 "Currently open 2 modals — wrong" (63577418) — two dialogs stacked (likely the
     expired-plan modal over another dialog). Rule: single-modal discipline — the
     expired overlay suppresses/queues other dialogs; audit dialog triggers on the
     affected screen.
10.10 Reports page also gets Credit/Debit Card + Others in its payment split
     (63531712 mentions /reports alongside the dashboard) — extends Part 3.6.
10.11 "Vendor Detail show in Modal popup" — the expenses vendor ⋮ should open a
     proper modal dialog (existing hover-popover per screenshot) — convert to Dialog
     with full vendor fields (name/phone/GST). Extends Part 8.10.
10.12 "Wrong" (63535942, single word) — screenshot review required at implementation
     time; adjacent to room-count items, provisionally grouped with Part 8.9.

## Traceability — client sheet row → plan section

| Client item (short) | Plan section |
|---|---|
| First letter uppercase (all, multiple rows) | 7.4 + 8.1 |
| Link → plan page wrong | shipped 14/09 (a040a3b) — verify |
| Export not working | 10.1 (shipped — verify) |
| Recently Expired ≤5d + Expired list | shipped 14/09 — verify |
| Missing Total Revenue screen | shipped 14/09 — verify |
| 2 options Payment Details + Hotel Expense | 3.6 |
| Super admin reset password option | shipped 14/09 — verify |
| Expired but shows Active | shipped 14/09 (effective status) + 10.2 |
| Activate automatically when expired | 10.2 (Q8) |
| Edit hotel doesn't update | shipped 14/09 (cache invalidation) — verify |
| Uploaded Aadhaar/photo not showing | 4.1 (storage health first) |
| Room selection logic (reserved/occupied/cleaning/maintenance, advance booking) | 5.2 (Q5) |
| Autofill missing Aadhaar/photo | 4.3 |
| Autofill button not showing (both flows) | 4.3 + 5.1 |
| Restore: co-guests + room amounts missing | 4.2 |
| GST not showing | 3.7 (verify mode first) |
| Missing GST → payment wrong (print+modal) | 3.1 + 3.7 |
| Card/Others on expense page | 3.6 |
| Vendor detail modal | 10.11 |
| Housekeeping status stale + sync audit | Part 6 |
| Card/Others on dashboard + reports | 3.6 + 10.10 |
| Move Staff after Money (sidebar) | 8.5 |
| Capital + 42px (shift handover) | 8.1 + 8.2 |
| Invoice not generated | 3.4 |
| Powered by DigitalMyHotels + SA toggle | 3.8 |
| Pending in expired modal | 2.3 + Part 9 |
| Payment process (QR → txn id → SA verify → auto-update) | Part 9 |
| Plans page center + 42px buttons | 8.2 + 8.3 |
| Expiring_soon → "Expiring Soon" + status conditions | 7.4 |
| Create/Confirm guest blank / hide / no update | 5.1 |
| ID photo zoom 2× | 4.4 |
| Incorrect payment due | 3.1 |
| Guest not found | 10.5 |
| Temp password → can't change | 10.3 |
| Room status wrong count | 8.9 |
| "Wrong" (unlabelled) | 10.12 |
| P Capital + width (team menu) | 8.1 + 8.4 |
| Additional charges detail | 3.8 |
| Check-in flow full audit | Part 5 + Part 6 |
| Invoices functionality + UI | 3.4 + 8.12 |
| Generate Invoice error | 10.4 |
| Other-hotel customer search | 1.7 (Q2) |
| Invoice ID wrong | 3.4 |
| Max 5 team members + SA limit | 7.1 (Q4) |
| Idle auto-logout 10–15 min | 7.2 |
| Use my current location broken | 8.7 |
| Room type not displayed after add + capital | 8.8 + 8.1 |
| Single line +30% width, completed bookings excluded, BK-id below | 8.6 + 3.8 |
| SA Add Hotel not working + Figma | 10.6 |
| Remove spacing + one scroll | 10.7 |
| Auto-checkout next day | 10.8 (Q9) |
| Two modals open | 10.9 |

## CROSS-VERIFICATION RESULTS (claims re-checked first-hand, 15/09 12:40)

Audit claims are NOT blindly trusted — each load-bearing one was re-verified in code:

| Claim | Verdict |
|---|---|
| `queryClient.clear()` on hotel switch exists | ✅ TRUE (`partner-header.tsx` L71) — mitigates unscoped query keys on switch; localStorage NOT cleared, so draft leak stands |
| Refund only reduces advance, never deposit | ✅ CONFIRMED (`payments.py` L431 vs L459) — real money bug |
| Selfie key stored verbatim + served unchecked | ✅ CONFIRMED (`attendance.py` L306→L210, serve L1099) — real cross-tenant read |
| Booking totals exclude GST | ✅ CONFIRMED (`bookings.py` L216, L467, L657, L792) — drift with GST-aware checkout/invoice is real |
| `update_booking`/`cancel_booking` skip expiry check | ✅ CONFIRMED — no `assert_transactions_allowed` |
| sessionStorage booking-id leak (audit 1.2 HIGH) | ⚠️ DOWNGRADED TO LOW — stored id is matched against the CURRENT hotel's booking list before use (`checkin/page.tsx` L4786); a foreign id resolves to nothing. Fix stays (hygiene) but not urgent |
| `mark_read` cross-tenant (audit #7 MEDIUM) | ⚠️ DOWNGRADED TO LOW — Python checks block cross-hotel rows; only rows with BOTH `user_id` and `hotel_id` NULL are exposed, and no code path creates such rows today. SQL-level scoping stays as defence-in-depth |

## CROSS-CUTTING SCENARIO MATRIX (product-level stress test of the plan)

**S1 — Expired hotel WITH in-house guests (CHANGES Part 2 design).**
Blanket blocking at expiry+grace would trap checked-in guests: no checkout, no due
collection, no invoice. Revised Part 2 design — expiry blocks by OPERATION CLASS:
- BLOCKED: new bookings, advance bookings, check-ins, new charges on new stays,
  staff creation, settings changes.
- ALLOWED (wind-down): checkout of existing in-house stays, payment collection and
  invoice generation for those stays, read access everywhere.
- The expired overlay reflects this: "You can complete current guest checkouts;
  renew to resume operations."
This also protects the auto-checkout job (10.8) from expiry blocking.

**S2 — Mobile view.** Sidebar reorder (8.5) propagates automatically (mobile drawer
renders the same PartnerNav); mobile tab bar priority list untouched. Expired overlay:
full-screen, scroll-behind locked, tested at 360px. Plans-page centering verified in
stacked mobile layout. Room picker "coming free" section must remain visible on
mobile when same-day blocking moves rooms there. ID viewer 2×: initial scale only —
pinch gestures keep working. Idle logout must use a last-activity TIMESTAMP compared
on visibilitychange/focus (not a plain setTimeout — mobile browsers freeze timers in
background, which would otherwise never fire or fire wrongly on return). Draft doc
uploads reuse the existing compress helpers before upload (mobile data).

**S3 — Concurrency.** Room double-booking: `_lock_rooms` verified present on
create/replace/add. Team limit enforcement must count members INSIDE the insert
transaction (lock the hotel row) or two simultaneous adds can exceed the cap.
Housekeeping/reception cross-device staleness: covered by 30s polling + focus
refetch (Part 6). Drafts stay per-browser by design (two devices never shared them);
server-side drafts are a possible future upgrade, out of scope now.

**S4 — Object storage.** Phase-1 GATE: production must be on B2 (health check) BEFORE
shipping draft-document uploads (4.2), or draft docs get lost like the Aadhaar photos.
The selfie-key prefix validation pattern (1.6) must be applied to EVERY client-supplied
object key (grep `_key` fields in all request schemas at implementation time).
Draft-doc sweeps (30-day orphan cleanup) prevent B2 bloat.

**S5 — Timezone.** Auto-checkout job (10.8) and "Expires in Nd" badges compute in the
HOTEL's timezone using the established localYmd pattern (attendance module precedent).
Never toISOString for calendar dates (known past bug class).

**S6 — Hotel switch mid-form (NEW finding → added as Part 1.8).**
Switching hotels in the header does NOT unmount the current page: React form state
(check-in guest fields, selected rooms) survives the switch, so a form filled under
Hotel A could be SUBMITTED under Hotel B's X-Hotel-Id. Plan: key the partner layout
content on `activeHotelId` (remount on switch) — one-line structural fix, verify no
lost-work complaints (acceptable: switching hotels mid-form is abandoning the form).

**S7 — Offline/flaky network.** Local text drafts keep working offline. Draft DOC
uploads require network: restore must tolerate missing/failed doc objects (placeholder
tile + re-upload prompt), never block restore of the text data.

**S8 — Migration safety.** Team-limit: hotels already over cap keep members (no
deletions). Invoice numbers: never renumbered. Draft migration: one-time adoption,
documented. All new columns nullable-or-defaulted (zero-downtime deploys on Render).

## Phasing & verification

- **Phase 1 (critical):** Part 1 (isolation) + Part 2 (expiry) + storage health check
  on production (4.1 decision point).
- **Phase 2:** Part 5 (check-in rework) + Part 4 (documents/drafts).
- **Phase 3:** Part 3 (money integrity — one sub-PR per finding, each with tests).
- **Phase 4:** Parts 6 + 7 (sync sweep, team limit, idle logout, auth hardening).
- **Phase 5:** Part 8 polish batch.

Every phase: `tsc --noEmit`, `next build`, `ruff`, `pytest` against dockerized
Postgres, plus a written manual-verification checklist per client item. Conventional
commits, one push per phase. New tests required for: draft scoping, expiry
enforcement, refund allocation, unified pricing, selfie-key validation, team limit,
same-day availability.

## Open decisions (blocking the respective items only)

- **Q1** Expired hotels: hard login block vs login-locked-to-plan-screen (recommended).
- **Q2** Cross-hotel guest search: platform-wide by full phone/ID-last4, masked, copy
  on explicit autofill — confirm.
- **Q3** Old untagged drafts: adopt into first active hotel vs discard.
- **Q4** Team limit counts: active members excluding owner — confirm.
- **Q5** Same-day check-in: hard-block occupied rooms vs blocking-confirm dialog.
- **Q6** Draft documents uploaded server-side at selection (with sweep) — confirm.
- **Q7** (merged into Q5) room statuses that must be hard-unselectable for same-day.
- **Q8** "Activate automatically when expired": confirm it means auto-REACTIVATE on
  renewal/extension (already true) + derived status everywhere — not auto-suspend.
- **Q9** Auto-checkout next day: confirm trigger time and how unpaid dues are
  handled (recommended: auto-checkout at hotel checkout time + grace, dues stay
  pending, notification fired, no silent money collection).

## Phase 1 additions from the official sheet
Phase 3 gains Part 9 (renewal payment flow) — it is a feature, not a bug, and sits
behind Q-decisions only for the auto-checkout item (Q9), which is Phase 4.
Bugs vs updates classification: rows marked "shipped — verify" are already-fixed bugs
awaiting the client's re-test on the new deploy; Parts 9, 7.1, 7.2, 10.8, 3.8
(Powered-by) are UPDATES (new functionality); everything else is a bug fix.
