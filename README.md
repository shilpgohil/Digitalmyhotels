# DigitalMyHotels

Multi-tenant hotel management SaaS — guest check-in/out, bookings, payments (Cash + UPI), GST invoices, expenses, housekeeping, reports, and a super-admin enterprise portal.

**Stack:** Next.js 15 · FastAPI · PostgreSQL (Neon) · Backblaze B2 · Vercel · Render

---

## Local Development

### Prerequisites
- Docker Desktop
- Python 3.12
- Node.js 20+

### 1. Start Postgres
```bash
docker compose up -d
```

### 2. Backend
```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows: .venv\Scripts\activate
                                # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # edit as needed
alembic upgrade head
python scripts/seed.py          # creates super admin + demo hotel
uvicorn app.main:app --port 8001 --reload
```

### 3. Frontend
```bash
cd frontend
npm install
# create frontend/.env.local with: API_PROXY_TARGET=http://127.0.0.1:8001
npm run dev
```

### Demo logins (after seed)
| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@digitalmyhotels.in | ChangeMe123! |
| Hotel Owner | owner@meridiancourt.in | ChangeMe123! |

> **Change these passwords immediately in any live environment.**

---

## Production Deployment

### Recommended infrastructure (all free tier)

| Service | Provider | Region |
|---------|----------|--------|
| Backend API | Render | Singapore (`ap-southeast-1`) |
| Database | Neon | Singapore (`ap-southeast-1`) |
| Object storage | Backblaze B2 | Singapore (`sg-sin-001`) |
| Frontend | Vercel | Global CDN |
| Keep-alive cron | GitHub Actions | — |

> **Why Singapore?** Closest region to India across all providers (~30–50 ms latency vs ~150–250 ms for US/EU).

---

### Step 1 — Push to GitHub

```bash
cd /path/to/management           # project root
git init                         # already done if you see .git/
git add .
git commit -m "feat: initial production-ready DigitalMyHotels"
git remote add origin https://github.com/YOUR_USERNAME/digitalmyhotels.git
git push -u origin main
```

---

### Step 2 — Set up Neon (database)

1. Go to [neon.tech](https://neon.tech) → New project
2. **Region:** `ap-southeast-1` (Singapore / AWS)
3. **Database name:** `digitalmyhotels`
4. Copy the **pooled connection string** (starts with `postgresql://...`)
5. Replace `postgresql://` with `postgresql+asyncpg://`
6. Save as `DATABASE_URL` — you'll need this in Step 3

---

### Step 3 — Set up Backblaze B2 (object storage)

1. Go to [backblaze.com](https://www.backblaze.com) → Sign up → Buckets
2. **Create bucket:** `digitalmyhotels`
   - **Bucket unique name:** `digitalmyhotels-YOUR_ACCOUNT_ID`
   - **Files in bucket are:** Public ✅
   - **Region:** Singapore (`sg-sin-001`)
3. Note the **Endpoint URL** shown in bucket details
4. Go to **App Keys** → Add Application Key
   - **Name:** `digitalmyhotels-prod`
   - **Buckets:** `digitalmyhotels`
   - **Capabilities:** Read and Write Files
5. Save: **Application Key ID** and **Application Key**

---

### Step 4 — Deploy backend to Render

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repository
3. Render will auto-detect `backend/render.yaml`
4. **Region:** Singapore
5. **Plan:** Free

Set these secret environment variables in the Render dashboard
(Settings → Environment → Add Environment Variable):

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon pooled `postgresql+asyncpg://...` |
| `UPI_ENCRYPTION_KEY` | Run: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `B2_KEY_ID` | Backblaze Application Key ID |
| `B2_APPLICATION_KEY` | Backblaze Application Key |
| `B2_PUBLIC_BASE_URL` | `https://s3.sg-sin-001.backblazeb2.com/YOUR_BUCKET_NAME` |
| `CORS_ORIGINS` | `["https://YOUR_APP.vercel.app"]` |
| `REFRESH_COOKIE_DOMAIN` | `.onrender.com` |
| `RESEND_API_KEY` | Optional — from [resend.com](https://resend.com) (3000 free emails/month) |

6. First deploy will automatically run `alembic upgrade head`
7. After deploy, open the Render shell and run:
   ```
   python scripts/seed.py
   ```
8. Note your backend URL: `https://digitalmyhotels-api.onrender.com`

---

### Step 5 — Deploy frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repository
3. **Framework:** Next.js (auto-detected)
4. **Root directory:** `frontend`

Set these environment variables in Vercel (Project → Settings → Environment Variables):

| Variable | Value | Environments |
|----------|-------|-------------|
| `API_PROXY_TARGET` | `https://digitalmyhotels-api.onrender.com` | Production, Preview |

5. Deploy
6. Note your Vercel URL: `https://your-app.vercel.app`

---

### Step 6 — Update CORS on Render

Go back to Render → Update the `CORS_ORIGINS` environment variable:
```
["https://your-app.vercel.app"]
```
Trigger a re-deploy.

---

### Step 7 — Set up GitHub Actions keep-alive

The Render free tier sleeps after 15 minutes of inactivity.
A GitHub Actions cron job pings the backend every 14 minutes to keep it awake.

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add a **Repository secret:**
   - **Name:** `RENDER_BACKEND_URL`
   - **Value:** `https://digitalmyhotels-api.onrender.com`

The workflow at `.github/workflows/keep-alive.yml` will start automatically.
You can monitor it at: `github.com/YOUR_USERNAME/digitalmyhotels/actions`

---

### Step 8 — Final verification

1. Open your Vercel URL
2. Login as super admin: `superadmin@digitalmyhotels.in` / `ChangeMe123!`
3. **Immediately change the password** via Settings
4. Create a hotel via Add New Hotel
5. Login as the hotel owner and test the full booking flow
6. Upload a hotel logo to verify Backblaze B2 storage works
7. Scan the UPI QR code to verify end-to-end

---

## Architecture

```
Browser (Vercel CDN)
    │ /api/* proxy
    ▼
FastAPI (Render · Singapore)
    │
    ├── PostgreSQL (Neon · Singapore)   ← bookings, payments, guests, etc.
    └── Backblaze B2 (Singapore)        ← guest IDs, hotel logos, QR codes
```

## Running tests

```bash
# Backend
cd backend
pytest -q

# Frontend
cd frontend
npx tsc --noEmit
npm run lint
```

## Migration management

```bash
cd backend

# Create a new migration
alembic revision --autogenerate -m "describe_change"

# Apply migrations (auto-runs on Render deploy)
alembic upgrade head

# Check current state
alembic current
```
