# Staff Attendance — FULL Implementation Spec (build-ready)

Supersedes/extends `staffAttendancePlan.md`. Written 12/09/2026. STATUS: SPEC —
implementation not started. Follow this file top-to-bottom when building.

Client deltas incorporated:
- Hotel admin decides the geofence **radius** AND has a **toggle** to turn
  geofencing **on/off** per hotel.
- Managers and admins ALSO self check-in/out — the widget lives in **their own
  profile** area too (attendance is for every membership role, not only
  general staff).

---

## 0. Theme & UX contract (MUST match existing platform)

Every new screen follows the established design system — no new patterns:

| Rule | Value (existing convention) |
|---|---|
| Sidebar | items join the fixed 256px navy sidebar (`sidebar-navy`), gold-pill active, `hover:bg-white/[0.06]`; new group label "STAFF" |
| Page shell | `PartnerHeader title subtitle={tn("staff")}` + `<main className="flex-1 overflow-y-auto p-4 sm:p-6">` |
| Stat cards | `StatCard` / `StatCardGrid` with tones navy/gold/info/success/danger/warning; values `text-lg sm:text-xl` |
| Tables | `DataTable darkHeader` + `TableRow/TableCell`, `PaginationFooter` + `paginate()` |
| Filters | `FilterBar` (42px controls) + `SegmentedChips` (bordered pill group, navy active pill) — NEVER rounded-full standalone chips |
| Quick periods | shared `PERIODS`/`periodRange` from `segmented-chips.tsx` |
| Inputs | 42px height, white bg, 6px radius (`h-[42px] rounded-md border-input bg-white`); native selects styled the same |
| Buttons | primary navy `bg-navy-900 hover:bg-navy-800`, accent gold `bg-gold-500 text-navy-900 hover:bg-gold-400`, 42px for page-level actions, h-8 inside dialog footers |
| Dialogs | `Dialog`/`DialogContent` (spring `dialog-in` animation), `ConfirmDialog` for destructive |
| Status chips | `StatusBadge` tones: PRESENT=success, LATE=warning, ABSENT=danger, WORKING=info, CHECKED OUT=neutral, ON LEAVE=info |
| Empty/error | `EmptyState` icon+title+subtitle; error text `text-danger` + retry |
| Toasts | sonner `toast.success/error`, i18n messages |
| i18n | EVERY string in `en.json` + `hi.json`, new namespace `staff` (+ `nav.staff*` keys) |
| Permissions | `RequirePermission` page guards + `can()` for buttons; backend dependency checks mirror them |
| Transitions | inherit global 180ms baseline; no custom animation systems |
| Mobile | self-service page mobile-first; stat grids `grid-cols-2 sm:…`; tables use `table-scroll` |
| Typography | `text-micro/label/caption` tokens only, no arbitrary text-[Xpx] |
| Photos | uploads go through `useImageEditor` (free crop) + compress pipeline; selfies via `inline-camera-capture` |

---

## 1. Database (Alembic migration `xxxx_staff_attendance.py`)

### 1a. `hotels` — geofence settings (ALTER)
```
geofence_enabled     BOOLEAN NOT NULL DEFAULT FALSE   -- admin toggle (OFF by default)
latitude             NUMERIC(9,6) NULL
longitude            NUMERIC(9,6) NULL
geofence_radius_m    INTEGER NOT NULL DEFAULT 200     -- admin-configurable 50–2000
```
Rule: toggle can only be switched ON when lat+lng are set (422 otherwise).

### 1b. `staff_profiles`
```
id UUID PK · hotel_id FK ix · user_id FK->users
staff_code VARCHAR(32)            -- STF-001, auto-sequence per hotel, unique(hotel_id, staff_code)
department VARCHAR(32)            -- reception|housekeeping|fnb|maintenance|management|other
designation VARCHAR(120) NULL
employment_type VARCHAR(16) NOT NULL DEFAULT 'full_time'   -- full_time|part_time|contract
joining_date DATE NOT NULL
date_of_birth DATE NULL · gender VARCHAR(16) NULL
base_salary NUMERIC(12,2) NULL    -- permission-gated read
shift_start TIME NULL · shift_end TIME NULL
weekly_off SMALLINT NULL          -- 0=Sun … 6=Sat, NULL = none
photo_object_key VARCHAR(512) NULL
status VARCHAR(16) NOT NULL DEFAULT 'active'    -- active|on_leave|inactive
timestamps · UNIQUE(hotel_id, user_id)
```
NOTE: owners/managers/admins get a staff_profile row too (auto-created lazily
on first self check-in with department='management') so THEIR attendance works.

### 1c. `attendance_records`
```
id UUID PK · hotel_id FK ix · staff_profile_id FK ix
work_date DATE NOT NULL           -- hotel-timezone date of the check-in
check_in_at / check_out_at TIMESTAMPTZ NULL
check_in_lat/lng NUMERIC(9,6) NULL · check_out_lat/lng NUMERIC(9,6) NULL
check_in_accuracy_m / check_out_accuracy_m NUMERIC(8,1) NULL
check_in_distance_m / check_out_distance_m NUMERIC(8,1) NULL
check_in_selfie_key VARCHAR(512) NULL
method_in / method_out VARCHAR(16) NULL   -- self_geo|front_desk|manual
performed_by_id FK->users NULL            -- operator for front_desk/manual
status VARCHAR(16) NOT NULL DEFAULT 'present'  -- present|late|absent|leave|off|holiday
late_minutes INT NULL · early_out_minutes INT NULL
note TEXT NULL · timestamps
UNIQUE(hotel_id, staff_profile_id, work_date)
CHECK (check_out_at IS NULL OR check_in_at IS NOT NULL)
```

### 1d. Roles & permissions seed
- New rows in `roles`: `receptionist` ("Receptionist / Front Desk"),
  `general_staff` ("General Staff").
- Permission codes (backend registry + `frontend/src/lib/permissions.ts`):
```
staff.view                staffView
staff.manage              staffManage
staff.salary_view         staffSalaryView
staff.attendance_self     staffAttendanceSelf
staff.attendance_view     staffAttendanceView
staff.attendance_record   staffAttendanceRecord
staff.attendance_correct  staffAttendanceCorrect
```
Matrix (seed):
| permission | owner | manager | admin | receptionist | housekeeping | general_staff |
|---|---|---|---|---|---|---|
| staff.view | ✓ | ✓ | ✓ | ✓ | – | – |
| staff.manage | ✓ | ✓ | – | – | – | – |
| staff.salary_view | ✓ | – | – | – | – | – |
| staff.attendance_self | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| staff.attendance_view | ✓ | ✓ | ✓ | ✓ | – | – |
| staff.attendance_record | ✓ | ✓ | – | ✓ | – | – |
| staff.attendance_correct | ✓ | ✓ | – | – | – | – |

Receptionist/general_staff also inherit the minimal existing permissions they
need (receptionist: bookings/checkin/checkout/guest view set — copy from
current front-desk-ish grants; general_staff: notifications.view only).

---

## 2. Backend

### 2a. New files
```
app/models/staff.py            StaffProfile, AttendanceRecord
app/schemas/staff.py           all Pydantic models below
app/services/staff.py          profiles CRUD + staff_code sequence + photo
app/services/attendance.py     check-in/out, geofence, derivations, reports
app/api/v1/staff.py            router (mounted at /api/v1/staff)
app/domain/geo.py              haversine_m(lat1,lng1,lat2,lng2) -> float
```

### 2b. Geofence rule (services/attendance.py) — single source of truth
```python
def enforce_geofence(hotel, lat, lng, accuracy_m) -> float | None:
    """Returns distance_m, or None when geofencing is disabled.
    Raises ValidationAppError(code="geofence_violation", distance=…) outside."""
    if not hotel.geofence_enabled:            # admin toggle OFF → skip
        return None
    if hotel.latitude is None or hotel.longitude is None:
        return None                            # unconfigured → treated as off
    if lat is None or lng is None:
        raise ValidationAppError("Location required", code="location_required")
    d = haversine_m(lat, lng, hotel.latitude, hotel.longitude)
    grace = min(float(accuracy_m or 0), 100.0)  # cap: vague fixes can't cheat
    if d > hotel.geofence_radius_m + grace:
        raise ValidationAppError(
            f"You are ~{int(d)} m from the property",
            code="geofence_violation")
    return d
```
- Self check-in/out: geofence ALWAYS evaluated (when enabled).
- Front-desk record: geofence NOT evaluated (operator identity + audit is the
  control); method=front_desk, performed_by stored.
- Manual correction: `staff.attendance_correct` + mandatory reason (note).

### 2c. Status derivation
```
late      = shift_start set AND check_in_local > shift_start + 10 min grace
late_minutes = diff
early_out = shift_end set AND check_out_local < shift_end
absent    = nightly sweep (reminders_loop): active staff, not weekly_off,
            no record by hotel-midnight → insert status='absent'
auto-close= records w/ check_in and no check_out by 4h after shift_end
            (or 23:59 when no shift_end) → set check_out=shift_end,
            note='auto-closed', flagged in anomalies
work_date = check-in instant converted to hotel.timezone date
```

### 2d. Endpoints (all tenant-scoped, audited where noted)
```
POST   /staff                          staff.manage   create user+membership+profile (audit staff.created)
GET    /staff?dept&role&status&q&joined_from&joined_to&limit&offset   staff.view
GET    /staff/{id}                     staff.view     (+salary iff staff.salary_view)
PATCH  /staff/{id}                     staff.manage   (audit staff.updated)
POST   /staff/{id}/photo               staff.manage   multipart, compress pipeline
GET    /staff/attendance/today?date&dept&status      staff.attendance_view
POST   /staff/attendance/check-in      staff.attendance_self   {lat?,lng?,accuracy_m?,selfie_key?}
POST   /staff/attendance/check-out     staff.attendance_self   {lat?,lng?,accuracy_m?}
POST   /staff/attendance/{staff_id}/record   staff.attendance_record  {action:"in"|"out"}  (audit)
PATCH  /staff/attendance/{record_id}   staff.attendance_correct {check_in_at?,check_out_at?,status?,note!} (audit)
GET    /staff/attendance/history?from&to&dept&shift&status&q&format=csv?   staff.attendance_view
GET    /staff/attendance/calendar?staff_id&month=YYYY-MM   staff.attendance_view OR self
GET    /staff/attendance/anomalies?from&to&dept     staff.attendance_view
GET    /staff/me                       staff.attendance_self   own profile + today record
GET    /staff/me/attendance?month      staff.attendance_self   own history/calendar
```
Self check-in creates the lazy staff_profile for manager/admin/owner if none
exists (department='management', joining_date=today).

Hotel settings: extend existing `PATCH /api/v1/hotels/me` +
`HotelUpdate`/`HotelOut` with `geofence_enabled`, `latitude`, `longitude`,
`geofence_radius_m` (validators: radius 50–2000; enable requires lat+lng).

### 2e. Schemas (schemas/staff.py) — key ones
```
StaffCreate  { full_name, phone, email?, dob?, gender?, department,
               designation?, employment_type, joining_date, shift_start?,
               shift_end?, weekly_off?, base_salary?, access_role:
               "manager"|"receptionist"|"general_staff", temp_password }
StaffOut     { id, staff_code, user_id, full_name, phone, email, department,
               designation, employment_type, joining_date, status,
               photo_url?, role_code, today_status?, base_salary? (gated) }
CheckInIn    { lat?, lng?, accuracy_m?, selfie_key? }
AttendanceRecordOut { …all fields, distances, method, performed_by_name }
TodayAttendanceOut  { stats: {total,present,working,checked_out,absent,late},
                      items: AttendanceRow[] }
AnomaliesOut { late_count, early_count, missing_count, avg_late_min, items[] }
```

### 2f. Tests (backend/tests/integration/test_staff_attendance.py)
- create staff → login works with temp password + must_reset
- self check-in inside fence OK / outside 403 geofence_violation w/ distance
- toggle OFF → check-in without coords OK
- accuracy grace capped (accuracy 5000 m does not bypass)
- double check-in 409 · checkout before checkin 422
- front-desk record by receptionist OK, by general_staff 403
- salary hidden without staff.salary_view
- correction requires note; audit rows written
- role boundaries: general_staff cannot GET /staff list

---

## 3. Frontend

### 3a. Navigation (partner-sidebar.tsx + mobile)
New group after FRONT DESK, label `nav.staffGroup` ("Staff"):
```
/staff                    nav.staffList        Users icon         staff.view
/staff/attendance         nav.todaysAttendance CalendarCheck      staff.attendance_view
/staff/checkin            nav.staffCheckin     LogIn              staff.attendance_record
/staff/attendance/history nav.attendanceHistory History           staff.attendance_view
/staff/attendance/reports nav.lateEarly        Clock              staff.attendance_view
/my-attendance            nav.myAttendance     UserCheck          staff.attendance_self
```
general_staff sees ONLY `/my-attendance` (+notifications); their post-login
redirect goes to `/my-attendance` (layout: if !can(dashboard) → my-attendance).

### 3b. Pages (all under `(partner)`, each wrapped in RequirePermission)

**/staff — Staff List** (mockup "Staff List")
- Header action: gold `+ Add Staff` 42px (staff.manage) + outline Export.
- FilterBar: search q, selects Department/Role/Status, DatePicker joining.
- SegmentedChips for status (All/Active/On Leave/Inactive).
- DataTable darkHeader: STAFF ID · NAME(avatar initials circle `bg-navy-900
  text-white`) · ROLE · DEPARTMENT · MOBILE · STATUS(StatusBadge) · TODAY
  (attendance chip) · ⋮ (View Profile / Edit / Deactivate via dropdown
  `min-w-48 whitespace-nowrap`).

**/staff/new + /staff/[id]/edit — Add/Edit Staff** (mockup "Add New Staff")
3 `SectionPanel`s, 42px controls, grid `gap-3 sm:grid-cols-2 lg:grid-cols-3`:
1. Personal — photo upload (useImageEditor, square aspect), full name*,
   email, mobile*, DOB (DatePicker), gender select.
2. Employment — staff code (auto, read-only), joining date*, status,
   department* select, designation select/free, employment type,
   shift start/end (TimeInput), weekly off select, base salary
   (visible iff staffSalaryView).
3. Login & Access — temp password (PasswordInput + generate button),
   radio cards for access role (Manager / Receptionist / General Staff) —
   radio card = bordered rounded-md p-3, selected `border-navy-900 bg-muted/40`.
Footer: Cancel outline + gold Save Staff (42px).

**/staff/[id] — Staff Profile** (mockup "Staff Profile")
- Hero card: photo, name + ACTIVE badge, staff code · designation,
  actions Edit Staff (outline) / Attendance (navy).
- Grid: Profile Summary SectionPanel (2/3) + This Month StatCard×4
  (Present=success, Absent=danger, Late=warning, Avg Hours=navy).
- Recent Attendance DataTable (last 7) + "View Full History →" gold link.
- **Self-attendance widget on top when viewing OWN profile** (manager/admin):
  same CheckInCard component as /my-attendance (client requirement).

**/staff/attendance — Today's Attendance** (mockups "Staff Dashboard"+"Today's")
- StatCardGrid cols=6: Total(navy)/Present(success)/Working(info)/
  Checked Out(neutral→navy2)/Absent(danger)/Late(warning).
- Prev/Today/Next day pager (outline 42px buttons + DatePicker).
- SegmentedChips: All/Present/Working/Checked Out/Absent/Late.
- DataTable: STAFF(avatar+id) · DEPARTMENT · CHECK-IN · CHECK-OUT ·
  WORKING HRS (live ticking for working) · LATE BY (warning text) ·
  STATUS · ⋮ (View Details / Record Check-out / Contact).
- Export CSV button.

**/staff/checkin — Front-desk utility** (mockup "Check-out Utility")
- Big centered search (42px, autofocus) by name/ID/mobile.
- Result cards (max-w-sm each, `rounded-lg border bg-card shadow-sm`):
  avatar, name, dept · staff code, status pill; state A "Not Checked In" →
  navy CHECK IN 42px; state B "Currently Working" (checkin time + live
  duration) → outline CHECK OUT 42px. Confirm via ConfirmDialog. Toasts.

**/staff/attendance/history** — FilterBar(range/dept/shift/status/q) +
DataTable with working-hours mini bar (`h-1.5 rounded bg-navy-900` fill vs
`bg-muted` track) + Export CSV + PaginationFooter.

**/staff/attendance/calendar** — staff picker (search select) + month grid
(7-col CSS grid, cells `rounded-md border p-1.5 text-label`):
present=`bg-success-bg`, late=`bg-warning-bg`, absent=`bg-danger-bg`,
leave=`bg-info-bg`, off/holiday=`bg-muted`; legend chips; bottom
StatCardGrid×4 (Present/Late/Absent/Leave). Also self-view for staff.

**/staff/attendance/reports — Late & Early** — StatCard×4 (Late Arrivals=
warning, Early Check-outs=info, Missing Check-outs=danger, Avg Late=navy) +
FilterBar range/dept + checkbox chips (SegmentedChips multi behaviour via two
toggles) + DataTable with LATE BY / EARLY BY in `text-warning font-semibold`,
MISSING OUT `StatusBadge tone=danger`.

**/my-attendance — Self-Service (mobile-first)** (mockup mobile screen)
- `max-w-md mx-auto` column: greeting (`text-xl font-semibold`, Source Serif),
  date line, live clock `text-4xl font-bold tabular-nums`.
- Status pill (Not Checked In=danger-bg / Working=success-bg / Done=muted).
- Big round action button (size-48 rounded-full bg-navy-900 text-white,
  gold ring on hover, disabled while locating): label "Face Check-In" →
  flow: 1) `getCurrentPosition({enableHighAccuracy:true, timeout:10s})`
  2) inline-camera-capture selfie (front camera) 3) upload selfie →
  4) POST check-in {lat,lng,accuracy,selfie_key}.
  - geolocation denied → danger callout `staff.locationRequired` with retry
    (ONLY if hotel geofence_enabled; else skip location silently).
  - geofence_violation → danger callout with distance + "move closer" hint.
- After check-in: button becomes outline "Check Out" (same geo flow, no selfie).
- Today summary card: Check-in / Check-out / Total hrs (ticks live).
- This-month mini calendar (same cells as calendar page).

### 3c. Edit Hotel — Property Location & Geofence (SectionPanel)
In `/edit-hotel`:
- Toggle row (Checkbox/Switch): `staff.geofenceToggle` "Restrict staff
  check-in to hotel premises" + helper caption.
- Latitude / Longitude inputs (42px, numeric) + outline 42px button
  `staff.useMyLocation` "Use my current location" (fills via geolocation,
  shows accuracy hint) — disabled state while locating w/ InlineSpinner.
- Radius input (42px, number 50–2000, suffix "m", default 200).
- Validation: enabling toggle without lat/lng → inline `text-danger` message,
  Save blocked (mirrors backend 422).
- Map preview: OUT of scope MVP (no map dependency in project).

### 3d. New frontend files
```
src/types/staff.ts                      all Out/In types
src/app/(partner)/staff/page.tsx
src/app/(partner)/staff/new/page.tsx
src/app/(partner)/staff/[id]/page.tsx           (profile; ?edit=1 opens edit)
src/app/(partner)/staff/attendance/page.tsx
src/app/(partner)/staff/attendance/history/page.tsx
src/app/(partner)/staff/attendance/calendar/page.tsx
src/app/(partner)/staff/attendance/reports/page.tsx
src/app/(partner)/staff/checkin/page.tsx
src/app/(partner)/my-attendance/page.tsx
src/components/staff/check-in-card.tsx          (shared: my-attendance + own profile)
src/components/staff/staff-form.tsx             (add/edit sections)
src/components/staff/attendance-status-badge.tsx
src/components/staff/month-calendar.tsx
src/lib/geo.ts                                   getPosition() promise wrapper
```

### 3e. i18n — namespace `staff` (en + hi, FULL parity)
~90 keys. Groups: nav (6), list/table headers (12), form labels (24),
access-role cards (6), attendance stats (8), status chips (7), self-service
(12: greeting/faceCheckin/checkOut/locationRequired/geofenceViolation
w/ {distance}/checkedInToast/checkedOutToast/todaySummary/totalHrs…),
front-desk utility (6), history/calendar/reports (12), geofence settings (6),
errors (5). Hindi translated properly (not transliterated).

---

## 4. Cross-cutting rules

- **Tenant isolation**: every query filters hotel_id via TenantContext;
  staff photos/selfies stored under `hotels/{hotel_id}/staff/…` object keys
  (same storage service as guest docs).
- **Audit**: staff.created/updated/deactivated, attendance.recorded
  (front-desk), attendance.corrected — before/after payloads, actor id.
- **Salary privacy**: serializer strips base_salary unless staff.salary_view;
  UI shows "Confidential" placeholder (mockup) when absent.
- **Timezones**: all "today"/late math in hotel.timezone (ZoneInfo, fallback
  Asia/Kolkata) — same pattern as expenses summary.
- **Live durations**: frontend ticks with a 30s interval; server remains the
  source of truth on write.
- **No PWA/native work** in this scope; the self-service page is responsive
  web. Mock-location spoofing limitation documented to client.
- **Reduced motion**: no new animation beyond global tokens.

## 5. Build order (commits)

1. `feat(db): staff_profiles + attendance_records + hotel geofence columns`
   — models, migration, seeds (roles+permissions). Ruff + alembic upgrade.
2. `feat(api): staff CRUD + photo upload + permissions` + tests.
3. `feat(api): attendance check-in/out with geofence + front-desk + corrections`
   + geo domain + tests (the geofence unit tests especially).
4. `feat(api): today/history/calendar/anomalies + CSV + nightly sweep`.
5. `feat(ui): sidebar group + staff list + add/edit form + profile`.
6. `feat(ui): my-attendance self-service + check-in card on own profile`.
7. `feat(ui): today's attendance + front-desk utility`.
8. `feat(ui): history + calendar + late/early reports`.
9. `feat(ui): edit-hotel geofence settings (toggle + radius + use-my-location)`.
10. `chore: i18n hi parity + tsc + next build + pytest + memory-bank update`.

Each commit: tsc + next build green; backend ruff + pytest green; pushed.

## 6. Acceptance checklist (verify before telling the client "done")

- [ ] Owner sets location via "Use my current location", radius 200, toggle ON.
- [ ] general_staff logs in w/ temp password → forced reset → lands on
      /my-attendance → Face Check-In inside fence succeeds w/ selfie.
- [ ] Same check-in 500 m away → blocked with distance message.
- [ ] Toggle OFF → check-in works without location prompt.
- [ ] Manager sees own CheckInCard on their profile and can self check-in.
- [ ] Receptionist records another staff's in/out at front desk; audit row.
- [ ] Late staff shows LATE + minutes on Today's Attendance + reports.
- [ ] Nightly sweep marks absentees; missing checkout auto-closes + flagged.
- [ ] Salary hidden for manager, visible for owner.
- [ ] Hindi locale renders every staff screen fully translated.
- [ ] Mobile 375px: self-service and staff list usable, no overflow.
