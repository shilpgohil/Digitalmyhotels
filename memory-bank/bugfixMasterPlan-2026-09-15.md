# Bugfix & Hardening Master Plan — 2026-09-15

**STATUS: PLAN ONLY — nothing in this document has been implemented.**

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
