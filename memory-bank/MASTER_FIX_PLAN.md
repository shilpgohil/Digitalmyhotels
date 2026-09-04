# Master Fix Plan — Client Feedback + Internal Audit (2026-09-04)

## Progress (updated 2026-09-04 evening — commit 9c4ca86, deployed)

- ✅ Phase 0 COMPLETE: whole-rupee rounding (backend money() + frontend fmtINR across 24 files),
  DateTimePicker component built (not yet wired — Phase 3), cursor:pointer, keep-alive fixed.
  0.4 image-compression audit still open.
- ✅ Phase 1 COMPLETE: settle_booking_amounts everywhere; refund ledger at checkout;
  compute_settlement() + GET /checkouts/{id}/preview (checkout==invoice by construction);
  atomic check-in (charges+advance inside txn, both modes, frontend wired); Remaining honesty;
  Mode B GST from hotel rate. CheckoutDialog retired — current-guests deep-links /checkout?booking=.
- ✅ Phase 2 BACKEND COMPLETE: room_types.hourly_rate (+migration 83ac59174f62), same-day-with-times
  validation, ceil(hours)×hourly pricing w/ night fallback, day-use blocks calendar day in ALL
  overlap checks + availability endpoint, invoice "Day use (HH:MM–HH:MM)" lines, 5 tests.
  Rooms page has hourly-rate column+input. REMAINING: check-in/booking form same-day support+badges.
- ✅ Phase 2 FRONTEND COMPLETE: day-use in check-in walk-in + advance-booking forms (same-day
  validation, "Day use — N hrs" pill, hourly pricing), picker same-day mode w/ ₹X/hr hints.
- ✅ Phase 3 COMPLETE: DateTimePicker rolled into check-in + advance-booking; date+time in all
  listings (advance/completed/current-guests incl. print + day-use single-date format; arrivals
  strip; CurrentGuestOut now carries check_in_date + both times); new-guest BUTTON flow (GuestPicker
  + additional guests); editable room rates → rate_overrides (backend flows to BookingRoom.rate →
  totals/ledger/invoice/audit); editable service-chip amounts; Mode B check-out time (CheckInRequest
  .check_out_time → booking); "Available for …" header removed; vehicle Other → named field.
  BookingUpdate also accepts check_in_time/check_out_time (Phase 4 prep).
- ✅ Phase 4 COMPLETE: Current Guests Edit-stay dialog (checkout DateTimePicker/counts/instructions
  via PATCH, changed-fields-only) + red Overdue badge (23:59 fallback, display-only); Completed
  Bookings View sheet w/ auth-fetched ID doc thumbnails (GET /bookings/{id}/guests endpoint, batched);
  Expenses date/category/payment-mode filters (backend params) + Payment Mode column + receipt
  attach/view re-added (has_attachment computed field); Rooms grid/table share ONE status menu,
  friendly transition errors w/ allowed-targets hint (domain/room_status STATUS_LABELS); stale
  housekeeping tasks auto-cancelled on manual ready; Vendor GSTIN+PAN field validators; Payments
  Correct/Refund row actions (permission-gated dialogs).
- ✅ Phase 5 OCR ITEM DONE (user-emphasized): front face no longer extracts address; dedicated
  parseAadharBack (English Address label → lines until pincode, skips Devanagari, pincode extracted
  separately); strict gate (valid pincode + ≥60% word chars else "enter manually" warning);
  2x-upscale/grayscale/contrast preprocessing on back faces; wired in all 3 doc-upload sites;
  GuestPicker new-guest button flow done too.
- Backend suite: 117 passed. Frontend: tsc+eslint+prod build clean.
- NEXT (Phase 5 remainder): mobile nav drawer + responsive grids, hotel switcher, stale /bookings
  deep links, errors scroll-into-view + disabled-CheckIn reason, walk-in QR message, WhatsApp gating,
  draft completeness, payments stat-card labels, i18n parity sweep. Then Phase 6: smoke script
  extension (day-use, refund, rate override, overdue), full deploy verify, memory bank update.
  Phase 0.4 image-compression audit still open.

Sources: 21 client screenshots + WhatsApp notes (`main documents/client changes and bugs/`),
three internal audits (check-in flows, money surfaces, cross-cutting UX), and user decisions.

## Locked user decisions

1. **Day-use/hourly bookings: ALLOWED** — same-date checkout with hourly pricing logic.
2. **Rounding: WHOLE SYSTEM** — round to whole rupees everywhere (stored amounts included), ROUND_HALF_UP (₹200.49→200, ₹200.50→201).
3. **New-guest flow**: search finds nothing → "Create new guest" BUTTON → form opens on click (no auto-expand).
4. **Editable rates: YES** — room rent, service chips, restaurant/all charge amounts editable by staff; overrides flow into booking + invoice.
5. **Single DateTime picker** — custom popover with calendar + 24-hour time selection in ONE panel, one field ("02/09/2026, 14:00"). Not native, not separate fields.
6. **Checkout overdue** — when expected checkout date+time passes, auto-display an overdue message/badge (NOT auto-checkout; interpretation confirmed with user pending client double-check).

---

## Phase 0 — Foundations (do first; everything depends on these)

- **0.1 Whole-rupee rounding**
  - Backend: `domain/gst.py money()` → quantize to whole rupees ROUND_HALF_UP. Propagates through all services (bookings, charges, payments, invoices, ledger, GST engine). GST breakup rounded too.
  - Frontend: new `fmtINR()` in `lib/formatting.ts` (whole ₹, en-IN grouping); replace all `toFixed(2)` / inline `₹{value}`.
  - Update test assertions (`"4000.00"` style) accordingly. DB columns stay Numeric(12,2).
- **0.2 DateTimePicker component** — custom popover: month calendar grid + 24h HH:MM selectors in same panel; one display field. No new deps. Pattern like DateInput overlay but fully custom popover.
- **0.3 Global cursor:pointer** on buttons/checkboxes/selects.
- **0.4 Universal image compression** — audit EVERY upload site (check-in docs front/back/selfie, additional-guest docs, UPI logo, hotel logo, expense receipts when re-added) and enforce client-side compression via `compress-image.ts` before upload. Tuning: max dimension ~1600px, JPEG q≈0.85 (quality preserved, size cut 60–80%). CRITICAL nuance: run OCR on the ORIGINAL/lightly-compressed image (OCR accuracy needs resolution), upload the compressed one.
- **0.5 Fix keep-alive cron** — the GitHub Actions job fails because the `RENDER_BACKEND_URL` secret still points to the OLD suspended Oregon service (503/timeout). Fix: workflow pings the Singapore URL directly (`digitalmyhotels-api-sg.onrender.com`), ignoring the stale secret; verify next run is green.

## Phase 1 — Money correctness (backend-led)

1. **Recompute `payment_status` when due changes** (charges/fees added after payment → paid flips to partial). Fixes client's "PAID but ₹200 Due".
2. **Security deposit in due consistently** — payments service matches checkout logic.
3. **Refund recorded at checkout** — auto refund ledger/API entry when refund > 0; success screen: "Refund recorded — return ₹X".
4. **One GST policy** — Mode B 5% hardcode → hotel rate; apply_gst unified per hotel GST-registered setting; checkout computes GST via real engine so checkout grand total == invoice total.
5. **Atomic check-in** — extend `book-and-checkin` + `checkins` request bodies to include advance payment {amount, method, collected}, selected service charges, extra charges → single transaction. Fixes partial-failure stranding.
6. **"Remaining" honesty** — only subtract advance when "Payment collected" ticked; amber warning otherwise.

## Phase 2 — Day-use / hourly bookings

1. Migration: `room_types.hourly_rate` (nullable) + settings UI field.
2. Backend: allow check_out_date == check_in_date when checkout time > checkin time; price = ceil(hours) × hourly_rate, fallback full night rate if unset; day-use flag.
3. Conflicts v1: date-granularity (two day-use bookings can't share a room same day) — hour-level availability = v2, flag to client.
4. Frontend: same-day validation, "Day use (N hrs)" badges, hourly price in breakdown; invoice line "Day use — N hrs".
5. Tests for pricing + validation paths.

## Phase 3 — Client flow changes (check-in/booking UX)

1. DateTimePicker rollout: check-in + advance booking (in/out fields).
2. Date+time shown in ALL listings: arrival strip cards, advance bookings, completed bookings, current guests.
3. New-guest button-then-form flow.
4. Editable rates: `rate_overrides` on booking create → BookingRoom.rate → invoice; editable service-chip amounts at selection.
5. Mode B check-out time field (client: "Missing Check-out Time field").
6. Remove "Available for … → …" header line in room picker.
7. Vehicle Type "Other" → extra name field.

## Phase 4 — Actions & detail views

1. **Current Guests**: Edit action (dates/times/counts/instructions); stay dialog shows payment MODE + full contact number; **Checkout-overdue red badge** when expected checkout date+time < now (+ notification event).
2. **Completed Bookings**: View drawer — full guest details incl. Aadhar/ID images + selfie from B2.
3. **Expenses**: date-range/category filters + Payment Mode column in ledger + RE-ADD receipt attachment (upload in inline form, "view receipt" on ledger rows — was dropped when dialog was replaced; backend endpoints already exist).
4. **Rooms**: grid/list status menus identical; friendly transition error messages (no raw enums); housekeeping hides stale "Start cleaning" tasks.
5. **Vendor GSTIN**: field-level validation error (frontend pattern + clear backend detail).
6. **Payments page**: Correct / Refund / Void actions UI (backend already supports).

## Phase 5 — Platform UX (internal audit items)

- Mobile nav drawer + responsive check-in grids (payment 5-col, doc 3-col stack on mobile).
- Hotel switcher when memberships > 1; Team link in sidebar.
- Fix stale `/bookings` deep links (notifications + global search) preserving `?q=`; `/checkin?booking=` fetches by ID when not in first page.
- Errors scroll-into-view; disabled Check In shows reason.
- Walk-in UPI "QR not configured" message; room-rent stability (availability data in state, not cache read); WhatsApp gated until checkout done; remove fake ID "Submit" button.
- **Aadhar BACK-face OCR — dedicated accurate parser** (user emphasized; client saw garbage):
  - New `parseAadharBack()` in id-ocr.ts: locate the "Address:" label (English section), capture lines after it UNTIL the 6-digit pincode line; join as address. Skip Devanagari (Hindi) lines — keep the English block only.
  - Extract PINCODE separately (6-digit regex, must appear in/near address block) → fills the pincode field too.
  - Image preprocessing before Tesseract for accuracy: canvas upscale (2x if small), grayscale + contrast boost.
  - Strict confidence gate: only offer autofill when the block contains a valid pincode AND ≥60% word characters; NEVER autofill garbage — show "couldn't read address clearly, enter manually" instead.
  - Front-face parser: STOP extracting address from the front (front has no reliable address) — front = name/DOB/gender/number only.
- Draft completeness (extraCharges, terms, paymentReceived; co-guests/docs documented as non-restorable).
- i18n: advance-booking page, check-in payment labels, all new strings (en+hi parity).
- Payments stat cards: label Paid/Partial/Pending as BOOKING COUNTS (currently unlabeled counts next to ₹ cards).

## Pending on external input (not blocking)

- **Resend API key** (user will provide) → set on Render, verify real invoice email send.
- **Nav consolidation** (Advance Booking+list merge, Invoices+Preview merge) → flagged to client, awaiting their preference; not implemented without approval since it changes their Figma IA.
- **Hour-level room availability** (two day-use bookings same room same day) → v2, flagged to client.

## Phase 6 — Verification & ship

- Full test suite updated (rounding, day-use, atomic check-in).
- Extend `scripts/smoke_new_flows.py`: day-use booking, refund recording, rate override, overdue flag.
- en/hi parity check; tsc/eslint/ruff/mypy; production deploy + endpoint verification; memory bank update.

## Design calls made (vetoable)

- (a) Day-use conflicts stay date-granular in v1.
- (b) Hourly rate on room type; full-night fallback when unset.
- (c) GST on extra charges per hotel GST-registered setting uniformly.
- (d) Overdue = alert only, NOT auto-checkout.

## Client bug → phase mapping

| Client item | Phase |
|---|---|
| PAID but ₹200 Due | 1.1 |
| Address/pincode not autofilling (OCR garbage) | 5 (OCR quality) + data cleanup |
| OCR address garbage on front face | 5 |
| Housekeeping stale task + raw enum error | 4.4 |
| Vendor GSTIN generic error | 4.5 |
| Missing checkout time (Mode B) | 3.5 |
| Combined date+time picker | 0.2 + 3.1 |
| Times in all listings | 3.2 |
| Whole-rupee rounding | 0.1 |
| Editable amounts (rent/chips/charges) | 3.4 |
| New-guest button flow | 3.3 |
| Remove availability message | 3.6 |
| Vehicle Other extra field | 3.7 |
| Current Guests Edit + dialog fields | 4.1 |
| Completed Bookings View + ID images | 4.2 |
| Expenses filters + payment mode column | 4.3 |
| Rooms grid/list consistency | 4.4 |
| Cursor pointer | 0.3 |
| Day-use / hourly | 2 |
| Checkout overdue message | 4.1 |
