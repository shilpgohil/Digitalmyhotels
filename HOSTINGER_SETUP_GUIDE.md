# DigitalMyHotels Hostinger VPS Setup Guide

This guide contains the exact steps and configuration files needed to deploy and run the DigitalMyHotels backend and frontend on your Hostinger VPS.

## 1. System Overview and Ports

The server hosts the full stack locally on a single machine:

1. Frontend runs on port 4000 and serves app.digitalmyhotels.com.
2. Backend FastAPI service runs on port 4050 and serves admin.digitalmyhotels.com.
3. PostgreSQL runs locally on port 5432 with database name digitalmyhotel.
4. Uploaded media files are stored locally on the server disk under the local storage folder.

All logins occur through the frontend website at https://app.digitalmyhotels.com/login. The backend domain admin.digitalmyhotels.com only handles API requests and health checks.

## 2. Backend Setup

### Step 2.1: Go to the backend folder and pull the latest code

```bash
cd /home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend
git pull origin master
```

### Step 2.2: Configure the Backend Environment File

Open or create the .env file in the backend directory:

```bash
nano /home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend/.env
```

Paste the following configuration into the file. Replace your_postgres_password with the actual PostgreSQL user password:

```ini
APP_NAME=DigitalMyHotels
APP_ENV=production
DEBUG=false
DOCS_ENABLED=true

# Database connection to local PostgreSQL on VPS
DATABASE_URL=postgresql+asyncpg://digitalmyhotelusr:your_postgres_password@127.0.0.1:5432/digitalmyhotel

# Security keys
SECRET_KEY=9af56b2c8e1d4f3a7c0e2b5d8f1a4c7e9b2d5f8a1c4e7b0d3f6a9c2e5b8d1f4a
UPI_ENCRYPTION_KEY=v1-local-fernet-key-replace-with-valid-fernet-base64-key==

# Session persistence settings
ACCESS_TOKEN_EXPIRE_MINUTES=43200
REFRESH_TOKEN_EXPIRE_DAYS=90
REFRESH_COOKIE_NAME=dmh_refresh
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=lax

# Storage configured to local VPS NVMe disk
STORAGE_BACKEND=local
LOCAL_STORAGE_PATH=/home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend/.local-storage

# CORS origins
CORS_ORIGINS=["https://app.digitalmyhotels.com","https://admin.digitalmyhotels.com"]

# Background jobs and notifications
EMAIL_BACKEND=stub
EMAIL_FROM=noreply@digitalmyhotels.com
ENABLE_SWEEP_JOBS=false
```

### Step 2.3: Create Local Storage Directory

Create the upload directory and grant read and write permissions:

```bash
mkdir -p /home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend/.local-storage
chmod -R 775 /home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend/.local-storage
```

### Step 2.4: Activate Virtual Environment, Run Migrations, and Seed Database

Activate the Python virtual environment and run the database migrations:

```bash
cd /home/digitalmyhotels-admin/htdocs/admin.digitalmyhotels.com/Digitalmyhotels/backend
source ../.venv/bin/activate
alembic upgrade head
```

Run the complete platform seed to create system roles, default plans, demo hotel, and the super admin:

```bash
python -m scripts.seed
```

Or run the dedicated super admin seed command to create or reset the super admin account directly:

```bash
python -m scripts.seed_superadmin
```

The command creates or updates the Super Admin user in PostgreSQL:
Email: superadmin@digitalmyhotels.in
Password: ChangeMe123!

Verify that the Super Admin exists in the database:

```bash
sudo -u postgres psql -d digitalmyhotel -c "SELECT id, email, is_super_admin, is_active FROM users WHERE email='superadmin@digitalmyhotels.in';"
```

Test the login endpoint directly from the server terminal:

```bash
curl -X POST http://127.0.0.1:4050/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@digitalmyhotels.in","password":"ChangeMe123!"}'
```

A successful response returns status 200 with an access token and user object showing is_super_admin as true.

### Step 2.5: Restart Backend Service

Restart the systemd background service:

```bash
sudo systemctl restart digitalmyhotels
sudo systemctl status digitalmyhotels
```

### Step 2.6: Test Backend Endpoints

Verify that the backend is live and healthy:

```bash
curl -I https://admin.digitalmyhotels.com/
curl https://admin.digitalmyhotels.com/health
curl https://admin.digitalmyhotels.com/health/db
```

Expected result for health checks is status 200 with JSON status ok.

## 3. Frontend Setup

### Step 3.1: Go to the frontend folder and pull the latest code

```bash
cd /home/digitalmyhotels-app/htdocs/app.digitalmyhotels.com
git pull origin master
```

### Step 3.2: Configure the Frontend Environment File

Open or create the .env.production file:

```bash
nano /home/digitalmyhotels-app/htdocs/app.digitalmyhotels.com/.env.production
```

Paste the following variables:

```ini
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.digitalmyhotels.com
API_PROXY_TARGET=http://127.0.0.1:4050
NEXT_PUBLIC_ENABLE_IDLE_LOGOUT=false
```

### Step 3.3: Install Dependencies and Build Application

```bash
cd /home/digitalmyhotels-app/htdocs/app.digitalmyhotels.com
npm install
npm run build
```

### Step 3.4: Restart Frontend Process

Restart your Node or PM2 process running on port 4000:

```bash
pm2 restart all || npm run start -- -p 4000
```

## 4. Super Admin Login Instructions

1. Open your browser and navigate to:
   https://app.digitalmyhotels.com/login

2. Log in using the seeded superadmin credentials:
   Email: superadmin@digitalmyhotels.in
   Password: ChangeMe123!

3. Upon successful login, the system will detect that the account has is_super_admin set to true and will automatically route you to:
   https://app.digitalmyhotels.com/admin

Note: Do not attempt to visit https://admin.digitalmyhotels.com/login. That subdomain only hosts the FastAPI backend API. All web interface logins must go through https://app.digitalmyhotels.com/login.

## 5. Session and Inactivity Verification

1. Token expiration is configured to 30 days (43200 minutes) and cookie lifetime is set to 90 days.
2. Inactivity logouts are disabled by default.
3. If the backend service restarts or experiences temporary downtime, the user session will be preserved in localStorage and the user will not be redirected to the login screen.
4. Users remain logged in until they explicitly click the Log Out button in the navigation header or sidebar.

## 6. Helpful Maintenance Commands

View live backend logs:
```bash
journalctl -u digitalmyhotels -f -n 100
```

Check backend systemd service definition:
```bash
cat /etc/systemd/system/digitalmyhotels.service
```

Inspect local database tables using PostgreSQL client:
```bash
sudo -u postgres psql -d digitalmyhotel -c "SELECT id, email, is_super_admin, is_active FROM users;"
```
