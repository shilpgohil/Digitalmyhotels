# Room Status Redesign — Brainstorm & Plan (2026-09-15)

> STATUS: PLAN ONLY — nothing here is implemented. Client question: "a room
> reserved for a far date shows Reserved NOW, yet it can still be booked;
> occupied rooms are also clickable/bookable — what should room statuses be?"

---

## 1. Live evidence (master server, owner@sg.in, checked 15/09 19:10 IST)

| Fact | Observed |
|---|---|
| Confirmed bookings | BK-0021: Sep 24→29 (9 days out), BK-0020: Sep 16→17 (tomorrow) |
| Room grid today (Sep 15) | 108, 215, 217 show **RESERVED** — all physically empty & sellable tonight |
| Availability API (today→tomorrow) | 108, 215, 217 returned in the **available** list (grid status "reserved") |
| Occupied rooms (107, 1010, 216, 102) | correctly **unavailable** for same-day; **available** for future dates (with "Occupied now / Free at" hints) |

So the client's observation is 100% real: the grid says *Reserved*, the picker
says *bookable*. Both are "correct" under the current model — which is exactly
the problem: **one scalar field is answering two different questions.**

## 2. Root cause — one field, two meanings

`room.status` is a *physical/housekeeping* state machine (available, occupied,
cleaning…, maintenance). But `create_booking` writes a *calendar* fact into it:

```python
# bookings.py — create_booking (also update_booking room swap, add_room)
if booking.status == "confirmed":
    if room.status in (AVAILABLE, CLEAN_READY):
        room.status = RESERVED          # ← even for a check-in 9 days away
```

A reservation is a **date-range fact** (lives in the bookings table). Physical
state is a **now fact** (lives on the room). Storing the former in the latter
produces every symptom the client sees:

### Bugs this causes (all traced in code)

- **B1 — Far-future paint.** Room 108 shows "Reserved" for 9 straight days
  while sellable. Staff can't tell it apart from "guest arriving today".
- **B2 — Walk-in trap (real functional bug).** Picker offers 108 for tonight
  (no date overlap) → staff selects → `create_booking` same-day runs
  `is_allocatable(reserved)` → **False** → 409 "Room is not available
  (status: reserved)". The picker offered a room that booking then rejects.
- **B3 — Status drift on multiple bookings.** Two future bookings on one room:
  first sets RESERVED. First checks in → OCCUPIED → checkout → cleaning →
  AVAILABLE. Second booking's "reserved" paint is now gone. Cancel one of two
  bookings → `_release_rooms` flips RESERVED→AVAILABLE even though the other
  booking still exists. The stored flag cannot stay truthful.
- **B4 — Same-day boundary uses server date.** `create_booking`:
  `is_same_day = body.check_in_date == date.today()` — server is UTC, hotel is
  IST. Between 00:00–05:30 IST a same-day booking classifies as "future" and
  skips the allocatable check. `check_availability` already fixed this with
  hotel-tz `today_local`; booking creation didn't get the same fix.
- **B5 — Misleading counts.** Room Status stat cards count status=reserved as
  "Reserved: 3" implying 3 arrivals now, when 2 of them are Sep-24 arrivals.
- **B6 — UX ambiguity (client's "occupied but bookable").** Occupied rooms ARE
  correctly bookable for future dates, but the picker shows only "Occupied
  now" — nothing says *"this is fine, they leave before your dates"*. Staff
  read it as a bug.

## 3. Options considered

| Option | Idea | Verdict |
|---|---|---|
| A. Derived reservation state (read-time) | Stop writing RESERVED at booking creation. Room list computes per-room booking context (arriving today? next booking date?) from the bookings table. | ✅ **Recommended** — always truthful, no cron, fixes B1/B2/B3/B5 structurally |
| B. Cron flips AVAILABLE→RESERVED on arrival morning | Keep stored status, add scheduled job | ❌ cron drift, tz issues, still drifts on cancel/edit, doesn't fix B2 |
| C. Keep as-is + add hint text | Pure frontend labels | ❌ cosmetic; B2/B3 walk-in trap and drift remain |

## 4. Recommended design (Option A) — "physical status + booking ribbon"

### 4.1 Principle
- `room.status` keeps ONLY physical states: available, occupied, cleaning_*,
  clean_ready, inspection_required, maintenance, out_of_service.
- **RESERVED is never stored.** It becomes a *derived* display state, computed
  from confirmed bookings at read time.

### 4.2 Backend changes
1. **Stop writing RESERVED** in `create_booking`, `update_booking` (room swap),
   `add_room_to_booking`; delete the RESERVED→AVAILABLE release in
   `_release_rooms` / `cancel_booking` (nothing to release any more).
2. **Enrich room list endpoint** (`GET /rooms`) — one batch query (no N+1)
   joining confirmed bookings per room:
   - `arriving_today: bool` (+ `arrival_time`) — confirmed booking with
     check_in_date == hotel-local today
   - `next_booking: { check_in_date, check_in_time, booking_number } | null`
     — earliest future confirmed booking
   - `departing_today / current_checkout` already exists for occupied rooms.
3. **Derived display status** ("effective status") for the grid:
   - physical available/clean_ready + arriving_today → **"Reserved (today)"**
   - physical available/clean_ready + future booking → **"Available"** with
     ribbon *"Reserved from Sep 24"*
   - all other physical states render as they are today.
4. **Same-day allocatable check** in `create_booking`:
   - use hotel-tz `today_local` (fix B4);
   - after RESERVED stops existing, `is_allocatable` (available/clean_ready)
     becomes consistent with the picker again → B2 gone. Double-booking safety
     is already fully carried by `_assert_no_overlap` (date-range, DB-level).
5. **Check-in transition**: RESERVED→OCCUPIED path in the state machine stays
   (harmless) but AVAILABLE→OCCUPIED already exists; migration below removes
   stored 'reserved' rows.
6. **Data migration** (Alembic): `UPDATE rooms SET status='available' WHERE
   status='reserved'` — truthful because every reservation is re-derived from
   bookings. Zero-risk: overlap checks, not status, guard double booking.
7. **State machine**: keep RESERVED in the enum for backward compat during
   rollout, mark deprecated; nothing writes it after this change.

### 4.3 Frontend changes
1. **Room Status grid**: two-layer chip — physical badge (unchanged colors) +
   small gold ribbon when `next_booking` exists: *"Reserved · arrives Sep 24"*
   or *"Arriving today 14:00"*. Occupied rooms with a departure today get
   *"Departs today 11:00"* (data already available).
2. **Stat cards**: "Reserved" card counts `arriving_today` rooms only (that's
   what a desk manager means by reserved-now). Optional second line "+2
   upcoming" for future reservations.
3. **Availability picker**: replace the bare "Reserved" hint with contextual
   text: *"Booked Sep 24–29 — free for your dates"* (uses `next_booking`), and
   for occupied rooms keep "Occupied now · Free Sep 16 11:00" (exists). This
   answers B6 — staff see WHY a busy-looking room is offered.
4. **Manual status menu**: unchanged (occupied/reserved were already blocked
   from manual setting; reserved simply disappears from the menu).

### 4.4 What deliberately does NOT change
- `_assert_no_overlap` remains the single true double-booking guard (DB-level,
  date-range). It never depended on room.status.
- Same-day physical blocking in `check_availability` (occupied /
  cleaning-in-progress rules from plan §5.2) is untouched.
- Housekeeping flows: RESERVED was already in `_TASK_STALE_ROOM_STATUSES`;
  after migration no room holds it, no behavior change.

## 5. Scenario walk-through under the new model

| # | Scenario | Today (broken) | After redesign |
|---|---|---|---|
| S1 | Booking Sep 24–29 made on Sep 15 | Room shows Reserved 9 days | Available + ribbon "Reserved from Sep 24"; sellable ≤ Sep 23 |
| S2 | Walk-in tonight wants that room | Picker offers, booking 409s (B2) | Picker offers with "free for your dates" hint; booking succeeds |
| S3 | Guest arriving today | Same "Reserved" as S1 — indistinguishable | "Reserved (today) · arrives 14:00" distinct chip |
| S4 | 2 future bookings, one cancelled | Room flips to Available, other booking invisible (B3) | Ribbon re-derives; always truthful |
| S5 | Occupied room, guest leaves before requested dates | "Occupied now" hint only — looks like a bug (B6) | "Occupied now · departs Sep 16 — free for your dates" |
| S6 | Booking at 00:30 IST for "today" | Server-date bug skips allocatable check (B4) | hotel-tz today_local everywhere |
| S7 | Advance booking checked in early/late | RESERVED paint may already be stale | Physical status only; arrival ribbon from booking dates |
| S8 | Room under maintenance with future booking | Reserved paint could overwrite/conflict | Maintenance chip + ribbon warn staff of upcoming arrival conflict |

## 6. Open questions for the client (before implementation)
1. Should the "Reserved" stat card count only today's arrivals (recommended) or
   all future reservations?
2. ~~How many days ahead should the "Reserved from …" ribbon look?~~
   **DECIDED (user, 15/09):** ribbon always shows the next confirmed booking,
   however far out.

### 6.1 Filter semantics (DECIDED 15/09)
A physically-free room with a future booking sorts under the **Available**
filter (it IS sellable now) with its "Reserved from …" ribbon visible on the
card. The **Reserved** filter narrows to rooms whose guest arrives TODAY.
Rules:
- Single-membership only — stat-card counts must keep summing to the room
  total (client already once reported "Room Status wrong count").
- Optional follow-up: the Reserved filter view may render two sections —
  "Arriving today" + "Upcoming reservations" — without changing the counts.
- Availability picker's "Reserved" chip: matches rooms with ANY upcoming
  booking (picker is a date-planning context, unlike the live grid).
3. Same-day walk-in onto a room whose guest arrives TODAY later in the evening
   (day-use gap): allow with warning, or block? (Currently blocked by overlap;
   recommend keep blocked.)

## 7. Effort & risk
- Backend: ~1 day (booking writes removal + enriched rooms query + migration +
  tests). Risk LOW — overlap guard already carries correctness.
- Frontend: ~1 day (grid ribbon, stat card, picker hints, i18n en+hi).
- Tests: unit (derived status), integration (S1–S6), update
  `test_room_status.py` expectations for deprecated RESERVED writes.
