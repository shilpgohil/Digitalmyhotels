# Product Context — DigitalMyHotels

## Why this exists
Small/mid-size Indian hotels run front-desk operations on paper or fragmented tools. DigitalMyHotels gives them one operational system: bookings, check-in/out, folios, payments (Cash/UPI), GST invoices, expenses, housekeeping, and end-of-day reconciliation — plus a platform layer for the SaaS operator to manage hotel subscriptions.

## Users
- Super Admin (platform operator): manages hotels, subscriptions, platform reporting.
- Hotel Owner: full hotel control, creates team, financials, settings, UPI config.
- Hotel Manager: operations + financials, UPI config, reports; cannot create owners.
- Admin/Reception: bookings, check-in/out, room status, operational payment collection, UPI config per policy.
- Housekeeping/Worker: cleaning/maintenance/room status; no financials; can show payment QR but never sees raw UPI ID.

## Experience goals
- Serious, well-funded, polished product feel: navy/gold visual language from reference screens, dense operational tables, precise hierarchy — not a generic SaaS/AI dashboard.
- Bilingual UI: English + Hindi labels (per reference check-in screen and confirmed decision).
- Every screen ships all real states: loading/empty/error/permission/saving/saved.
- Responsive by intent (desktop-first operational tool that adapts deliberately to tablet/mobile).
- India-specific: GST (CGST/SGST/IGST), Aadhaar-style ID handling (minimized, last-4 search), UPI QR payments, Asia/Kolkata timezone rendering.

## Key product rules
- Guest data entered once, reused via explicit search+autofill; autofill never exposes booking history.
- No payment gateway: UPI verification is operational/manual, but every payment is ledgered and auditable.
- Subscription expiry restricts transactions per plan policy while (optionally) preserving read access.
