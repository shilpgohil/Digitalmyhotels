# Figma Reference Coverage Matrix — DigitalMyHotels

Reviewed all 28 PNG exports in `main documents/client documentations/inspiration figma/` (2026-08-15).
Figma = inspiration + minimum feature floor. Modernize freely, but everything shown must be covered.

## Partner portal screens

| # | Figma screen | Status | Deltas (feature-level, not styling) |
|---|---|---|---|
| 1 | Partner Login (2 variants) | Built | Figma allows username/phone login (we use email); password show/hide toggle missing |
| 2 | Dashboard | Built | In-House Guests table missing on dashboard (placeholder comment exists); "Billing History" quick action |
| 3 | Dashboard "Plan Has Expired" popup | MISSING | No partner-facing expiry modal/banner; backend blocks transactions only |
| 4 | Choose Your Plan page | MISSING | No partner plan/renewal page, no "Upgrade Plan" sidebar CTA |
| 5 | Complete Your Payment (plan renewal QR modal) | MISSING | Platform-UPI renewal QR + "I have completed payment" manual confirm |
| 6 | Guest Check-in (full form + Customer Data Search) | Core built | Missing: ID front/back/selfie uploads (guest_documents model exists, no endpoint/UI); bed type; special-requirement chips w/ configurable prices; emergency contact; vehicle details (number/type/parking slot); T&C checkbox; Save Draft |
| 7 | Guest Check-out + Detail | Built | Email invoice (needs provider); quick minibar/room-service charge fields inside checkout dialog |
| 8 | Current Guests (+ actions modal) | Built | "View" detail drawer; "Edit" stay; "Print" registration card |
| 9 | Completed Booking List | Partial | Date-range filter chips (All/Today/5 Days/Month/Year); print action; guest-details popover |
| 10 | Room Status | Built (table) | Figma is a card GRID w/ status filter chips — visual upgrade opportunity, feature parity exists |
| 11 | Payment Details | Core built | Summary cards (Total/Paid/Cash/UPI/Partial/Pending); time-period filter chips + date range; billing-history per-booking table (rent/GST/discount/advance/balance) |
| 12 | Invoice Preview | Built (PDF) | In-page styled invoice preview pane w/ booking selector (we open PDF instead) |
| 13 | Hotel Expenses | Built | Summary cards (Total/Today/This Month/Entries) + date filters |
| 14 | GST & Tax | Partial | Aggregate report exists; Figma shows PER-BOOKING GST table (rate/taxable/CGST/SGST/payable/final) + date filters |
| 15 | Restaurant Billing | By decision: charge category only | Screen is a food-charge GST listing — covered via charges(category=food); filtered listing possible later |
| 16 | Settings (Settings/Create Account/Reset Password tabs) | Built | Member photo upload (minor) |
| 17 | Edit Hotel Detail | Built | Property gallery (max 5 imgs); hotel-level "special requirements" price-list config; emergency-contact/vehicle-details feature toggles; room inventory w/ bed type |

## Super Admin (HotelAdmin) screens

| # | Figma screen | Status | Deltas |
|---|---|---|---|
| 18 | Hotel Management Dashboard | Built (cards) | Missing on dashboard: today's check-ins, total revenue, Recently Expired table w/ Renew, Recent Registrations table, quick actions row |
| 19 | Active Hotels list | Built | — |
| 20 | Add New Hotel (full wizard) | Built (dialog) | Figma wizard also sets UPI, room inventory, access toggles at creation (owner can do these in partner portal — acceptable) |
| 21 | Recently Expired Hotels | Partial | Dedicated expired view + Renew button in UI (assign-subscription API exists) |
| 22 | Recent Registrations + Approve | N/A | Hotels don't self-register in current product; super admin creates them. Revisit if self-signup is added |

## Cross-cutting Figma elements
- Notification bell: built. Dark-mode moon toggle: NOT built (next-themes installed, unused). Global header search: NOT built (per-page search exists).
- Bilingual labels (en/hi): built via i18n.

## Gap closure status (2026-08-15 evening batch — DONE)
1. DONE — Partner subscription surface: expired modal + banner (SubscriptionGate in partner layout), /plan page w/ tiers + current status, renewal-request endpoint (notifies super admins + audited), gold "Upgrade Plan" sidebar CTA.
2. DONE — Dashboard In-House Guests table (top 5 w/ payment badges) + Billing History quick action.
3. DONE — Payments: /payments/summary endpoint (total/cash/upi/refunds/deposits + booking status counts), date filters, summary cards, per-booking billing table.
4. DONE — GST by booking: /reports/gst/by-booking + table w/ CGST/SGST/IGST + totals on reports page.
5. DONE — Check-in depth: guest ID documents API (front/back/selfie upload/list/download, validated), upload tiles in check-in dialog, bed_type on rooms, emergency contact + vehicle/parking on bookings (create/patch/out), T&C checkbox gating check-in (sets registration acknowledged_at), hotel_service_items table + settings Services tab + chips in check-in that create folio charges.
6. DONE — Current-guests View drawer + printable registration card; bookings date-range filters.
7. DONE — Super admin Renew dialog (assign plan to hotel) + dashboard expired/recent tables.
8. DONE — Room grid view toggle w/ status chips; global header search. Dark mode: intentionally skipped (product owner decision).
9. DONE — Bilingual product tour (driver.js, permission-aware, auto-start once, replay from header).

Migration: alembic 0193cb441ff5 (bed_type, booking contact/vehicle, hotel_service_items). Verified: 71 backend tests, ruff/mypy, tsc/eslint, prod build (28 routes incl. /plan).

## Note
Figma MCP was requested but `.cursor/mcp.json` is empty / server not connected — analysis done from the PNG exports (complete screen set). If live-file access is needed, configure the Figma MCP and re-run a node-level pass.
