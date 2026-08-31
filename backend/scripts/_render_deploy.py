"""Create and configure the DigitalMyHotels backend service on Render via API."""
import json
import urllib.error
import urllib.request

RENDER_KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
NEON_URL   = "postgresql+asyncpg://neondb_owner:npg_XS48EVkFOGQr@ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?ssl=require"
UPI_KEY    = "ctLnotPJfqVgA2CvMitzzG8vGQcZZwIanj_EuKKIG7M="
B2_KEY_ID  = "6adfc5a171f7"
B2_APP_KEY = "0058fc7fb4f2cdf6165ef831d6b2209566658cb6e3"
B2_BUCKET  = "Digitialmyhotels"
B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
B2_REGION   = "us-east-005"
VERCEL_URL  = "https://digitalmyhotels.vercel.app"


def api(method, path, body=None):
    url = f"https://api.render.com/v1{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {RENDER_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return json.loads(body) if body else {}, e.code


# ── 1. Check existing services ────────────────────────────────────────────────
print("=== Checking existing services ===")
svcs, _ = api("GET", "/services?limit=20")
existing_id = None
for svc in (svcs if isinstance(svcs, list) else []):
    s = svc.get("service", {})
    sname = s.get("name", "")
    print(f"  Found: {sname} ({s.get('id')}) status={s.get('status')}")
    if sname == "digitalmyhotels-api":
        existing_id = s.get("id")
        print(f"  -> Using existing service: {existing_id}")

# ── 2. Create service if it doesn't exist ────────────────────────────────────
env_vars = [
    {"key": "APP_NAME",              "value": "DigitalMyHotels"},
    {"key": "APP_ENV",               "value": "production"},
    {"key": "DEBUG",                 "value": "false"},
    {"key": "DATABASE_URL",          "value": NEON_URL},
    {"key": "SECRET_KEY",            "generateValue": True},
    {"key": "ACCESS_TOKEN_EXPIRE_MINUTES", "value": "15"},
    {"key": "REFRESH_TOKEN_EXPIRE_DAYS",   "value": "14"},
    {"key": "REFRESH_COOKIE_SECURE",       "value": "true"},
    {"key": "REFRESH_COOKIE_SAMESITE",     "value": "none"},
    {"key": "REFRESH_COOKIE_DOMAIN",       "value": ".onrender.com"},
    {"key": "UPI_ENCRYPTION_KEY",    "value": UPI_KEY},
    {"key": "CORS_ORIGINS",          "value": f'["{VERCEL_URL}"]'},
    {"key": "STORAGE_BACKEND",       "value": "b2"},
    {"key": "B2_ENDPOINT",           "value": B2_ENDPOINT},
    {"key": "B2_KEY_ID",             "value": B2_KEY_ID},
    {"key": "B2_APPLICATION_KEY",    "value": B2_APP_KEY},
    {"key": "B2_BUCKET_NAME",        "value": B2_BUCKET},
    {"key": "B2_PUBLIC_BASE_URL",    "value": ""},
    {"key": "B2_REGION",             "value": B2_REGION},
    {"key": "EMAIL_BACKEND",         "value": "stub"},
    {"key": "EMAIL_FROM",            "value": "noreply@digitalmyhotels.in"},
    {"key": "RATE_LIMIT_LOGIN_PER_MINUTE", "value": "10"},
]

if existing_id:
    service_id = existing_id
    print(f"\n=== Service already exists: {service_id} ===")
    # Update env vars
    print("Updating environment variables...")
    resp, code = api("PUT", f"/services/{service_id}/env-vars", env_vars)
    print(f"  Env vars update: HTTP {code}")
else:
    print("\n=== Creating new Render service ===")
    payload = {
        "type": "web_service",
        "name": "digitalmyhotels-api",
        "ownerId": "tea-da9h09ek1f9s73fd715g",
        "region": "singapore",
        "repo": "https://github.com/shilpgohil/Digitalmyhotels",
        "branch": "master",
        "autoDeploy": "yes",
        "serviceDetails": {
            "buildCommand": "pip install -r requirements.txt",
            "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1",
            "preDeployCommand": "alembic upgrade head",
            "plan": "free",
            "runtime": "python",
            "healthCheckPath": "/health",
            "rootDir": "backend",
            "numInstances": 1,
            "envSpecificDetails": {
                "buildCommand": "pip install -r requirements.txt",
                "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1",
            },
        },
        "envVars": env_vars,
    }
    result, code = api("POST", "/services", payload)
    print(f"  HTTP {code}")
    if code in (200, 201):
        svc = result.get("service", result)
        service_id = svc.get("id", "")
        print(f"  Service created: {service_id}")
        print("  Service URL: https://digitalmyhotels-api.onrender.com")
    else:
        print(f"  Response: {json.dumps(result, indent=2)[:800]}")
        service_id = None

# ── 3. Trigger deploy ─────────────────────────────────────────────────────────
if service_id:
    print(f"\n=== Triggering deploy for {service_id} ===")
    deploy_resp, dcode = api("POST", f"/services/{service_id}/deploys", {"clearCache": "do_not_clear"})
    did = deploy_resp.get("id") if isinstance(deploy_resp, dict) else ""
    print(f"  Deploy HTTP {dcode}  id={did}")
    print("\n✓ Backend deploying to: https://digitalmyhotels-api.onrender.com")
    print(f"  Monitor: https://dashboard.render.com/web/{service_id}")
else:
    print("\n[!] Service ID not obtained — check Render dashboard")
