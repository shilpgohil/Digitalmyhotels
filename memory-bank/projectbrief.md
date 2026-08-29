# Project Brief — DigitalMyHotels

## What
DigitalMyHotels is a multi-tenant SaaS hotel management platform with two portal families:
- Hotel Partner Portal (owners, managers, reception/admin, housekeeping)
- Main Admin / Super Admin Portal (platform control, hotels, subscriptions)

Primary workflow: Booking → Check-in → Stay → Charges/Payments → Checkout → Cleaning → Available.

## Core requirements
- Strict tenant isolation: a hotel never sees another hotel's data; `hotel_id` derived server-side from membership, never trusted from the client.
- Payments: Cash and UPI only. No card/bank-transfer/gateway in this phase.
- UPI: raw UPI ID restricted to Owner/Manager/Admin; workers see only the generated QR (hotel logo composited in center). Every UPI change audited.
- Guest entered once, reused via phone / last-4 ID search with explicit autofill returning base data only (no booking history).
- Financial records: Decimal money, append-oriented ledger, void/correct — never destructive delete.
- Full SRS scope: hotels, rooms, bookings, guests, check-in/out, transfers, charges, payments, invoices, GST, expenses, vendors, recurring expenses, housekeeping, maintenance, reports, daily closing, shift handover, team, notifications, audit logs, subscriptions, Super Admin.

## Source documents (in `main documents/`)
- `DIGITALMYHOTELS_MASTER_CONTEXT.md` — reconciled source of truth
- `DIGITALMYHOTELS_ARCHITECTURE.md` — architecture/data blueprint
- `AI_WORK_GUIDANCE.md` — working rules
- `DIGITALMYHOTELS_CURSOR_ANTIGRAVITY_KICKOFF_PROMPT.md` — kickoff contract
- `client documentations/DigitalMyHotels_Final_SRS (1).docx` — functional SRS (text copy: `memory-bank/srs-reference.txt`)
- `client documentations/inspiration figma/` — visual references (inspiration only)

## Non-negotiables
Backend: Python/FastAPI (SRS Node.js recommendation superseded). Frontend: Next.js/React/TS. DB: PostgreSQL. Deployment: Vercel + Render + Neon (not AWS). Suggest-first protocol for material deviations.
