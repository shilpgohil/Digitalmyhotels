# DigitalMyHotels — Antigravity Project Rules

## ⚡ Quick Identity
You are working on **DigitalMyHotels**, a multi-tenant SaaS hotel management platform (B2B).
- **Live production**: Frontend on Vercel (`digitalmyhotels.vercel.app`) + Backend on Render (`digitalmyhotels-api-sg.onrender.com`) + DB on Neon (ap-southeast-1).
- **All 5 phases are complete and deployed.** You are in active maintenance + bug-fixing mode.
- **Dev machine**: Windows + PowerShell. Python 3.12 (`py -3.12`). Node 24, npm 11.

---

## 📂 Memory Bank — Read These First

Before working on ANY task, read the relevant memory-bank files. They are the source of truth for current project state:

| File | When to read |
|---|---|
| `memory-bank/activeContext.md` | **Always** — latest session state, recent fixes, open issues |
| `memory-bank/progress.md` | **Always** — phase status, what works, known issues |
| `memory-bank/bugfixMasterPlan-2026-09-15.md` | When fixing bugs or picking up backlog items |
| `memory-bank/MASTER_FIX_PLAN.md` | When addressing client feedback batches |
| `memory-bank/systemPatterns.md` | When touching architecture or adding new modules |
| `memory-bank/techContext.md` | When setting up dev environment or changing dependencies |
| `memory-bank/projectbrief.md` | When needing product scope overview |
| `memory-bank/productContext.md` | When making product decisions |
| `main documents/DIGITALMYHOTELS_MASTER_CONTEXT.md` | Full engineering source-of-truth (read once per session for major work) |
| `main documents/DIGITALMYHOTELS_ARCHITECTURE.md` | Architecture deep-dive |
| `main documents/AI_WORK_GUIDANCE.md` | AI assistant behaviour rules |
| `memory-bank/srs-reference.txt` | Functional requirements |

---

## 🏗️ Technology Stack (Non-Negotiable)

### Backend
- **Python 3.12** + **FastAPI** + **Pydantic v2** + **SQLAlchemy 2.x async** + **asyncpg** + **Alembic**
- Modular monolith under `backend/app/`
- Deployment: **Render** (Singapore region, free tier spins down — `/health` endpoint exists)

### Frontend
- **Next.js 15** (App Router, `src/` dir) + **React** + **TypeScript** + **Tailwind CSS** + **shadcn/ui**
- Deployment: **Vercel**
- Bilingual: **English + Hindi** (i18n dictionaries in `frontend/src/`)

### Database
- **PostgreSQL 16** — Docker locally (`localhost:5434`), **Neon** in production (ap-southeast-1)
- ALL hotel-scoped tables MUST have an indexed `hotel_id` FK

### Storage
- **Backblaze B2** (`Digitialmyhotels` bucket, us-east-005) via `boto3` + S3-compatible API
- Local stub in dev. NEVER write durable files to local disk.

### Payments
- **Cash + UPI only**. No card/bank/gateway integrations.

---

## 🔒 Architecture Rules (Always Enforce)

### Layering (Backend)
```
api/v1/*          ← thin routers; ZERO business logic
services/*        ← business rules, transactions, audit writes
repositories/*    ← scoped DB helpers: get_x_for_hotel(id, hotel_id)
models/*          ← SQLAlchemy 2.0 typed models (persistence only)
schemas/*         ← Pydantic v2 API contracts (NEVER expose ORM models directly)
core/*            ← config, security, permissions, tenant, errors, logging, encryption
integrations/*    ← storage/email/notifications behind clean interfaces
```

### Tenant Isolation
- `get_tenant_context` dependency resolves membership + role from DB
- `X-Hotel-Id` header is a hint only — always verify against authenticated user's membership
- NEVER trust a `hotel_id` from the browser directly
- Every protected query MUST filter by `hotel_id`

### RBAC
- `core/permissions.py` — `Permission` enum + `ROLE_PERMISSIONS` map
- Roles: `super_admin`, `owner`, `manager`, `admin`, `housekeeping`
- Workers get `HOTEL_VIEW_PAYMENT_QR` but NEVER `HOTEL_VIEW_UPI_ID`
- Authorization is enforced backend-side, not just via frontend hiding

### Money
- `Numeric(12,2)` + Python `Decimal` everywhere — NO floats
- `guest_booking_ledger` is append-only — corrections are new rows, NEVER overwrites
- Soft-delete / void / correction records only — NEVER destructive DELETE on financial data

### Authentication
- 15-min access JWT (Bearer)
- Rotating refresh token (SHA-256 hash stored in DB) in HttpOnly cookie at `/api/v1/auth`
- Reuse detection revokes the whole token family
- argon2 password hashing

### UPI Security
- UPI ID encrypted at rest (Fernet via `core/encryption.py`)
- Raw UPI ID NEVER in worker-facing API responses
- QR generated server-side; only QR image returned to workers
- Audit every create/update/delete on UPI config

### Room State Machine
```
available → reserved → occupied → cleaning_required → cleaning_in_progress
         → clean_ready → inspection_required → maintenance → out_of_service
```
Enforced via CHECK constraint + service-level transition rules.

---

## 🖥️ Local Dev Environment

```powershell
# Start backend (from backend/)
.\.venv\Scripts\activate
uvicorn app.main:app --reload --port 8001   # Note: port 8001 (Windows blocks 8000)

# Start frontend (from frontend/)
npm run dev   # port 3000 — proxies /api to backend

# DB
docker compose up -d postgres   # Postgres 16 on localhost:5434 (note: 5434, not 5432)

# Migrations
alembic upgrade head

# Tests + lint
pytest               # from backend/
ruff check app       # backend lint
mypy app             # backend types
npx tsc --noEmit     # frontend types
npm run build        # frontend build check
```

**Windows gotcha**: `uvicorn --reload` children don't match `uvicorn app.main` in CommandLine — kill by port (`Get-NetTCPConnection`) or orphaned children keep serving stale code.

---

## 🧪 Test & Quality Gates

Every change must pass:
- `pytest tests/unit/` (all 68 unit tests green)
- `ruff check app` — clean (0 errors)
- `mypy app` — clean (0 errors)
- `npx tsc --noEmit` — clean (0 errors)
- `python scripts/check_api_limits.py` — clean (0 violations)
- `python scripts/check_i18n_usage.py` — clean
- i18n parity: `en.json` and `hi.json` key counts must match exactly

---

## 🛡️ Post-Bugfix Verification Protocol & Non-Regression Rules (MANDATORY)

Every single bugfix MUST follow this 7-stage verification process before declaring work complete:

### Stage 1: Blast-Radius Tracing
Before and after code edits, identify all downstream/collateral dependents:
- **Pricing / Tariff**: Check advance booking total, Current Guests due, Checkout quote, Invoice items & PDF.
- **GST Modes**: Check `no_gst` (hidden), `included_by_hotel` (extracted), `included_by_customer` (added), and restaurant folio.
- **Room Status**: Check Room grid (`/rooms`), Dashboard chips (`/dashboard`), check-in availability picker, and Housekeeping task board.
- **Check-In**: Check walk-in commit, advance check-in (`/checkin?booking=id`), co-guest card state, and local draft isolation (`v3:{hotelId}`).
- **Payments / Refunds**: Check ledger append order (`GuestBookingLedger`), advance-first refund allocation, payments breakdown, and Daily Closing.
- **Tenant / Auth**: Check `HotelKeyed` unmount on hotel switch, expired wind-down policy, and role UPI ID hiding.
- **Staff / Attendance**: Check geofence Haversine calculation, selfie key prefix validation, and overnight shift handling.

### Stage 2: Dual-Stack Type Gates
- Frontend: `npx tsc --noEmit` (from `frontend/`) -> MUST exit 0.
- Backend: `mypy app` (from `backend/`) -> MUST exit 0.

### Stage 3: Code Hygiene & Style
- Backend: `ruff check app` (from `backend/`) -> MUST exit 0.

### Stage 4: Automated Regression Tests
- Unit: `pytest tests/unit/` (from `backend/`) -> MUST pass 100%.
- Targeted Integration: Run matching integration tests for any touched model/query.

### Stage 5: Invariant & Domain Audits
1. **Money Invariant**: Strictly `Decimal` + `Numeric(12,2)`. No floats. Use `money()` (`ROUND_HALF_UP`).
2. **Tenant Boundary**: Every DB query must explicitly filter by `hotel_id` from `get_tenant_context`.
3. **API Limit Caps**: Run `python scripts/check_api_limits.py` (0 violations).
4. **i18n Usage & Parity**: Run `python scripts/check_i18n_usage.py` and verify `en.json` count == `hi.json` count.
5. **Storage Security**: Validate all object keys adhere to `hotels/{hotel_id}/...`.

### Stage 6: Collateral Flow Verification
Verify:
1. The primary bug reproduction case is resolved.
2. The immediately preceding upstream workflow functions correctly.
3. The immediately following downstream workflow functions correctly.

### Stage 7: Clean Diff Review
1. Inspect `git diff` line-by-line: eliminate scratch code, print logs, or unintentional formatting drift.
2. Update `memory-bank/activeContext.md` with the bug description, root cause, files changed, and verified collateral flows.

---

## 🛑 AI Assistant Behaviour Rules

1. **Read `memory-bank/activeContext.md` + `memory-bank/progress.md` before every session.**
2. **Do NOT silently change architecture, tech stack, or security model.** Propose → explain → wait for approval → implement.
3. **Do NOT invent new product behavior** not in the SRS or approved decisions.
4. **Do NOT weaken security** or expose sensitive data (UPI ID, guest IDs, etc.).
5. **Do NOT make destructive DB changes** — always use Alembic migrations; always soft-delete financial records.
6. **Small routine changes** within approved architecture can be implemented directly.
7. **For any major deviation**: state it, explain why it's better, explain trade-offs, wait for explicit approval.
8. **Update `memory-bank/activeContext.md`** at the end of every session to record what was done, what's open, and decisions made.
9. **Surface conflicts** between sources — never silently pick one.

### Source-of-Truth Hierarchy (when sources conflict)
1. Explicit product-owner decisions in latest conversation
2. `main documents/DIGITALMYHOTELS_MASTER_CONTEXT.md`
3. DigitalMyHotels SRS (`memory-bank/srs-reference.txt`)
4. Frontend/UI/UX standards
5. Figma/PNG visual references (inspiration only, not pixel-perfect spec)

---

## 📍 Current State (as of 2026-09-16)

- **All 5 phases DEPLOYED to production.**
- Last major work: full persistence audit (16/09/2026) — 240 tests pass, ruff+tsc+build all clean.
- **Uncommitted work exists**: draft photo B2 persistence + full persistence audit fixes — needs deploy.
- **Active backlog**: `memory-bank/bugfixMasterPlan-2026-09-15.md` — ~35-item client bug batch.
- Q1–Q6 client decisions in bug plan are open — DO NOT start implementation without answers.
- Production storage: Backblaze B2 (`Digitialmyhotels` bucket) confirmed working.
- Keep-alive: GitHub Actions pings `/health` every 10 min.

---

## 📎 Key File Locations

```
backend/app/
  api/v1/          ← REST routes (thin)
  services/        ← business logic
  repositories/    ← DB access
  models/          ← SQLAlchemy models
  schemas/         ← Pydantic schemas
  core/            ← config, security, permissions, tenant, errors
  integrations/    ← storage, email, notifications

frontend/src/
  app/(auth)/          ← auth pages
  app/(partner)/       ← hotel staff portal
  app/(super-admin)/   ← platform admin
  components/          ← shared UI components
  features/            ← domain feature modules
  lib/api/             ← typed API client (auto refresh-on-401)
  lib/permissions/     ← frontend permission mirrors (UI gating only)

memory-bank/         ← AI memory files (source of truth for project state)
main documents/      ← Architecture docs, client docs, design references
scripts/             ← utility scripts (check_api_limits.py, etc.)
```
