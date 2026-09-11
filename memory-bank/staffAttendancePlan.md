# Staff Check-in / Check-out (Attendance) — Implementation Plan

Source: `main documents/client documentations/staff checkin flow/` (10 mockups,
"Grand Horizon Executive Portal" style). Planned 12/09/2026. STATUS: PLAN ONLY —
not yet implemented.

## 1. What the client's mockups show

| Mockup | Content |
|---|---|
| Staff Dashboard | Attendance overview: Total Staff / Present / Working / Checked Out / Absent / Late stat cards + today's summary table (check-in, check-out, working hours, status chips, View Details) |
| Staff List | Directory: Staff ID, name+avatar, role, department, mobile, status (Active/On Leave), today's attendance chip, ⋮ actions; filters (department/role/status/joining date); Export; + Add Staff |
| Add New Staff | 3 sections: Personal Info (photo, name, email, mobile, DOB, gender) · Employment Info (staff id, joining date, status, department, designation, employment type, shift start, base salary) · Login Credentials & Access (phone, temp password, System Access Role radio: Hotel Manager / Receptionist–Front Desk / General Staff) |
| Today's Attendance | Date-paged view (Prev/Today/Next) with stat cards + filter sidebar (department, status checkboxes) + table with LATE BY column |
| Staff Check-in/out (Check-out Utility) | Front-desk kiosk-style utility: search staff by name/ID/mobile → status card (Not Checked In → CHECK IN button / Currently Working with duration → CHECK OUT button) |
| Staff Self-Service (Mobile) | Staff's own phone: greeting, live clock, status pill, big **Face Check-In** button (selfie capture), today's summary (in/out/total hrs) |
| Attendance History | Date-range + department + shift + status filters, per-day rows with working-hours bar, Export |
| Attendance Calendar | Per-staff month calendar: Present/Absent/Late/Leave/Holiday/Scheduled-off cells + month totals |
| Late & Early Report | Late arrivals / early check-outs / missing check-outs stats + anomaly table (LATE BY, EARLY BY, MISSING OUT chips) |
| Staff Profile | Profile summary (joining date, dept, designation, mobile, email, salary "Confidential") + This Month stats + Recent Attendance + Edit Staff / Attendance buttons |

## 2. Core requirement from the user (beyond mockups)

**Geofencing:** staff check-in/checkout must only be possible within a
configurable radius around the hotel property. Staff (non-managers, workers)
get their own logins for self-service check-in.

## 3. How it fits the existing platform

Already in place and reused:
- `User` + `Role` + `HotelMembership` (roles incl. owner/manager/admin/housekeeping),
  JWT auth with refresh, `must_reset_password` (temp-password flow exists),
  Team page creates members with email+password+role.
- Permission system (`PERMISSIONS`, `can()`, backend dependency checks).
- Audit log service, shift-handover page, partner sidebar groups, i18n en/hi,
  StatCard/DataTable/FilterBar/SegmentedChips UI kit, image editor + upload
  pipeline (for profile photos & check-in selfies).

Missing (to build):
- Hotel latitude/longitude + geofence radius (hotel has only text address).
- Staff profile data (department, designation, staff id, salary, shift start,
  employment type, DOB, gender, photo) — not on `User`.
- Attendance domain entirely (records, status derivation, reports).
- Two new roles: `receptionist`, `general_staff` (mockup access tiers).

## 4. Data model (new tables, all tenant-scoped by hotel_id)

```
staff_profiles
  id PK, hotel_id FK, user_id FK->users (unique per hotel)
  staff_code (e.g. STF-001, unique per hotel), department (str enum:
  reception/housekeeping/fnb/maintenance/management/other), designation,
  employment_type (full_time/part_time/contract), joining_date,
  date_of_birth, gender, base_salary NUMERIC NULL (permission-gated),
  shift_start TIME NULL, shift_end TIME NULL, weekly_off SMALLINT NULL,
  photo_object_key, status (active/on_leave/inactive), created/updated

attendance_records
  id PK, hotel_id FK, staff_profile_id FK, work_date DATE
  check_in_at TIMESTAMPTZ NULL, check_out_at TIMESTAMPTZ NULL
  check_in_lat/lng NUMERIC NULL, check_out_lat/lng NUMERIC NULL
  check_in_distance_m / check_out_distance_m NUMERIC NULL
  check_in_selfie_key TEXT NULL  (Face Check-In evidence photo)
  method_in / method_out (self_geo | front_desk | manager_manual)
  performed_by_id FK->users NULL  (who recorded, for front-desk/manual)
  status (derived + stored: present/late/absent/leave/holiday/off)
  late_minutes INT NULL, early_out_minutes INT NULL
  note TEXT NULL, UNIQUE(hotel_id, staff_profile_id, work_date)

staff_leaves (phase 2)
  id, hotel_id, staff_profile_id, from_date, to_date, type
  (annual/sick/unpaid), status (pending/approved/rejected), reason,
  decided_by_id

hotels (ALTER)
  latitude NUMERIC(9,6) NULL, longitude NUMERIC(9,6) NULL,
  geofence_radius_m INT NOT NULL DEFAULT 200
```

Status derivation rules:
- late = check_in_at > (work_date + shift_start + grace); grace default 10 min,
  hotel-configurable later.
- early_out = check_out_at < shift_end.
- absent = scheduled day, no check-in by end of day (nightly sweep marks it).
- missing check-out = check_in but no check_out by (shift_end + N hrs) →
  flagged in Late & Early report; nightly sweep auto-closes at shift_end with
  `note="auto-closed"` (mirrors the existing auto-noshow sweep pattern).

## 5. Geofence design (the critical piece)

Setup:
- Edit Hotel / Settings gains a "Property Location" block: map-free MVP =
  lat/lng inputs + "Use my current location" button (browser geolocation
  fills the fields while the owner stands at the property) + radius (m)
  input (default 200 m, min 50, max 2000).

Enforcement (server-side, never trust the client's verdict):
1. Client (mobile self-service) requests `navigator.geolocation.getCurrentPosition`
   with `enableHighAccuracy: true`.
2. POST `/staff-attendance/check-in` body: `{lat, lng, accuracy_m, selfie?}`.
3. Server computes Haversine distance to hotel lat/lng.
   Allowed iff `distance <= radius + min(accuracy_m, 100)` (accuracy grace
   capped so a 5 km-accuracy IP fix can't bypass the fence).
   Reject with 403 `geofence_violation` incl. computed distance (shown to
   staff: "You are ~450 m from the property").
4. Store lat/lng/distance/accuracy on the record for audit.
5. GPS denied/unavailable → client shows "location required" screen; no
   check-in without coordinates on the self-service path.
6. Escape hatches (all audited):
   - Front-desk utility (mockup "Staff Check-in/out"): a user with
     `staff.attendance_record` permission (manager/receptionist) checks staff
     in from the hotel terminal — method=front_desk, geofence check runs
     against the OPERATOR's coordinates if available, else allowed (the
     operator is physically at the desk; their identity is the control).
   - Manager manual correction (edit a record) — method=manager_manual,
     requires `staff.attendance_correct`, reason mandatory, audited.

Anti-spoofing stance (documented honestly): browser geolocation can be faked
by dev tools/mock apps. Mitigations in scope: server-side distance check,
selfie capture at check-in, audit trail, manager visibility of distance and
anomaly report. True mock-location detection needs a native app — OUT of
scope; noted for the client.

## 6. Roles & permissions

New system roles (seed + migration): `receptionist`, `general_staff`.

New permission codes:
- `staff.view`         — see staff list/profiles (no salary)
- `staff.manage`       — add/edit staff, credentials (owner/manager)
- `staff.salary_view`  — see base salary (owner only by default)
- `staff.attendance_view`    — dashboards/history/reports
- `staff.attendance_self`    — own self-service check-in/out (ALL staff roles)
- `staff.attendance_record`  — front-desk utility for others (owner/manager/receptionist)
- `staff.attendance_correct` — edit/manual records (owner/manager)

Access tiers per the Add-Staff mockup radio:
- Hotel Manager → existing `manager` role (full staff module)
- Receptionist / Front Desk → `receptionist` (guest check-in/bookings pages
  + front-desk attendance utility + own self-service)
- General Staff → `general_staff` (ONLY: own self-service page, own calendar/
  history, notifications). Partner sidebar for this role collapses to a
  minimal set; route guards via existing `RequirePermission`.

Login: staff are normal `users` with memberships (temp password +
`must_reset_password=true` — flow already exists). Email optional in mockup →
generate `staff-<phone>@<hotel-slug>.dmh.local` when email absent, login by
phone lookup later (phase 2); MVP requires email OR phone-derived email.

## 7. Backend API surface (new router `/api/v1/staff`)

```
POST   /staff                     create staff (profile + user + membership)
GET    /staff?filters             list (dept/role/status/search/joining)
GET    /staff/{id}                profile (+this-month stats)
PATCH  /staff/{id}                edit profile / status
POST   /staff/{id}/photo         profile photo upload
GET    /staff/attendance/today    stat cards + rows (date param, filters)
POST   /staff/attendance/check-in    self, geofenced {lat,lng,accuracy,selfie?}
POST   /staff/attendance/check-out   self, geofenced
POST   /staff/attendance/{staff_id}/record   front-desk in/out
PATCH  /staff/attendance/{record_id}         manager correction (reason req.)
GET    /staff/attendance/history?range&filters   (+CSV export)
GET    /staff/attendance/calendar?staff_id&month
GET    /staff/attendance/anomalies?range     late/early/missing report
GET    /staff/me/attendance/today            self-service state
PATCH  /hotels/me  (extend)       latitude/longitude/geofence_radius_m
```
All under tenant context; audit entries for create/edit/record/correct.

## 8. Frontend pages

New sidebar group **Staff** (visible per permission):
- `/staff` — Staff List (DataTable + FilterBar + SegmentedChips status)
- `/staff/new` + `/staff/[id]` — Add/Profile (3-section form per mockup;
  42px controls; photo via existing image editor free-crop)
- `/staff/attendance` — Today's Attendance (stat cards + filters + table)
- `/staff/attendance/history` — history + export
- `/staff/attendance/calendar` — per-staff month calendar
- `/staff/attendance/reports` — Late & Early
- `/staff/checkin` — front-desk utility (search → status card → big button)
- `/my-attendance` — mobile-first self-service (clock, status pill, big
  check-in button w/ geolocation + selfie capture via existing
  inline-camera-capture, today summary). This is the ONLY page
  general_staff lands on after login.

"Face Check-In" MVP = mandatory selfie capture stored as evidence (reuses
guest-selfie pipeline). Real face-matching = phase 3 (out of MVP; would need
an embedding service).

## 9. Phasing

- **Phase 1 (MVP)**: hotel lat/lng+radius setting · staff_profiles +
  attendance_records migrations · roles/permissions · Add Staff + Staff List +
  Profile · self-service check-in/out with geofence + selfie · front-desk
  utility · Today's Attendance · audit. 
- **Phase 2**: history + calendar + late/early report + CSV exports ·
  nightly absent/auto-close sweep · manager corrections UI · leave records ·
  phone-first login.
- **Phase 3 (optional)**: face matching, payroll hooks (salary × attendance),
  push notifications, shift scheduling/roster.

## 10. Edge cases covered in design

Overnight shifts (check_out next day allowed; work_date = check-in date) ·
double check-in (409, idempotent per day) · GPS denied (blocked, message) ·
poor GPS accuracy (capped grace) · timezone = hotel.timezone for work_date ·
multi-hotel users (membership-scoped; geofence per active hotel) · salary
privacy (separate permission; "Confidential" placeholder otherwise) ·
staff offboarding (status=inactive keeps history; login disabled via
membership status) · reduced-motion/mobile (self-service is mobile-first).

## 11. Open questions for the client (non-blocking, defaults chosen)

1. Late grace period — default 10 min OK? (configurable later)
2. Radius default 200 m OK? Per-hotel configurable in Edit Hotel.
3. Is selfie at check-in mandatory for all staff or optional per hotel?
4. Do receptionists see other staff's attendance, or only record check-ins?
   (default: can view Today's Attendance, cannot see salary/history reports)
5. Email optional for staff? MVP: yes, auto-generated internal email;
   phone login later.
6. Weekly-off/holiday calendar source — manual per staff (MVP) or hotel-wide
   holiday list (phase 2)?
