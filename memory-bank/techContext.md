# Tech Context — DigitalMyHotels

## Stack
- Backend: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x async + asyncpg, Alembic, argon2 (passlib), python-jose (JWT), qrcode+Pillow (UPI QR), cryptography (Fernet), boto3 (R2).
- Frontend: Next.js 15 (App Router, src dir), React, TypeScript, Tailwind CSS, shadcn/ui.
- DB: PostgreSQL 16 (Docker locally → Neon in production).
- Storage: S3-compatible interface — LocalStorage stub in dev, Cloudflare R2 in production.
- Email: interface with stub/console backends; provider (e.g. Resend) before production.

## Local development
- `docker compose up -d postgres` → Postgres 16 on localhost:5432 (user `dmh`, db `digitalmyhotels`).
- Backend: `backend/.venv` (Python 3.12); run `uvicorn app.main:app --reload --port 8000` from `backend/`.
- Frontend: `npm run dev` from `frontend/` (port 3000).
- Backend env: `backend/.env` (copy from `.env.example`).
- Migrations: `alembic upgrade head` (async env.py reads URL from app settings).
- Tests: `pytest` from `backend/`; lint `ruff check app`; types `mypy app`.

## Deployment targets (final phase)
- Frontend → Vercel; Backend → Render (paid always-on for prod, `/health` endpoint exists); DB → Neon; storage → R2; CI → GitHub Actions.
- CORS/cookies: Vercel and Render are separate origins — refresh cookie configured with explicit SameSite/secure/domain; CORS allowlist via `CORS_ORIGINS`.

## Constraints
- Windows dev machine (PowerShell). Python 3.12 via `py -3.12`. Node 24, npm 11.
- No Redis/queues/microservices without approval. No local filesystem persistence for durable files in production.
