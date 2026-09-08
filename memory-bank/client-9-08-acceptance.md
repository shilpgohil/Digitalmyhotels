# Client 9-08 Master Audit — Acceptance Ledger

**Generated:** 2026-09-08  
**Source screenshots:** `main documents/client changes and bugs/9-08-2026/`  
**Total items:** 39 (40 files — item 20 has a supplementary `12.26 AM` shot)  
**Plan reference:** `.cursor/plans/client_9-08_master_audit_0a367b29.plan.md`

Statuses: `implemented` | `partial` | `missing` | `needs_runtime_reproduction`

---

## Legend

| Column | Meaning |
|---|---|
| **#** | Plan sequence number |
| **File / Time** | WhatsApp screenshot filename (date at HH.MM AM/PM) |
| **Screen** | Which UI screen / route is shown |
| **Client Request** | Exact requirement as stated in the approved plan |
| **Class** | `bug` / `feature` / `data` / `ux` |
| **Status** | Current implementation state |
| **Frontend Files** | Primary TSX/TS files involved |
| **Backend / Entities** | API route, service, model, schema |
| **Acceptance Test** | Observable pass criterion |
| **Phase** | Delivery phase |

---

## Item 1 — Role-specific dashboard notifications

| Field | Value |
|---|---|
| **#** | 1 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.01.17 AM.jpeg` |
| **Screen** | Partner dashboard / notification panel |
| **Client Request** | Replace one-size-fits-all dashboard/notification content with role-specific information; Housekeeping must not see RevPAR or finance/admin categories |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/dashboard/page.tsx`, `frontend/src/components/layout/notifications-bell.tsx` |
| **Backend / Entities** | `GET /api/v1/notifications`, `backend/app/services/notifications.py` |
| **Acceptance Test** | Login as Housekeeping → no RevPAR card, no finance/admin notification categories visible; Login as Owner → all cards visible |
| **Phase** | Phase 4 |

---

## Item 2 — Role-filtered notification category chips

| Field | Value |
|---|---|
| **#** | 2 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.03.33 AM.jpeg` |
| **Screen** | Notifications dropdown — category chip bar |
| **Client Request** | Role-filter notification category chips and standardize category colors; remove irrelevant categories for Housekeeping |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/components/layout/notifications-bell.tsx` |
| **Backend / Entities** | `backend/app/services/notifications.py` |
| **Acceptance Test** | Housekeeping sees only housekeeping/room/maintenance chips; chip colors are consistent across roles |
| **Phase** | Phase 4 |

---

## Item 3 — Checkout pending amount mismatch

| Field | Value |
|---|---|
| **#** | 3 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.17.03 AM.jpeg` |
| **Screen** | Checkout / settlement dialog |
| **Client Request** | Fix checkout displayed pending amount versus backend `balance_due` discrepancy; preserve explicit due authorization |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkout/page.tsx`, `frontend/src/components/stay/checkout-summary.ts` |
| **Backend / Entities** | `GET /api/v1/checkouts/{id}/preview`, `backend/app/services/stay.py` — `compute_settlement()` |
| **Acceptance Test** | Settlement preview total == checkout POST response total == invoice total; no frontend arithmetic divergence |
| **Phase** | Phase 1 |

---

## Item 4 — No-match guest search opens Create Guest immediately

| Field | Value |
|---|---|
| **#** | 4 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.32.43 AM.jpeg` |
| **Screen** | Check-in — GuestPicker / new guest flow |
| **Client Request** | No-match guest search must immediately open the full Create Guest flow after Search, removing the second click |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/components/guests/guest-picker.tsx`, `frontend/src/app/(partner)/checkin/page.tsx` |
| **Backend / Entities** | `POST /api/v1/guests`, `backend/app/services/guests.py` |
| **Acceptance Test** | After searching a phone with no match, Create Guest form opens automatically without requiring an additional button press |
| **Phase** | Phase 2 |

---

## Item 5 — ID preview tile height and Aadhaar OCR noise suppression

| Field | Value |
|---|---|
| **#** | 5 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.41.21 AM.jpeg` |
| **Screen** | Check-in — ID document upload / preview |
| **Client Request** | Increase ID preview tile height and prevent noisy Aadhaar address OCR from populating incorrect fields |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/lib/id-ocr.ts`, `frontend/src/components/media/image-editor.tsx` |
| **Backend / Entities** | n/a (client-side OCR) |
| **Acceptance Test** | ID tile tall enough to read document; Aadhaar back-face OCR does not pre-fill address/city/state fields incorrectly (low-confidence values blocked) |
| **Phase** | Phase 2 |

---

## Item 6 — Passport expiry picker date range

| Field | Value |
|---|---|
| **#** | 6 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 9.52.11 AM.jpeg` |
| **Screen** | Check-in — foreign guest Form C / passport expiry field |
| **Client Request** | Passport expiry picker must support at least current year +10 and enforce sensible document-date limits |
| **Class** | bug |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/checkin/page.tsx`, stay form C date inputs |
| **Backend / Entities** | `backend/app/schemas/stay.py` — `ForeignGuestIn.passport_expiry` |
| **Acceptance Test** | Passport expiry datepicker allows selection up to `today.year + 10`; cannot select past dates as expiry |
| **Phase** | Phase 2 |

---

## Item 7 — Address/pincode/city/state OCR extraction correctness

| Field | Value |
|---|---|
| **#** | 7 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.00.06 AM.jpeg` |
| **Screen** | Check-in — Aadhaar OCR autofill / address fields |
| **Client Request** | Correct address/pincode/city/state extraction; autofill must be reviewed/confirmed and never silently apply low-confidence text |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/lib/id-ocr.ts` |
| **Backend / Entities** | n/a (client-side OCR) |
| **Acceptance Test** | After Aadhaar back scan, user sees a confirmation step; no field is auto-written without user confirmation; confidence score shown for address fields |
| **Phase** | Phase 2 |

---

## Item 8 — Load full saved ID for authorized roles

| Field | Value |
|---|---|
| **#** | 8 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.06.41 AM.jpeg` |
| **Screen** | Guest detail — ID document show/hide |
| **Client Request** | Load the full saved ID for authorized roles and make edit/show-hide behavior explicit |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/current-guests/page.tsx`, guest detail dialog |
| **Backend / Entities** | `GET /api/v1/guests/{id}` (needs audited full-ID response), `backend/app/services/guests.py` |
| **Acceptance Test** | Owner/Manager can toggle show/hide on the stored Aadhaar/ID number and see the full decrypted value; every reveal is recorded in the audit log; Housekeeping sees only masked value and cannot reveal it |
| **Phase** | Phase 2 |

---

## Item 9 — Co-guest phone in guest card

| Field | Value |
|---|---|
| **#** | 9 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.10.55 AM.jpeg` |
| **Screen** | Current Guests — guest card / additional guest detail |
| **Client Request** | Show the resolved additional guest's phone in the guest card |
| **Class** | bug |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/current-guests/page.tsx` |
| **Backend / Entities** | `GET /api/v1/current-guests` → `CurrentGuestOut`, `backend/app/schemas/stay.py` — co-guest phone |
| **Acceptance Test** | Guest card for a booking with co-guests shows each co-guest's phone number; field is present in the API response payload |
| **Phase** | Phase 3 |

---

## Item 10 — Document-specific crop frames

| Field | Value |
|---|---|
| **#** | 10 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.22.20 AM.jpeg` |
| **Screen** | Image editor — Aadhaar/DL/Passport crop |
| **Client Request** | Use document-specific crop frames for Aadhaar/DL/passport rather than one generic narrow frame |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/components/media/image-editor.tsx` |
| **Backend / Entities** | n/a |
| **Acceptance Test** | Aadhaar upload uses 85.6:54 mm aspect crop; passport uses 125:88 mm; DL uses 85.6:54 mm; selfie uses 1:1 |
| **Phase** | Phase 2 |

---

## Item 11 — Returning additional guest document preload

| Field | Value |
|---|---|
| **#** | 11 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.29.25 AM.jpeg` |
| **Screen** | Check-in — additional guest (co-guest) document section |
| **Client Request** | Returning additional guests must display existing front/back/selfie files, not blank upload tiles |
| **Class** | bug |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/checkin/page.tsx`, co-guest form |
| **Backend / Entities** | `GET /api/v1/guests/{id}` — must include `document_ids` / file URLs; `backend/app/services/guests.py` |
| **Acceptance Test** | When adding a returning guest as co-guest, front/back/selfie image tiles show the previously uploaded files instead of blank upload placeholders |
| **Phase** | Phase 2 |

---

## Item 12 — Special-requirement/checkout charges GST and settlement total

| Field | Value |
|---|---|
| **#** | 12 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.38.20 AM.jpeg` |
| **Screen** | Checkout — special-requirements charge section |
| **Client Request** | Special-requirement/checkout charges must add GST correctly and reconcile to one settlement total |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkout/page.tsx` |
| **Backend / Entities** | `backend/app/services/stay.py` — `compute_settlement()`, `GET /api/v1/checkouts/{id}/preview` |
| **Acceptance Test** | Adding a restaurant charge with GST enabled shows the correct GST amount; the settlement total equals room_subtotal + charges_total + gst − discount |
| **Phase** | Phase 1 |

---

## Item 13 — Authorized checkout discount

| Field | Value |
|---|---|
| **#** | 13 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 10.56.14 AM.jpeg` |
| **Screen** | Checkout — discount line |
| **Client Request** | Add authorized checkout discount, visibly subtract it, and persist it into booking/invoice/audit |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/checkout/page.tsx` |
| **Backend / Entities** | `POST /api/v1/checkouts`, `backend/app/schemas/stay.py` — `CheckOutRequest`, `backend/app/services/stay.py` |
| **Acceptance Test** | Owner/Manager can enter a discount amount at checkout; the discount is subtracted from final_total; it appears in the invoice and audit log |
| **Phase** | Phase 1 |

---

## Item 14 — Consistent payment methods across check-in and checkout

| Field | Value |
|---|---|
| **#** | 14 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 11.00.15 AM.jpeg` |
| **Screen** | Check-in payment / checkout payment — method selector |
| **Client Request** | Support Cash, UPI, Credit Card, Debit Card, Net Banking, Other consistently in check-in and checkout; preserve legacy `card` records |
| **Class** | feature |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkout/page.tsx`, `frontend/src/app/(partner)/checkin/page.tsx` |
| **Backend / Entities** | `backend/app/schemas/payment.py` — `PaymentCreate.method` pattern; `backend/app/models/payment.py` |
| **Acceptance Test** | Method selector shows Cash, UPI, Credit Card, Debit Card, Net Banking, Other; `credit_card`/`debit_card`/`net_banking` accepted by API; legacy `card` records remain queryable |
| **Phase** | Phase 1 |

---

## Item 15 — Edit Hotel partial-save failures

| Field | Value |
|---|---|
| **#** | 15 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 1.01.12 PM.jpeg` |
| **Screen** | Edit Hotel — multi-section save |
| **Client Request** | Diagnose Edit Hotel partial-save failures, show section-specific errors, remove duplicated mixed-language labels, and refresh saved state immediately |
| **Class** | bug |
| **Status** | needs_runtime_reproduction |
| **Frontend Files** | `frontend/src/app/(partner)/edit-hotel/page.tsx` |
| **Backend / Entities** | `PATCH /api/v1/hotels/me`, `backend/app/api/v1/hotels.py` |
| **Acceptance Test** | Saving any section shows a success toast or inline error specific to that section; no "Some changes could not be saved" without detail; page state reflects saved values immediately |
| **Phase** | Phase 7 |

---

## Item 16 — Super Admin hotel status/subscription label reconciliation

| Field | Value |
|---|---|
| **#** | 16 |
| **File / Time** | `WhatsApp Image 2026-09-07 at 8.38.54 PM.jpeg` |
| **Screen** | Super Admin — hotel list row |
| **Client Request** | Reconcile Super Admin hotel status, subscription status, and action labels so active/trial/expired/suspended cannot display contradictory states |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(super-admin)/admin/page.tsx` |
| **Backend / Entities** | `GET /api/v1/super-admin/hotels`, `backend/app/api/v1/super_admin.py`, `backend/app/services/super_admin.py` |
| **Acceptance Test** | A hotel cannot simultaneously show "Active" and "Expired"; derived display-status is computed from hotel.status + latest subscription; all contradictory combinations are impossible |
| **Phase** | Phase 6 |

---

## Item 17 — Room-status cards at top of smart dashboard

| Field | Value |
|---|---|
| **#** | 17 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 12.00.00 AM.jpeg` |
| **Screen** | Partner dashboard — room status cards |
| **Client Request** | Retain the six live room-status cards at the top of the smart hotel dashboard; role-specific insights follow them |
| **Class** | ux |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/dashboard/page.tsx` |
| **Backend / Entities** | `GET /api/v1/rooms/status-summary`, `backend/app/api/v1/rooms.py` |
| **Acceptance Test** | Dashboard shows Available, Occupied, Reserved, Cleaning Required, Maintenance, Out of Service cards at the top for all roles; financial insights appear below for authorized roles only |
| **Phase** | Phase 5 |

---

## Item 18 — Add Hotel layout validation baseline

| Field | Value |
|---|---|
| **#** | 18 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 12.09.08 AM.jpeg` |
| **Screen** | Super Admin — Add Hotel wizard |
| **Client Request** | Use the shown Add Hotel layout as the visual baseline while completing missing validation and save behavior |
| **Class** | ux |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(super-admin)/admin/add-hotel/page.tsx` |
| **Backend / Entities** | `POST /api/v1/super-admin/hotels`, `backend/app/api/v1/super_admin.py` |
| **Acceptance Test** | All required fields validated before save; success navigates to hotel list; logo/gallery/GST fields present |
| **Phase** | Phase 6 |

---

## Item 19 — Status-specific empty state in room list

| Field | Value |
|---|---|
| **#** | 19 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 12.13.43 AM.jpeg` |
| **Screen** | Rooms — status-filtered list with zero results |
| **Client Request** | Show a clear status-specific empty state such as "No maintenance rooms" rather than a blank strip |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/rooms/page.tsx` |
| **Backend / Entities** | `GET /api/v1/rooms?status=maintenance`, n/a |
| **Acceptance Test** | Filtering rooms by a status with zero results shows "No [status] rooms" message instead of empty space |
| **Phase** | Phase 3 |

---

## Item 20 — Current Guests → Check Out deep link

| Field | Value |
|---|---|
| **#** | 20 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 12.22.17 AM.jpeg` (supplementary: `12.26.29 AM.jpeg`) |
| **Screen** | Current Guests → Checkout |
| **Client Request** | Current Guests → Check Out must open checkout with that guest fully preloaded, without a second Load Guest action |
| **Class** | ux |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/current-guests/page.tsx`, `frontend/src/app/(partner)/checkout/page.tsx` |
| **Backend / Entities** | `GET /api/v1/checkouts/{booking_id}/preview` — must work via `?booking=` deep link |
| **Acceptance Test** | Clicking "Check Out" on a current-guest card navigates to `/checkout?booking=<id>` and shows the guest's settlement pre-loaded, no secondary "Load Guest" button required |
| **Phase** | Phase 3 |

---

## Item 21 — Advance-booking check-in compact details row

| Field | Value |
|---|---|
| **#** | 21 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 7.26.33 AM.jpeg` |
| **Screen** | Advance booking check-in — booking detail row |
| **Client Request** | Compact advance-booking check-in booking details into a clear row and reliably preload primary identity/documents |
| **Class** | ux |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkin/page.tsx` |
| **Backend / Entities** | `GET /api/v1/guests/{id}/autofill`, `backend/app/services/guests.py` |
| **Acceptance Test** | Advance booking check-in shows compact booking detail row; guest name, phone, ID type are pre-filled; document thumbnails present if previously uploaded |
| **Phase** | Phase 3 |

---

## Item 22 — Room replacement during advance-booking check-in

| Field | Value |
|---|---|
| **#** | 22 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 7.32.09 AM.jpeg` |
| **Screen** | Advance booking check-in — room replacement |
| **Client Request** | Permit room replacement during advance-booking check-in through availability-aware selection and atomic repricing |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/checkin/page.tsx`, `frontend/src/components/rooms/room-availability-picker.tsx` |
| **Backend / Entities** | `POST /api/v1/checkins` (needs room_replacement support), `backend/app/services/stay.py` |
| **Acceptance Test** | During advance check-in, staff can select a replacement room; original room released; new room reserved atomically; pricing updated |
| **Phase** | Phase 3 |

---

## Item 23 — Missed-arrival alert and returning guest data

| Field | Value |
|---|---|
| **#** | 23 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 7.45.01 AM.jpeg` |
| **Screen** | Advance bookings / notifications |
| **Client Request** | After a missed scheduled arrival plus two-hour grace, notify Front Desk; manual No-show/Cancel releases rooms. Also restore returning guest/co-guest identity data |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/advance-bookings/page.tsx`, `frontend/src/app/(partner)/checkin/page.tsx` |
| **Backend / Entities** | `backend/app/services/reminders.py` (needs missed_arrival sweep), `backend/app/models/booking.py` |
| **Acceptance Test** | 2h after scheduled check-in, a notification is sent to Front Desk role; booking status shows "Missed Arrival" and requires manual No-show/Cancel; room stays reserved until then |
| **Phase** | Phase 3 |

---

## Item 24 — Check-in timestamp and date validation guards

| Field | Value |
|---|---|
| **#** | 24 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 8.01.48 AM.jpeg` |
| **Screen** | Check-in — timestamp and date guard |
| **Client Request** | Validate actual check-in timestamp, scheduled stay dates, room status, and overdue labels as separate concepts; reject impossible early/future-state data |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkin/page.tsx` |
| **Backend / Entities** | `POST /api/v1/checkins`, `backend/app/services/stay.py` |
| **Acceptance Test** | Check-in with a future `checked_in_at` is rejected with an actionable error; Overdue badge only appears when checkout time is truly past; "Early" label only shown when actual check-in is before scheduled date |
| **Phase** | Phase 3 |

---

## Item 25 — Room action menu UX improvements

| Field | Value |
|---|---|
| **#** | 25 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 8.24.24 AM.jpeg` |
| **Screen** | Rooms — room tile action menu |
| **Client Request** | Improve room action menu width, border, title hierarchy, labels, and responsive positioning |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/rooms/page.tsx` |
| **Backend / Entities** | n/a |
| **Acceptance Test** | Room action menu has sufficient width to avoid text wrapping; menu position stays within viewport on small screens; title hierarchy is clear |
| **Phase** | Phase 5 |

---

## Item 26 — Checkout mismatch → atomic quote/settlement contract

| Field | Value |
|---|---|
| **#** | 26 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 8.35.13 AM.jpeg` |
| **Screen** | Checkout — second mismatch instance |
| **Client Request** | Second checkout mismatch confirms the need for an atomic quote/settlement contract rather than frontend arithmetic |
| **Class** | bug |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/checkout/page.tsx` |
| **Backend / Entities** | `GET /api/v1/checkouts/{id}/preview`, `backend/app/services/stay.py` — `compute_settlement()` |
| **Acceptance Test** | Frontend uses only server-provided `settlement_preview` values; no local sum re-calculation; preview response and checkout commit response totals match |
| **Phase** | Phase 1 |

---

## Item 27 — Super Admin plan management (remove 6-month plan)

| Field | Value |
|---|---|
| **#** | 27 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 8.49.18 AM.jpeg` |
| **Screen** | Super Admin — Plans management |
| **Client Request** | Remove/deactivate 6-month plan, retain only 1-month / 3-month / 12-month plans, and create full Super Admin plan management (approved plan matrix: 1/3/12 months) |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/plan/page.tsx`, Super Admin plans UI |
| **Backend / Entities** | `backend/app/api/v1/super_admin.py` — plan CRUD, `backend/app/models/platform.py` |
| **Acceptance Test** | 6-month plan is deactivated (not deleted) in DB; only 1-month, 3-month, and 12-month plans are active; Super Admin can PATCH plan price/features/active_state/display_order; renewal dialog shows only active plans |
| **Phase** | Phase 6 |

---

## Item 28 — Super Admin Edit Hotel action

| Field | Value |
|---|---|
| **#** | 28 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 9.40.29 AM.jpeg` |
| **Screen** | Super Admin — hotel detail/edit |
| **Client Request** | Add Super Admin Edit Hotel action and detail/edit page |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(super-admin)/admin/hotels/[id]/page.tsx` (to be created) |
| **Backend / Entities** | `GET/PATCH /api/v1/super-admin/hotels/{id}`, `backend/app/api/v1/super_admin.py` |
| **Acceptance Test** | Super Admin can click a hotel in the list → detail page → Edit button → save changes; uses hotel setup services rather than impersonation |
| **Phase** | Phase 6 |

---

## Item 29 — Edit Hotel room inventory normalization

| Field | Value |
|---|---|
| **#** | 29 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 9.57.02 AM.jpeg` |
| **Screen** | Edit Hotel — room inventory and special-requirements section |
| **Client Request** | Normalize Edit Hotel room inventory and special-requirement rows, stable numbering, add/remove behavior, and section validation for large datasets |
| **Class** | bug |
| **Status** | needs_runtime_reproduction |
| **Frontend Files** | `frontend/src/app/(partner)/edit-hotel/page.tsx` |
| **Backend / Entities** | `PATCH /api/v1/hotels/me/rooms`, `backend/app/api/v1/hotels.py` |
| **Acceptance Test** | Adding/removing rooms maintains stable numbering; duplicate detection prevents re-submission of the same room number; large inventory (50+ rooms) saves without timeout |
| **Phase** | Phase 7 |

---

## Item 30 — Phone login normalization and unregistered account handling

| Field | Value |
|---|---|
| **#** | 30 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 10.12.55 AM.jpeg` |
| **Screen** | Login — phone number input |
| **Client Request** | Verify phone login against normalized stored phones; surface whether account/phone is unregistered without leaking account existence; backfill missing owner phones through edit flows |
| **Class** | bug |
| **Status** | needs_runtime_reproduction |
| **Frontend Files** | `frontend/src/app/login/page.tsx` |
| **Backend / Entities** | `POST /api/v1/auth/login`, `backend/app/services/auth.py` |
| **Acceptance Test** | Login with phone works when DB stores phone with/without +91 prefix; unregistered phone returns "Phone number not registered" without revealing whether email exists; owner can add phone via team/settings edit |
| **Phase** | Phase 4 |

---

## Item 31 — Show/hide toggle on hotel-admin reset-password dialog

| Field | Value |
|---|---|
| **#** | 31 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 3.01.44 PM.jpeg` |
| **Screen** | Hotel Admin — reset password dialog |
| **Client Request** | Show/hide toggle on hotel-admin reset-password dialog |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/team/page.tsx` (password reset dialog) |
| **Backend / Entities** | `POST /api/v1/team/{id}/reset-password`, `backend/app/services/team.py` |
| **Acceptance Test** | Reset-password dialog has an eye-icon toggle on the password field; password is hidden by default |
| **Phase** | Phase 4 |

---

## Item 32 — Team Member Edit Profile

| Field | Value |
|---|---|
| **#** | 32 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 3.12.45 PM.jpeg` |
| **Screen** | Team — member row → Edit Profile |
| **Client Request** | Expose Team Member Edit Profile using the existing PATCH API |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(partner)/team/page.tsx` |
| **Backend / Entities** | `PATCH /api/v1/team/{id}`, `backend/app/services/team.py` |
| **Acceptance Test** | Team list has an "Edit" action per member; dialog allows editing full_name, phone, email; PATCH request succeeds and list reflects updated values |
| **Phase** | Phase 4 |

---

## Item 33 — Show/hide toggles on forced change-password page

| Field | Value |
|---|---|
| **#** | 33 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 3.18.32 PM.jpeg` |
| **Screen** | Change Password — forced reset page |
| **Client Request** | Show/hide toggles for current and new password on forced change-password page |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/change-password/page.tsx` |
| **Backend / Entities** | `POST /api/v1/auth/change-password`, `backend/app/services/auth.py` |
| **Acceptance Test** | Change-password page shows eye-icon toggles for both "Current password" and "New password" fields |
| **Phase** | Phase 4 |

---

## Item 34 — Hierarchical password reset (replace public Forgot Password)

| Field | Value |
|---|---|
| **#** | 34 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 3.25.08 PM.jpeg` |
| **Screen** | Login — Forgot Password link / hierarchical reset flow |
| **Client Request** | Replace public Forgot Password UX with the confirmed hierarchical reset workflow |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/forgot-password/page.tsx`, `frontend/src/app/(partner)/team/page.tsx` |
| **Backend / Entities** | `backend/app/services/auth.py`, `backend/app/services/team.py` |
| **Acceptance Test** | Public Forgot Password no longer self-serve; hotel staff request reset from Admin; Admin requests reset from Super Admin; temporary password issued, sessions revoked, change forced at next login |
| **Phase** | Phase 4 |

---

## Item 35 — Finance/admin notification visibility (Owner/Manager only)

| Field | Value |
|---|---|
| **#** | 35 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 3.36.26 PM.jpeg` |
| **Screen** | Notifications — visibility by role |
| **Client Request** | Finance/admin notification visibility is Owner/Manager-only; department notifications and unread state are user-specific |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/components/layout/notifications-bell.tsx` |
| **Backend / Entities** | `backend/app/services/notifications.py`, `backend/app/models/platform.py` — per-user read receipt |
| **Acceptance Test** | Housekeeping/Reception cannot see PAYMENT or REVENUE_REPORT notifications; one employee marking a notification read does not affect other employees' unread count |
| **Phase** | Phase 4 |

---

## Item 36 — Super Admin Settings (profile, password, All Customers)

| Field | Value |
|---|---|
| **#** | 36 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 4.04.14 PM.jpeg` |
| **Screen** | Super Admin — Settings page |
| **Client Request** | Create Super Admin Settings with Profile, Change Password, and feature-gated All Customers; dashboard count and menu appear when enabled; any customer detail view by Super Admin is audited |
| **Class** | feature |
| **Status** | missing |
| **Frontend Files** | `frontend/src/app/(super-admin)/admin/settings/page.tsx` (to be created) |
| **Backend / Entities** | `backend/app/api/v1/super_admin.py`, `backend/app/models/platform.py` — feature flags, audit log |
| **Acceptance Test** | Super Admin Settings page has Profile, Change Password, and All Customers toggle; enabling All Customers shows the count card and menu item on the dashboard; Super Admin viewing any customer record creates an audit log entry with actor, target hotel, and timestamp |
| **Phase** | Phase 6 |

---

## Item 37 — Super Admin route crash / error boundary

| Field | Value |
|---|---|
| **#** | 37 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 4.07.25 PM.jpeg` |
| **Screen** | Super Admin — `/admin/hotels?filter=all` client crash |
| **Client Request** | Reproduce and eliminate the Super Admin client-side route crash; add route-level error boundaries |
| **Class** | bug |
| **Status** | needs_runtime_reproduction |
| **Frontend Files** | `frontend/src/app/(super-admin)/admin/page.tsx`, error boundary component |
| **Backend / Entities** | `GET /api/v1/super-admin/hotels`, `backend/app/api/v1/super_admin.py` |
| **Acceptance Test** | Loading `/admin?filter=all` does not crash the page; if API errors, a route-level error boundary shows a retry UI instead of a blank page |
| **Phase** | Phase 6 |

---

## Item 38 — Renewal dialog "Choose Plan" empty state

| Field | Value |
|---|---|
| **#** | 38 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 4.10.52 PM.jpeg` |
| **Screen** | Renewal / plan selection dialog |
| **Client Request** | Rename empty renewal selection globally to "Choose Plan" and provide loading/empty/error states |
| **Class** | ux |
| **Status** | missing |
| **Frontend Files** | `frontend/src/components/admin/renew-dialog.tsx` |
| **Backend / Entities** | `GET /api/v1/subscriptions/plans`, `backend/app/api/v1/subscriptions.py` |
| **Acceptance Test** | Renewal dialog placeholder text is "Choose Plan"; loading skeleton shown while plans fetch; empty state shown if no plans; error state shown with retry if fetch fails |
| **Phase** | Phase 6 |

---

## Item 39 — Hourly overstay rate after checkout grace

| Field | Value |
|---|---|
| **#** | 39 |
| **File / Time** | `WhatsApp Image 2026-09-08 at 4.55.26 PM.jpeg` |
| **Screen** | Current Guests — overdue / hourly billing |
| **Client Request** | Apply hourly room rate after checkout grace while keeping the room occupied/unavailable until explicit checkout |
| **Class** | feature |
| **Status** | partial |
| **Frontend Files** | `frontend/src/app/(partner)/current-guests/page.tsx`, `frontend/src/app/(partner)/checkout/page.tsx` |
| **Backend / Entities** | `backend/app/services/stay.py` — `compute_settlement()` hourly overstay, `backend/app/models/hotel.py` — checkout grace config |
| **Acceptance Test** | After hotel checkout grace, each additional hour is charged at `room_type.hourly_rate`; room status remains Occupied until explicit checkout; late_fee in checkout response equals ceil(overdue_hours) × hourly_rate |
| **Phase** | Phase 1 |

---

## Phase 0 Summary

| Phase | Items | Status Distribution |
|---|---|---|
| Phase 1 (Settlement) | 3, 12, 13, 14, 26, 39 | 4 partial, 1 missing, 1 partial |
| Phase 2 (Identity/OCR) | 4, 5, 6, 7, 8, 9, 10, 11 | 2 partial, 5 missing, 1 partial |
| Phase 3 (Lifecycle) | 19, 20, 21, 22, 23, 24 | 3 partial, 3 missing |
| Phase 4 (Roles/Auth) | 1, 2, 30, 31, 32, 33, 34, 35 | 5 missing, 2 partial, 1 NRR |
| Phase 5 (Dashboard/UX) | 17, 25 | 1 partial, 1 missing |
| Phase 6 (Super Admin) | 16, 18, 27, 28, 36, 37, 38 | 3 partial, 4 missing/NRR |
| Phase 7 (Edit Hotel) | 15, 29 | 2 needs_runtime_reproduction |

## Approved Decisions (locked — do not re-negotiate without client sign-off)

| Decision | Item(s) | Detail |
|---|---|---|
| **Strict role matrix** | 1, 2, 8, 35 | Housekeeping cannot see finance/admin notifications, RevPAR, or full sensitive IDs; Owner/Manager have full access; role gates enforced at both API and UI |
| **Full sensitive ID with audit** | 8 | Authorized roles (Owner/Manager) may reveal full Aadhaar/ID number; every reveal is written to the audit log (actor, target, timestamp); Housekeeping always sees masked value only |
| **Manual missed-arrival handling** | 23 | No automatic no-show: after 2h grace past scheduled check-in, Front Desk receives an alert and must manually choose No-show or Cancel; room stays reserved until then |
| **1/3/12 month plans only** | 27 | The 6-month plan is deactivated (not deleted); only 1-month, 3-month, and 12-month plans remain active; Super Admin manages plan price/features via PATCH |
| **Hierarchical password reset** | 34 | Public self-serve Forgot Password is removed; hotel staff request reset from Admin; Admin requests from Super Admin; temporary password issued, all sessions revoked, change forced at next login |
| **Audited Super Admin customer detail** | 36 | All Customers section is feature-gated; any Super Admin access to a customer record produces an audit log entry with actor, target hotel, and timestamp |

## Baseline contract bugs found during Phase 0 audit

- `current-guests` limit: frontend sends `limit=200`; backend route cap was `le=100` → FIXED in commit 3305ac4 (`le=200`). Contract test added.
- Payment method enum: backend accepts `cash|upi|card|bank_transfer|other`; client screenshot #14 requests `credit_card|debit_card|net_banking` → NEEDS_CONTEXT (Phase 1 change).
- `billing-history` payment_mode filter: includes `card` but not `credit_card`/`debit_card` — consistent with backend enum, will require migration in Phase 1.
