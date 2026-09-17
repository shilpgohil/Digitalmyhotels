# Post-Bugfix Verification Protocol & Non-Regression Rules

## Purpose
DigitalMyHotels is a multi-tenant SaaS platform where financial calculations, room state machines, tenant isolation, and UI representations are tightly coupled. 
This rule file defines the mandatory 7-stage verification procedure that MUST be executed after resolving ANY bug before declaring the fix complete.

---

## The 7-Stage Verification Procedure

### Stage 1: Blast-Radius Tracing
Before and after code modifications, trace the dependencies of all affected functions, models, or UI components:
- **Pricing / Tariff**: Check advance booking total, Current Guests due, Checkout quote, Invoice items & PDF.
- **GST Modes**: Check `no_gst` (hidden), `included_by_hotel` (extracted), `included_by_customer` (added), and restaurant folio.
- **Room Status**: Check Room grid (`/rooms`), Dashboard chips (`/dashboard`), check-in availability picker, and Housekeeping task board.
- **Check-In**: Check walk-in commit, advance check-in (`/checkin?booking=id`), co-guest card state, and local draft isolation (`v3:{hotelId}`).
- **Payments / Refunds**: Check ledger append order (`GuestBookingLedger`), advance-first refund allocation, payments breakdown, and Daily Closing.
- **Tenant / Auth**: Check `HotelKeyed` unmount on hotel switch, expired wind-down policy, and role UPI ID hiding.
- **Staff / Attendance**: Check geofence Haversine calculation, selfie key prefix validation, and overnight shift handling.

### Stage 2: Dual-Stack Type Gates
- **Frontend**: Run `npx tsc --noEmit` from `frontend/`. MUST exit with code 0 (zero errors).
- **Backend**: Run `mypy app` from `backend/`. MUST exit with code 0 (zero errors).

### Stage 3: Code Hygiene & Style
- **Backend**: Run `ruff check app` from `backend/`. MUST exit with code 0 (all checks passed).

### Stage 4: Automated Regression Tests
- **Unit Battery**: Run `pytest tests/unit/` from `backend/`. All unit tests must pass 100%.
- **Targeted Integration**: Run the relevant integration test suite whenever touching models or SQL queries.

### Stage 5: Invariant & Domain Audits
1. **Money Invariant**: Strictly `Decimal` and `Numeric(12,2)`. Never use `float`. Ensure rounding uses `money()` (`ROUND_HALF_UP`).
2. **Tenant Boundary**: Every database query must explicitly filter by `hotel_id` from `get_tenant_context`. Never trust client-supplied IDs.
3. **API Limit Caps**: Run `python scripts/check_api_limits.py` (0 violations allowed).
4. **i18n Usage & Parity**: Run `python scripts/check_i18n_usage.py` (0 unresolved keys) and confirm `en.json` count == `hi.json` count.
5. **Storage Security**: Validate all object keys adhere to `hotels/{hotel_id}/...`.

### Stage 6: Collateral Flow Verification
Verify:
1. The primary bug reproduction case is resolved.
2. The immediately preceding upstream workflow functions correctly.
3. The immediately following downstream workflow functions correctly.

### Stage 7: Clean Diff Review
1. Inspect `git diff` line-by-line: eliminate scratch code, print logs, or unintentional formatting drift.
2. Update `memory-bank/activeContext.md` with the bug description, root cause, files changed, and verified collateral flows.
